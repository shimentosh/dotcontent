import { markUsed, resolve as resolvePack } from "@/lib/server/repos/packs";
import { write } from "@/lib/server/brains";
import { getSettings } from "@/lib/server/repos/settings";
import { sourceBrief } from "@/lib/server/services/ingest";
import { fetchSource } from "@/lib/server/services/webfetch";
import { systemPrompt, userPrompt } from "@/lib/server/prompt";
import { getWorkspace } from "@/lib/server/repos/workspaces";
import { getTopic, updateTopic } from "@/lib/server/repos/series";
import {
  createRun as insertRun,
  getRun,
  requeueFailed,
  requeueOrphans,
  setSection,
  type Run,
} from "@/lib/server/repos/runs";

/**
 * Starting runs, and writing their sections.
 *
 * The rules that are not the database's job and not the route's: which inputs a
 * pack requires, what a section is allowed to run before, and what finishing a
 * section means for the topic that started it.
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
 */
const siteCache = new Map<string, string>();

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

  siteCache.set(key, block);
  return block;
}

/**
 * Replace a section's text with what a person typed.
 *
 * Its own function rather than a flag on writeSection: nothing is generated,
 * nothing is charged, and the dependency checks that guard a real run would be
 * meaningless here — you are allowed to fix a sentence in section 9 without
 * section 8 being finished.
 */
/**
 * Runs being driven to completion, by run id.
 *
 * On `globalThis` because Next re-evaluates modules on every edit in dev, and
 * a module-level map would forget what is in flight — starting a second loop
 * over sections the first one is already writing, against a model that is one
 * local process.
 */
const driving = globalThis as unknown as { __contentosDriving?: Set<string> };
const inFlight = () => (driving.__contentosDriving ??= new Set<string>());

export const isDriving = (runId: string) => inFlight().has(runId);

/**
 * Write everything that is left, in dependency order, without being asked
 * twelve times.
 *
 * Pressing Run used to create a queue and stop. What wrote the sections was a
 * loop in the browser tab, so it needed a second press to start, and closing
 * the tab — or a hot reload, or a navigation — stopped it wherever it was.
 * The work belongs on the server: one section at a time, because the model
 * behind it is a single local process, and it carries on whether or not
 * anybody is watching the page.
 *
 * Returns immediately. Progress is read from the run itself, which is where
 * every section's state has always been recorded.
 */
/**
 * Pick up whatever a previous process left mid-write.
 *
 * Called once, as the API starts: every "writing" row belongs to a driver that
 * died with the last process, so each goes back to queued and its run is
 * driven again. A run that was being written when the server restarted
 * carries on, which is what "carries on whether or not anybody is watching"
 * has to mean across a deploy.
 */
export async function resumeOrphans() {
  const runs = await requeueOrphans();
  for (const id of runs) driveRun(id);
  return runs;
}

export function driveRun(runId: string): { started: boolean } {
  if (isDriving(runId)) return { started: false };
  inFlight().add(runId);

  void (async () => {
    try {
      /*
       * Pressing Run again is a retry.
       *
       * Failures are skipped for the rest of the drive they happen in, by the
       * rule below. Carrying that skip into the NEXT drive would make Run do
       * nothing at all on a run that failed — the one time you are most likely
       * to press it — so the failures go back in the queue here, once, at the
       * point somebody asks for the run again.
       */
      await requeueFailed(runId);
      /*
       * And anything left "writing" by a driver that is no longer here. This
       * driver is the only one for this run — isDriving said so a moment ago —
       * so a writing row is an orphan, not a colleague.
       */
      await requeueOrphans(runId);

      for (;;) {
        const run = await getRun(runId);
        if (!run) return;

        const pack = await resolvePack(run.packSlug);
        if (!pack) return;

        const done = new Set(
          run.sections.filter((x) => x.state === "done").map((x) => x.id),
        );

        /*
         * The next one whose dependencies are all written.
         *
         * A failed section is skipped rather than retried: it has already had
         * its turn, and looping on it would spend the model's time forever on
         * the one thing that does not work. Anything depending on it simply
         * never becomes eligible, and the run ends with those still queued —
         * which is the truth, and visible on the page.
         */
        const next = pack.sections.find((def) => {
          const row = run.sections.find((x) => x.id === def.id);
          return (
            row &&
            row.state !== "done" &&
            row.state !== "failed" &&
            def.dependsOn.every((d) => done.has(d))
          );
        });
        if (!next) return;

        try {
          await writeSection(runId, next.id);
        } catch {
          // writeSection has already recorded the failure on the row; the loop
          // moves to whatever else is ready rather than stopping the lot.
        }
      }
    } finally {
      inFlight().delete(runId);
    }
  })();

  return { started: true };
}

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

