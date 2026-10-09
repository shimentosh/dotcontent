import { markUsed, resolve as resolvePack } from "@/lib/server/repos/packs";
import { findBrain, write, type Transport } from "@/lib/server/brains";
import { frameBytes, framePath, sourceBrief } from "@/lib/server/services/ingest";
import { fetchSource } from "@/lib/server/services/webfetch";
import { plan, systemPrompt, userPrompt } from "@/lib/server/prompt";
import { DEFAULT_BRAIN, getWorkspace } from "@/lib/server/repos/workspaces";
import { getTopic, updateTopic } from "@/lib/server/repos/series";
import { getSource } from "@/lib/server/repos/sources";
import {
  cancel as cancelJobs,
  enqueue,
  jobsForRun,
  type Job,
} from "@/lib/server/repos/jobs";
import { listWorkers, routeFor } from "@/lib/server/repos/workers";
import {
  createRun as insertRun,
  deleteRun as deleteRunRow,
  getRun,
  requeueWriting,
  setSection,
  type Run,
} from "@/lib/server/repos/runs";
import type { Pack, PackSectionDef } from "@/lib/packs/website-shorts";

/**
 * Starting runs, and getting their sections written.
 *
 * The rules that are not the database's job and not the route's: which inputs a
 * pack requires, what a section is allowed to run before, and what finishing a
 * section means for the topic that started it.
 *
 * Nothing here writes a section itself any more. The server decides — the
 * order, the prompt, the model, the transport — and a job carries that decision
 * to whichever machine has the CLI on it. See docs/WORKER.md.
 */

export class RunError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function startRun(input: {
  workspaceId: string;
  topicId?: string | null;
  packSlug: string;
  inputs: Record<string, string>;
  title?: string;
  sourceId?: string | null;
  /*
   * Who is asking, taken from the session by the controller.
   *
   * Not part of `inputs` and not read off the body for the same reason
   * `brandVoice` is not: a caller who can name the author can name somebody
   * else, and the one question this column exists to answer — who spent the
   * API budget — is worthless if the answer is whatever the request said.
   */
  userId?: string | null;
}): Promise<Run> {
  const pack = await resolvePack(input.packSlug);
  if (!pack) throw new RunError(`No pack "${input.packSlug}"`, 400);

  const workspace = await getWorkspace(input.workspaceId);
  if (!workspace) throw new RunError("No such workspace", 400);

  const topic = input.topicId ? await getTopic(input.topicId) : null;

  const missing = pack.inputs.filter(
    (i) => i.required && !input.inputs[i.key]?.trim(),
  );
  if (missing.length) {
    /*
     * The one missing input that has an answer rather than just a name.
     *
     * A template whose script writes "Part N" into every line cannot run
     * against a topic that has no N, and "Missing required input: Series part"
     * is true, useless, and sends you looking for a field to type it in. The
     * field does not exist — the number comes from the shelf, and the shelf is
     * where the switch is.
     */
    const partOnly =
      missing.length === 1 &&
      missing[0].key === "part_number" &&
      topic !== null &&
      topic.part === null;

    throw new RunError(
      partOnly
        ? `This template writes a part number into what it produces, and "${topic.name}" does not have one. Turn on "Number the parts" on its series, then try again.`
        : `Missing required input: ${missing.map((i) => i.label).join(", ")}`,
      400,
    );
  }

  // Recorded before the run exists rather than after it finishes: "used" on the
  // packs list means "last reached for", and a run abandoned halfway still
  // counts as having reached for it.
  await markUsed(pack.slug);

  return insertRun({
    workspaceId: workspace.id,
    topicId: topic?.id ?? null,
    packSlug: pack.slug,
    title:
      input.title?.trim() ||
      topic?.name ||
      input.inputs.website_url?.trim() ||
      `${input.inputs.series ?? pack.name} part ${input.inputs.part_number ?? "1"}`,
    // Read from the workspace, not sent by the client: the voice governs every
    // line the run produces, and a caller must not be able to swap it.
    brandVoice: workspace.brandVoice,
    inputs: input.inputs,
    sourceId: input.sourceId ?? null,
    createdBy: input.userId ?? null,
    sections: pack.sections.map((s) => ({ id: s.id, title: s.title })),
  });
}

