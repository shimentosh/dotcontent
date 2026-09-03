import fs from "node:fs";
import path from "node:path";

import { PROJECTS } from "@/lib/data";
import { SEED_SERIES } from "@/lib/topics";
import {
  countWorkspaces,
  createWorkspace,
} from "@/lib/server/repos/workspaces";
import {
  addTopics,
  createSeries,
  updateSeries,
  updateTopic,
} from "@/lib/server/repos/series";
import { createRun, setSection } from "@/lib/server/repos/runs";
import { seedPacks } from "@/lib/server/repos/packs";
import { seedTools } from "@/lib/server/repos/tools";

/**
 * What a brand new database starts with.
 *
 * Runs once, on the first request to hit an empty file, and never again — the
 * check is "are there any workspaces", so deleting your last one does not
 * bring the samples back on the next reload. That was the failure mode of the
 * old JSON-file version and the reason this is a count rather than a flag.
 *
 * It also carries across anything the file-backed version left behind, so the
 * work already generated is not stranded by the move to a database.
 */
export async function seedIfEmpty() {
  /*
   * The pack library is seeded on its own count.
   *
   * A console can have workspaces and no packs — every install before the
   * packs table existed does — so gating this on the workspace count would
   * leave those with an empty library and no way to get the shipped pack back.
   */
  await seedPacks();
  // Same rule as the packs above, and the same reason: a console that predates
  // the tools table has workspaces already, and gating on their count would
  // leave it with an empty bench.
  await seedTools();

  if ((await countWorkspaces()) > 0) return;

  for (const p of PROJECTS) {
    const ws = await createWorkspace({
      name: p.name,
      handle: p.handle,
      channel: p.channel,
      status: p.status,
      goal: p.goal,
      brandVoice: p.brandVoice,
      langs: p.langs,
      tint: p.tint,
      photo: p.photo,
    });

    // Only the first workspace gets the sample shelves. Seeding every brand
    // with the same series is how a demo ends up with four identical AI
    // categories nobody asked for.
    if (p !== PROJECTS[0]) continue;

    for (const s of SEED_SERIES) {
      const series = await createSeries({
        workspaceId: ws.id,
        name: s.name,
        context: s.context,
        pack: s.pack,
        nextPart: s.nextPart,
      });
      // Written with their existing part numbers rather than renumbered from
      // one: those numbers are on screen today, and the counter above already
      // starts past the highest of them.
      for (const topic of s.topics) {
        const [made] = (
          await addTopics(series.id, [
            { name: topic.name, context: topic.context, status: topic.status },
          ])
        ).added;
        // addTopics assigns from the counter; the seeded part wins, and the
        // counter is put back below so the next real topic still follows on.
        if (made && topic.part !== null)
          await updateTopic(made.id, { part: topic.part });
      }
      await updateSeries(series.id, { nextPart: s.nextPart });
    }

    await importFileRuns(ws.id);
  }
}

/**
 * Runs written by the file-backed version, brought into the database.
 *
 * Real generated content, and the whole reason this is not simply deleted:
 * a Squoosh package that took ten minutes of model time should not disappear
 * because the storage underneath it changed.
 */
async function importFileRuns(workspaceId: string) {
  const dir = path.join(process.cwd(), ".data", "runs");
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith(".json"));
  } catch {
    return;
  }

  for (const name of names) {
    try {
      const old = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as {
        packSlug: string;
        title: string;
        inputs: Record<string, string>;
        brandVoice?: string;
        sections: {
          id: string;
          title: string;
          state: string;
          content: string;
          error: string;
          ms: number | null;
        }[];
      };

      const run = await createRun({
        workspaceId,
        packSlug: old.packSlug,
        title: old.title,
        inputs: old.inputs ?? {},
        brandVoice: old.brandVoice ?? "",
        sections: old.sections.map((s) => ({ id: s.id, title: s.title })),
      });

      for (const s of old.sections) {
        await setSection(run.id, s.id, {
          state: s.state as "queued" | "writing" | "done" | "failed",
          content: s.content,
          error: s.error,
          ms: s.ms,
        });
      }
    } catch {
      // One unreadable file must not stop the rest of the import.
    }
  }
}