/**
 * Write one section.
 *
 * Dependencies are checked here rather than trusted: the client drives the
 * order, so nothing stops it asking for the Bangla script first, and the model
 * handed an empty "ALREADY GENERATED" block would invent the English script it
 * was meant to be translating — which reads fine and is wrong.
 */
export async function writeSection(runId: string, sectionId: string): Promise<Run> {
  const run = await getRun(runId);
  if (!run) throw new RunError("No such run", 404);

  const pack = await resolvePack(run.packSlug);
  const def = pack?.sections.find((s) => s.id === sectionId);
  if (!pack || !def || !run.sections.some((s) => s.id === sectionId)) {
    throw new RunError("No such section", 404);
  }

  const done: Record<string, string> = {};
  for (const s of run.sections) {
    if (s.state === "done" && s.content) done[s.id] = s.content;
  }

  const waiting = def.dependsOn.filter((d) => !done[d]);
  if (waiting.length) {
    const names = waiting.map(
      (d) => pack.sections.find((s) => s.id === d)?.title ?? d,
    );
    throw new RunError(`Needs ${names.join(" and ")} first`, 409);
  }

  await setSection(runId, sectionId, { state: "writing", error: "" });

  const started = Date.now();
  try {
    // The topic stops being an idea the moment something is being written for
    // it. Inside the try: a topic that failed to update must not strand the
    // section in "writing" with the failure recorded nowhere.
    if (run.topicId) await updateTopic(run.topicId, { status: "generating" });

    /*
     * What the video showed, when there was one.
     *
     * The first two sections are written for someone who has watched the reel.
     * Handing them the transcript and the caption is the difference between an
     * answer and "I cannot see the frames" — which is what they returned for
     * as long as nothing downloaded anything.
     */
    const brief = await evidenceFor(run);
    const settings = await getSettings();

    const text = await write(settings.brain, {
      system: systemPrompt(pack, run.inputs, run.brandVoice),
      user: userPrompt(def, pack, run.inputs, done, brief),
      tier: def.tier,
    });

    await setSection(runId, sectionId, {
      state: "done",
      content: text,
      error: "",
      ms: Date.now() - started,
      // These are the model's words again — whatever a person had typed here
      // has just been replaced, so the "edited by hand" mark goes with it.
      edited: false,
    });

    const after = (await getRun(runId))!;
    // Finished means every section landed — which is a fact about the run, so
    // the topic learns it from the run rather than from whoever clicked last.
    if (run.topicId && after.sections.every((s) => s.state === "done")) {
      await updateTopic(run.topicId, { status: "done" });
    }
    return after;
  } catch (e) {
    await setSection(runId, sectionId, {
      state: "failed",
      error: e instanceof Error ? e.message : "The model did not answer",
      ms: Date.now() - started,
    });
    /*
     * Back to an idea, not left mid-write.
     *
     * The run keeps the failure — the section says so, and the row on Content
     * reads "Failed" — while the topic returns to the pile it can be started
     * from again. A topic stuck on "generating" after a run died is the state
     * nothing could get it out of.
     */
    if (run.topicId) await updateTopic(run.topicId, { status: "idea" });
    throw new RunError(
      e instanceof Error ? e.message : "The model did not answer",
      502,
    );
  }
}