/*
 * One fetch per run, not one per section.
 *
 * A twelve-section template would otherwise hit the site twelve times to read
 * the same page, which is rude to the site and slow for you. Keyed by run and
 * URL together so a re-run after the URL is corrected does not serve the old
 * page back. Process-lifetime only: this is a cache, not a record.
 *
 * And bounded, because process lifetime is now measured in weeks: the API is a
 * long-lived service, every run with a website_url leaves a whole page of text
 * in here, and nothing ever took one out. A Map keeps insertion order, so the
 * oldest key is the first one it yields — dropping that when the cap is passed
 * is the whole eviction policy. Not LRU: a run's sections are written back to
 * back and then the run is over, so age is what "no longer wanted" looks like
 * here, and an access-ordered cache would only buy complexity.
 *
 * 200 is a couple of hundred pages — comfortably more than any burst of runs
 * in flight at once, which is all this has to cover, and a few megabytes at
 * worst rather than an unbounded number of them.
 */
const SITE_CACHE_MAX = 200;
const siteCache = new Map<string, string>();

const rememberSite = (key: string, block: string) => {
  siteCache.set(key, block);
  while (siteCache.size > SITE_CACHE_MAX) {
    // `keys().next()` is the oldest insertion; a `while` rather than an `if`
    // so a cap lowered in a later edit drains rather than leaking forever.
    const oldest = siteCache.keys().next();
    if (oldest.done) break;
    siteCache.delete(oldest.value);
  }
};

/**
 * What the model is allowed to answer from.
 *
 * The reel when there is one, otherwise the website itself. Until now there
 * was only the reel, so a run given a URL and nothing else reached its first
 * section with no evidence at all — and that section, doing exactly as it was
 * told, wrote "NAME: UNKNOWN" and every section after it inherited the
 * UNVERIFIED. The site was always readable; nothing had been asked to read it.
 */
async function evidenceFor(run: Run): Promise<string> {
  if (run.sourceId) return sourceBrief(run.sourceId);

  const url = (run.inputs.website_url ?? "").trim();
  if (!url) return "";

  const key = `${run.id}::${url}`;
  const cached = siteCache.get(key);
  if (cached !== undefined) return cached;

  let block: string;
  try {
    const site = await fetchSource(url);
    const body = site.text.trim()
      ? site.text
      : site.items.map((i) => `- ${i.title}`).join("\n");
    block = [
      "--- THE WEBSITE ITSELF ---",
      `Read from ${site.url} just now. This is first-hand: anything it does not say is not established, and must be reported as unverified rather than guessed.`,
      site.title ? `PAGE TITLE: ${site.title}` : "",
      body,
    ]
      .filter(Boolean)
      .join("\n\n");
  } catch (e) {
    /*
     * Say the site could not be read, rather than saying nothing.
     *
     * Silence looks identical to "no URL was given", and the section then
     * invents a reason. Naming the failure lets it report the real one.
     */
    block = [
      "--- THE WEBSITE COULD NOT BE READ ---",
      `${url} was requested and did not come back: ${
        e instanceof Error ? e.message : "the request failed"
      }`,
      "Do not describe the site. Say plainly that it could not be read, and mark every claim about it unverified.",
    ].join("\n\n");
  }

  rememberSite(key, block);
  return block;
}

/**
 * How long one section may take on a machine before the worker gives up.
 *
 * The same ten minutes every transport in `brains.ts` already defaults to,
 * named here because the server is now the thing that says it: the worker is
 * told the timeout rather than choosing one, so a section cannot take longer
 * on one teammate's laptop than on another's because of a different default.
 */
const SECTION_TIMEOUT_MS = 600_000;

/**
 * How long a job may sit waiting for a machine that is capable but shut.
 *
 * Somebody opening their laptop is the normal resolution and it should just
 * start. Past this the reaper fails the job with the sentence written at
 * enqueue, which names the machine — because a run that reads "waiting" all
 * night, with nobody told why, is the six-minutes-on-Writing-01 bug wearing a
 * bigger hat.
 */
const WAIT_FOR_MACHINE_MS = 15 * 60_000;

/**
 * What a section needs on the machine that writes it, and how it is reached.
 *
 * The transport is decided HERE and travels in the payload. `write()` used to
 * re-derive it by calling `brainStatuses()`, which calls `toolStatuses()`,
 * which probes whichever machine is asking — meaningless on a server with no
 * CLI on it, and forever answering "nothing installed". The worker reported
 * its tools when it registered; the server picks from what it was told and
 * says so, and a worker that cannot honour what it was told must FAIL rather
 * than quietly answer some other way. A silent CLI-to-API downgrade is the one
 * outcome docs/DECISIONS.md calls worse than an error: an answer produced
 * without the evidence, presented as though it had been read.
 *
 * `needs` is the tool id the claim query intersects against a worker's own
 * switched-on list, so a machine without that CLI never even sees the job.
 * Ollama has no command to install — it is an HTTP server on the machine that
 * runs it — so it needs nothing and is reached over its own local API.
 */
function transportFor(brainId: string): { needs: string[]; transport: Transport } {
  const def = findBrain(brainId);
  return def?.command
    ? { needs: [def.command], transport: "cli" }
    : { needs: [], transport: "api" };
}

/**
 * How to install a tool nothing on this estate has.
 *
 * Read off any machine that has ever reported the tool, present or not: a
 * `ToolStatus` carries its own `install` string, so the sentence a person is
 * shown comes from the same table the probe wrote rather than from a second
 * copy of the install commands kept here and left to drift. When no machine
 * has ever heard of it there is nothing honest to say beyond its name.
 */
async function installHint(need: string): Promise<string> {
  const workers = await listWorkers();
  for (const w of workers) {
    const tool = w.tools.find((t) => t.id === need);
    if (tool?.install) return tool.install;
  }
  return "";
}

/**
 * The stills a section is allowed to look at, as URLs on the server.
 *
 * Only sections with no dependencies get them, and that is a decision about
 * money rather than about capability: a section with dependencies is handed
 * the finished text of everything upstream, which is the evidence already read
 * and turned into words, so downloading eight JPEGs to a laptop again per
 * section would pay the transfer twelve times to learn nothing new. The
 * first-wave sections are the ones written for somebody who has watched the
 * reel.
 *
 * URLs, not paths. `sourceBrief()` deliberately stopped naming
 * `.data/sources/<id>/` because that is the server's filesystem and the model
 * is on somebody's desktop; the worker downloads these into a temp directory
 * of its own and hands its CLI local absolute paths, each in the way that CLI
 * takes a file.
 */
async function framesFor(run: Run, def: PackSectionDef) {
  if (!run.sourceId || def.dependsOn.length) return undefined;
  const source = await getSource(run.sourceId);
  if (!source?.frames.length) return undefined;
  return source.frames.map((f) => ({
    // The worker's door, not the browser's. `/api/sources/...` is the same
    // bytes behind a session cookie, which a headless machine holding a bearer
    // token does not have and must not be given — the argument for a separate
    // worker credential is that it reaches the queue and nothing else.
    url: `/api/workers/sources/${source.id}/frames/${f.file}`,
    at: f.at,
  }));
}

/**
 * Everything the machine writing this section is told, and nothing else.
 *
 * The server has already resolved the pack, checked the dependencies,
 * gathered the finished upstream text, read the website or the source brief,
 * and run `systemPrompt()` and `userPrompt()`. What travels is their output:
 * text and a command. No pack, no rules, no brand voice, no dependency graph —
 * business logic shipped to fifteen desktops would need fifteen updates to
 * change a prompt, and the prompt changes weekly.
 */
async function payloadFor(
  run: Run,
  pack: Pack,
  def: PackSectionDef,
  done: Record<string, string>,
  brief: string,
  brainId: string,
  transport: Transport,
  allowFrameRead: boolean,
) {
  const frames = await framesFor(run, def);
  return {
    brain: brainId,
    transport,
    system: systemPrompt(pack, run.inputs, run.brandVoice),
    user: userPrompt(def, pack, run.inputs, done, brief),
    tier: def.tier,
    timeoutMs: SECTION_TIMEOUT_MS,
    ...(frames ? { frames } : {}),
    allowFrameRead,
  };
}

/**
 * Enqueue everything this run is ready to write, and return.
 *
 * What replaced `driveRun`, and the shape of the replacement is the point.
 * `driveRun` was a `for(;;)` that picked the next eligible section, awaited the
 * model, and went round again — so one Node process held the run for its whole
 * length, and a `globalThis` Set was the only thing stopping a second loop
 * starting over sections the first was already writing. That worked exactly as
 * long as the model was a child process of the loop. It cannot survive the
 * split: the model now runs on somebody's laptop, the process that would be
 * holding the run has nothing to hold, a deploy or a crash loses whatever the
 * loop remembered, and a Set in one replica's memory is a lock the other
 * replica cannot see.
 *
 * So nothing holds a run. This is called when Run is pressed and again every
 * time a result lands, it looks at the database, and it stops. Restart the API
 * mid-run and nothing is lost, because nothing was in memory to lose.
 *
 * Everything in a wave is enqueued at once. `plan()` has computed the
 * dependency waves since the beginning and has never been called by anything —
 * it becomes the real scheduler here. One-at-a-time was a property of the model
 * being one local process, not of the templates, and the parallelism that
 * replaces it comes from more machines rather than from one machine doing more:
 * per-machine limits are `workers.max_concurrency`, enforced at the claim, and
 * are none of this function's business.
 *
 * Enqueueing twice is safe and is expected — two tabs, a double Run, a result
 * landing while somebody presses it. `jobs_one_per_section` is a unique index
 * over the live states, so both attempts converge on the same job rather than
 * paying two subscriptions to write one section.
 */
export async function advance(runId: string): Promise<{
  /** Sections that now have a job on the queue. */
  enqueued: string[];
  /** Sections queued behind a machine that is not awake, with its name. */
  waiting: { sectionId: string; machine: string }[];
  /** Sections nothing on this estate can ever write. Already failed. */
  unroutable: string[];
  /**
   * Sections the server is writing itself, on the workspace's API key.
   *
   * Its own list rather than folded into `enqueued`, because these have no job
   * row and no machine: "3 sections queued" and "3 sections are costing money
   * right now" are different sentences and the page must be able to tell them
   * apart. Empty unless `workspaces.api_fallback` is on.
   */
  onApi: string[];
}> {
  const out = {
    enqueued: [] as string[],
    waiting: [] as { sectionId: string; machine: string }[],
    unroutable: [] as string[],
    onApi: [] as string[],
  };

  const run = await getRun(runId);
  if (!run) return out;
  const pack = await resolvePack(run.packSlug);
  if (!pack) return out;

  const rows = new Map(run.sections.map((s) => [s.id, s]));
  const done: Record<string, string> = {};
  for (const s of run.sections) {
    if (s.state === "done" && s.content) done[s.id] = s.content;
  }

  /*
   * One live job per section, read once.
   *
   * The unique index would refuse a duplicate anyway, but a job already
   * claimed by a machine four minutes into writing must not even be considered
   * eligible: the payload would be rebuilt, the evidence fetched again, and
   * `advance` would report having started something it did not.
   */
  const live = new Set(
    (await jobsForRun(runId))
      .filter((j) => j.state === "queued" || j.state === "claimed")
      .map((j) => j.sectionId ?? ""),
  );

  /*
   * The waves, and the sections in them that are ready.
   *
   * A section is ready when every dependency is `done` — not merely enqueued.
   * `plan()` gives the order; the run's own rows say how far it has actually
   * got, which is the half `plan()` cannot know. A failed section is left
   * alone: it has had its turn, and anything depending on it never becomes
   * eligible, so the run ends with those still queued, which is the truth and
   * visible on the page. Retry is `requeueFailed`.
   */
  const waves = plan(pack);
  const scheduled = new Set(waves.flat());
  const ready: PackSectionDef[] = [];
  for (const wave of waves) {
    for (const sid of wave) {
      const def = pack.sections.find((s) => s.id === sid);
      const row = rows.get(sid);
      if (!def || !row) continue;
      if (row.state !== "queued") continue;
      if (live.has(sid)) continue;
      if (!def.dependsOn.every((d) => done[d])) continue;
      ready.push(def);
    }
  }

  /*
   * A section `plan()` never placed depends on something that does not exist,
   * so no amount of waiting will make it eligible. Failing it says so; leaving
   * it queued would be a row that reads "waiting" until somebody deletes the
   * run.
   */
  for (const row of run.sections) {
    if (row.state === "queued" && !scheduled.has(row.id)) {
      await setSection(runId, row.id, {
        state: "failed",
        error:
          "This section depends on something the template does not contain, so it can never become ready. Edit the template's dependencies.",
      });
    }
  }

  if (!ready.length) return out;

  /*
   * Which model, and may the server pay for it — both read off the workspace.
   *
   * `settings.brain` was one row for the whole console, so a teammate
   * switching the picker retuned every brand in the database at once. It is
   * `workspaces.brain` now, beside `brand_voice`, and read here the way
   * `startRun` already reads the voice: off the workspace, never off the
   * request. See migration 0016.
   */
  const workspace = await getWorkspace(run.workspaceId);
  const brainId = workspace?.brain || DEFAULT_BRAIN;
  const { needs, transport } = transportFor(brainId);

  /*
   * Where this could run, asked once for the whole wave.
   *
   * Every section in a run wants the same brain and therefore the same tool,
   * so one question answers all of them, and the alternative is a scan of the
   * machines per section.
   */
  const route = await routeFor(needs);

  /*
   * May the machine grant its CLI `Read` for the frames?
   *
   * The server sends what it knows and the worker checks its own switch again
   * before granting anything, because the grant happens on somebody's own
   * filesystem and its owner gets the last word. Which machine will claim the
   * job is not known here, so this says "no machine that could take this
   * objects" rather than naming one — a worker with the switch off refuses on
   * its own behalf, which is exactly the arrangement docs/WORKER.md asks for.
   */
  const allowFrameRead = route.capable.some((w) => w.canReadFrames);

  /*
   * The API-key fallback, and the two conditions it takes.
   *
   * Nothing awake can write this — either no machine anywhere has the CLI, or
   * every machine that does is shut — AND this workspace has said, in
   * writing, that the server may spend a key when that happens.
   *
   * The second half is the whole point and is not caution. This split exists
   * so a run costs a subscription somebody already pays for; a fallback that
   * fired by itself would spend real money at exactly the moment nobody was
   * watching, which is the failure docs/DEPLOYING.md warns about. With it off
   * the job takes the routing below — unroutable, or queued behind
   * `wait_until` — and says so on the page. It stays available because
   * "everyone has gone home and this ships tonight" is a real evening.
   */
  const onApi = route.live.length === 0 && workspace?.apiFallback === true;

  // One fetch of the evidence for the whole wave, not one per section: it is
  // the same website and the same reel for every section in a run.
  const brief = await evidenceFor(run);

  for (const def of ready) {
    const payload = await payloadFor(
      run,
      pack,
      def,
      done,
      brief,
      brainId,
      transport,
      allowFrameRead,
    );

    /*
     * Case 0: nobody can write it and the workspace has agreed to pay.
     *
     * Ahead of the other three because it answers the same question they do —
     * "no machine is going to take this" — with the one answer that produces a
     * section instead of a message. The row goes to `writing` here, where the
     * database can see it, and the write itself is detached: `advance` is
     * called from an HTTP handler and a section takes minutes, so awaiting it
     * would hold the request open until the gateway gave up. No job row,
     * because a job with no machine to claim it is a queue entry nothing can
     * ever pick up — which is the "Writing forever" bug in another costume.
     */
    if (onApi) {
      await setSection(runId, def.id, { state: "writing", error: "" });
      writeOnServer(run, def, brainId, payload);
      out.onApi.push(def.id);
      continue;
    }

    /*
     * Case 1: nothing on this estate has ever advertised the tool.
     *
     * Unroutable at birth, and the section fails with the sentence naming what
     * to install. Not queued: a queue entry no machine can ever claim is a run
     * that reads "Writing" forever, and forever is not a state a person can
     * act on. `unroutable` is deliberately not `failed` on the job, because an
     * install command is a different answer from "the model refused".
     */
    if (route.missing.length) {
      const need = route.missing[0];
      const install = await installHint(need);
      const message = install
        ? `No machine here has ${need}. Install it on one — ${install} — then press Retry.`
        : `No machine here has ${need}, and none has ever reported how to install it.`;
      await enqueue({
        kind: "write_section",
        workspaceId: run.workspaceId,
        runId,
        sectionId: def.id,
        needs,
        payload,
        state: "unroutable",
        error: message,
      });
      await setSection(runId, def.id, { state: "failed", error: message });
      out.unroutable.push(def.id);
      continue;
    }

    /*
     * Case 2: a machine could run it, but none of them is awake.
     *
     * Queue it with a deadline and a sentence that names the machine, so that
     * somebody opening their laptop simply starts it — the normal resolution —
     * and a laptop that stays shut ends as a stated failure rather than as a
     * run that never moved. The section stays `queued`: it is not being
     * written, and the page reads which machine it is waiting for off the job.
     */
    const asleep = route.live.length === 0;
    const { created } = await enqueue({
      kind: "write_section",
      workspaceId: run.workspaceId,
      runId,
      sectionId: def.id,
      needs,
      payload,
      ...(asleep
        ? {
            waitUntil: new Date(Date.now() + WAIT_FOR_MACHINE_MS),
            /*
             * Pinned when exactly one machine could take it, so the page can
             * NAME the machine it is waiting for.
             *
             * `jobsForRun` reads `workerName` off this join. Without it the
             * name existed only inside the sentence below, and the screen had
             * to either render that sentence or match it with a regex — a
             * client matching a server's prose is a UI that breaks silently
             * the day somebody rewords an error.
             *
             * Only with one candidate. With two, pinning would pick a machine
             * for no reason and leave the job waiting on that one while the
             * other came online — the queue's job is to hand work to whoever
             * asks first, and a pin is a promise not to.
             */
            ...(route.capable.length === 1
              ? { wantsWorker: route.capable[0].id }
              : {}),
            error: `Waiting for ${route.capable
              .map((w) => w.name)
              .join(" or ")}, which has not been seen recently.`,
          }
        : {}),
    });

    if (!created) continue;

    if (asleep) {
      out.waiting.push({
        sectionId: def.id,
        machine: route.capable.map((w) => w.name).join(" or "),
      });
      continue;
    }

    /*
     * Case 3: ordinary queueing, and the row says writing.
     *
     * `writing` the moment the job exists rather than when a machine claims
     * it: the queue is the writing now, the wait is normally about a second,
     * and a section that read "queued" while a job was already claimed would
     * make `statusOf` call a moving run idle. The failure that used to hide
     * behind this word — a row saying writing with nothing behind it — is
     * covered instead by the lease, which fails the job on evidence.
     */
    await setSection(runId, def.id, { state: "writing", error: "" });
    out.enqueued.push(def.id);
  }

  // The topic stops being an idea the moment something is being written for
  // it. After the enqueues, not before: a topic marked generating for a run
  // that turned out to be entirely unroutable would be stuck on a state
  // nothing takes it out of.
  if (run.topicId && (out.enqueued.length || out.onApi.length)) {
    await updateTopic(run.topicId, { status: "generating" });
  }

  return out;
}

/*
 * The sections the server is part way through writing itself.
 *
 * Only meaningful for the API fallback, and only because that path has no job
 * row: everything on the queue is guarded by `jobs_one_per_section`, which is
 * the database saying it where every replica can hear. This is the weaker
 * thing — one process's memory — and it is honest about covering one process:
 * two API replicas with the fallback on could both start the same section in
 * the same second, before either had written `writing`. That is one more
 * reason the fallback is off by default and per workspace rather than a mode
 * the console runs in.
 */
const writingOnServer = new Set<string>();

/**
 * The frames, as bytes and as paths on THIS machine.
 *
 * Only for the fallback, and only because the server is where the frames
 * actually live (docs/WORKER.md, "Frames": ingest uploads, write downloads).
 * A worker gets URLs and downloads them; the server has the files already, so
 * it reads them rather than fetching its own HTTP endpoint.
 *
 * Both shapes, because `write()` picks the transport: the Anthropic API path
 * takes image blocks and every CLI takes a path. Handing over neither would be
 * the worst outcome in docs/DECISIONS.md — a section answered from the
 * transcript and presented as though the stills had been looked at — so when
 * a section has frames and the chosen brain cannot be shown them, `write()`
 * refuses and the section fails with a sentence saying why.
 */
async function serverFrames(run: Run, def: PackSectionDef) {
  if (!run.sourceId || def.dependsOn.length) return { images: [], files: [] };
  const source = await getSource(run.sourceId);
  if (!source?.frames.length) return { images: [], files: [] };

  const images: { mediaType: string; data: string }[] = [];
  const files: string[] = [];
  for (const f of source.frames) {
    const bytes = await frameBytes(run.sourceId, f.file);
    if (bytes) images.push({ mediaType: "image/jpeg", data: bytes.toString("base64") });
    const file = framePath(run.sourceId, f.file);
    if (file) files.push(file);
  }
  return { images, files };
}

/**
 * Write one section here, on the workspace's API key, and pay for it.
 *
 * Deliberately not awaited by its caller — see "Case 0" — so it owns its own
 * ending: every path through it finishes the section, because a section left
 * on `writing` with no job behind it is a run that reads Writing forever and
 * nothing on any timer to end it. The success and failure tails are
 * `sectionResult` and `sectionFailed`, the same two the worker-facing
 * controller calls, so a section written here is recorded, unblocks its
 * dependants and moves its topic exactly as one written on a laptop does.
 *
 * `server:api` in `wrote_with` is the point of the column: it is the only
 * record anywhere of which sections cost money rather than somebody's
 * subscription.
 */
function writeOnServer(
  run: Run,
  def: PackSectionDef,
  brainId: string,
  payload: { system: string; user: string; tier: string; timeoutMs: number },
) {
  const key = `${run.id}::${def.id}`;
  if (writingOnServer.has(key)) return;
  writingOnServer.add(key);

  const job = { kind: "write_section" as const, runId: run.id, sectionId: def.id };

  void (async () => {
    const started = Date.now();
    try {
      const { images, files } = await serverFrames(run, def);
      const text = await write(brainId, {
        system: payload.system,
        user: payload.user,
        tier: payload.tier,
        timeoutMs: payload.timeoutMs,
        images: images.length ? images : undefined,
        imageFiles: files.length ? files : undefined,
        /*
         * The server's own disk, granted by the person who runs the server.
         *
         * `workers.can_read_frames` defaults off because that grant lands on
         * somebody else's desktop and they get the last word. This path is the
         * API host reading files it already stores, at the explicit request of
         * a workspace that switched the fallback on, so the same caution does
         * not apply and refusing here would only mean a frame section silently
         * losing its frames.
         */
        allowFrameRead: true,
      });
      // Through sectionResult rather than around it: it is the one place that
      // knows an empty answer is a failure rather than an empty section.
      await sectionResult(job, { text, ms: Date.now() - started }, "server:api");
    } catch (e) {
      await sectionFailed(
        job,
        e instanceof Error ? e.message.slice(0, 400) : "The API did not answer",
        Date.now() - started,
      );
    } finally {
      writingOnServer.delete(key);
    }
  })();
}

/**
 * A `write_section` result has come back from a machine. Write it, then look
 * for what that unblocks.
 *
 * **This is the function the worker-facing controller calls**, once
 * `jobs.succeed()` has accepted the result — that is, once the queue has
 * confirmed the job still belonged to the machine posting it. Do not call this
 * on a result `succeed()` returned null for: null means a laptop woke up and
 * posted a section that was reassigned twenty minutes ago, and the copy in
 * `run_sections` is the one that stands.
 *
 * `ms` comes from the worker, and must. Measured on the server it would
 * include queue wait, so a section would report six minutes because somebody's
 * laptop was shut — a number that reads as "the model was slow" and is not
 * about the model at all.
 *
 * `wroteWith` is the machine's name, from the job's worker rather than from
 * anything in the request body — or the literal `server:api` when the
 * workspace's API-key fallback wrote it here instead. It is the only record of
 * whose subscription paid for this section, and of which sections were paid
 * for in money.
 *
 * Returns the run as it now stands, and has already called `advance` — so the
 * next wave is on the queue by the time this resolves.
 */
export async function sectionResult(
  /** The job the queue just accepted the result for. */
  job: Pick<Job, "runId" | "sectionId" | "kind">,
  /** What the machine posted: `{ text, ms, using }`. */
  result: Record<string, unknown>,
  /**
   * The machine's name, from the authenticated worker — never from the body —
   * or `server:api` from the fallback in `advance`, which is the only other
   * thing allowed to call this.
   */
  workerName: string,
): Promise<Run | null> {
  if (job.kind !== "write_section" || !job.runId || !job.sectionId) return null;
  const runId = job.runId;
  const sectionId = job.sectionId;

  const run = await getRun(runId);
  if (!run) return null;

  const text = typeof result.text === "string" ? result.text : "";
  const ms = typeof result.ms === "number" ? result.ms : undefined;

  /*
   * Nothing back is a failure, not an empty section.
   *
   * A `write_section` result arrives whole or not at all, so a job that
   * "succeeded" with no text did not write anything — and saving that as done
   * would put an empty, approved-looking section on the page and let every
   * section downstream be written against it.
   */
  if (!text.trim()) {
    return sectionFailed(job, "The machine answered with no text.", ms);
  }

  await setSection(runId, sectionId, {
    state: "done",
    content: text,
    error: "",
    ...(ms === undefined ? {} : { ms }),
    wroteWith: workerName,
    // These are the model's words again — whatever a person had typed here has
    // just been replaced, so the "edited by hand" mark goes with it.
    edited: false,
  });

  const after = await getRun(runId);
  // Finished means every section landed — which is a fact about the run, so the
  // topic learns it from the run rather than from whoever answered last.
  if (run.topicId && after?.sections.every((s) => s.state === "done")) {
    await updateTopic(run.topicId, { status: "done" });
  }

  await advance(runId);
  return await getRun(runId);
}

/**
 * A `write_section` job failed on the machine that held it.
 *
 * Also for the worker-facing controller, and the counterpart to the one above.
 * Call it only when `jobs.fail()` has come back with a job in a TERMINAL state:
 * a retryable failure with attempts left goes back to `queued` for another
 * machine, and the section is still being written — marking it failed then
 * would put "Failed" on a row somebody is about to write successfully.
 *
 * `advance` is called either way, because a section that is genuinely finished
 * with may still have left siblings in its wave that are now ready.
 */
export async function sectionFailed(
  job: Pick<Job, "runId" | "sectionId" | "kind">,
  error: string,
  ms?: number,
): Promise<Run | null> {
  if (job.kind !== "write_section" || !job.runId || !job.sectionId) return null;
  const runId = job.runId;

  const run = await getRun(runId);
  if (!run) return null;

  await setSection(runId, job.sectionId, {
    state: "failed",
    error: error || "The model did not answer",
    ...(ms === undefined ? {} : { ms }),
  });

  /*
   * Back to an idea, not left mid-write.
   *
   * The run keeps the failure — the section says so, and the row on Content
   * reads "Failed" — while the topic returns to the pile it can be started from
   * again. A topic stuck on "generating" after a run died is the state nothing
   * could get it out of.
   */
  if (run.topicId) await updateTopic(run.topicId, { status: "idea" });

  await advance(runId);
  return await getRun(runId);
}

/**
 * Write one section, now, because a person asked for that one.
 *
 * The same enqueue as `advance`, scoped to a section somebody pointed at, and
 * the dependency check is kept rather than trusted: the client chooses the
 * order, so nothing stops it asking for the Bangla script first, and a model
 * handed an empty "ALREADY GENERATED" block would invent the English script it
 * was meant to be translating — which reads fine and is wrong.
 *
 * It goes through `advance` rather than building its own payload so that there
 * is exactly one place that decides transport, routing and frames. Putting the
 * row back to `queued` first is what makes the section eligible there, and is
 * also what "write this one again" means for a section that is already done.
 */
export async function queueSection(runId: string, sectionId: string): Promise<Run> {
  const run = await getRun(runId);
  if (!run) throw new RunError("No such run", 404);

  const pack = await resolvePack(run.packSlug);
  const def = pack?.sections.find((s) => s.id === sectionId);
  const row = run.sections.find((s) => s.id === sectionId);
  if (!pack || !def || !row) throw new RunError("No such section", 404);

  const done = new Set(
    run.sections.filter((s) => s.state === "done" && s.content).map((s) => s.id),
  );
  const waiting = def.dependsOn.filter((d) => !done.has(d));
  if (waiting.length) {
    const names = waiting.map(
      (d) => pack.sections.find((s) => s.id === d)?.title ?? d,
    );
    throw new RunError(`Needs ${names.join(" and ")} first`, 409);
  }

  if (row.state !== "queued") {
    await setSection(runId, sectionId, { state: "queued", error: "" });
  }
  await advance(runId);
  return (await getRun(runId))!;
}

/**
 * Stop a run that is writing.
 *
 * Cancelling the jobs is the whole of it on this side: a queued job stops
 * being work, and a claimed one keeps running for up to fifteen seconds until
 * its next heartbeat puts it in `drop` and the machine kills the child
 * process. There is no way to reach into somebody's laptop and no need for
 * one.
 *
 * The sections that were `writing` go back to `queued` afterwards, and it is
 * safe here for the reason it is never safe at boot: their jobs have just been
 * cancelled, so nothing is writing them — that is a fact rather than the
 * assumption `resumeOrphans` used to make about processes.
 */
export async function stopRun(runId: string): Promise<{
  stopped: number;
  requeued: number;
}> {
  const stopped = (await cancelJobs(runId)).length;
  const requeued = await requeueWriting(runId);
  const run = await getRun(runId);
  // Back on the pile it can be started from, the same as a failure: a topic
  // left on "generating" after somebody pressed Stop has nothing to move it.
  if (run?.topicId && stopped) await updateTopic(run.topicId, { status: "idea" });
  return { stopped, requeued };
}

/**
 * Is anything actually working on this run?
 *
 * Read from the queue, not from a Set in this process's memory. `isDriving`
 * could only ever see what one Node process was doing, so with two API
 * replicas — or an API and a worker — it answered "no" about work that was
 * very much happening.
 */
export async function isRunning(runId: string): Promise<boolean> {
  const jobs = await jobsForRun(runId);
  if (jobs.some((j) => j.state === "queued" || j.state === "claimed")) return true;

  /*
   * The API fallback has no job row, and is still work in flight.
   *
   * `writeOnServer` runs in this process rather than being handed to a
   * machine, so the queue knows nothing about it. Answering "not running"
   * while the server is four minutes into writing a section made the page drop
   * to its settled cadence and sit there, which reads as a run that stopped —
   * the one thing every part of this design is arranged to prevent.
   *
   * A `writing` row with no live job behind it is that case: a cancel requeues
   * such rows, and a reaped job marks its section failed, so neither leaves
   * one behind.
   */
  const run = await getRun(runId);
  return Boolean(run?.sections.some((x) => x.state === "writing"));
}

/**
 * Delete a run, and stop its work first.
 *
 * The order matters. `runs` cascades to `jobs`, so deleting the row first
 * would leave a machine four minutes into writing a section for a run that no
 * longer exists, posting a result the server can only throw away. Cancelling
 * first means its next heartbeat tells it to stop.
 */
export async function removeRun(runId: string): Promise<boolean> {
  await cancelJobs(runId);
  return deleteRunRow(runId);
}

/**
 * Replace a section's text with what a person typed.
 *
 * Its own function rather than a flag on a write: nothing is generated,
 * nothing is charged, and the dependency checks that guard a real run would be
 * meaningless here — you are allowed to fix a sentence in section 9 without
 * section 8 being finished.
 */
export async function editSection(
  runId: string,
  sectionId: string,
  content: string,
): Promise<Run> {
  const run = await getRun(runId);
  if (!run) throw new RunError("No such run", 404);
  if (!run.sections.some((s) => s.id === sectionId)) {
    throw new RunError("No such section on this run", 404);
  }

  await setSection(runId, sectionId, {
    content,
    // Saved text is finished text, even into a section that had failed: what
    // is on screen is now what a person put there.
    state: "done",
    error: "",
    edited: true,
  });
  return (await getRun(runId))!;
}

