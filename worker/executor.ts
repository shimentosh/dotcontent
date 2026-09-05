import { loadConfig } from "./config";
import { Api } from "./api";
import { ingestSource } from "./ingest-source";
import { RESULT_MARK, Refusal } from "./job-types";
import type {
  IngestPayload,
  TestPayload,
  TranscribePayload,
  WritePayload,
} from "./job-types";
import { testBrain } from "./test-brain";
import { transcribeAudio } from "./transcribe-audio";
import { writeSection } from "./write-section";

/**
 * One job, in a process of its own.
 *
 * The supervisor could call these functions directly and the code would be
 * shorter. It runs them here instead for one reason, and it is the reason the
 * protocol has a `drop` list at all: when the server takes a job back — a Stop
 * button, a lease reaped while a laptop slept — the worker is supposed to
 * **kill the child process** rather than spend four more minutes producing
 * something the server will refuse. `run()` in `lib/server/tools.ts` returns a
 * promise and keeps its `ChildProcess` to itself, so there is nothing to kill
 * from the outside; a whole process that can be killed as a tree is.
 *
 * It buys two more things worth having on somebody's own desktop. A CLI that
 * wedges, leaks or dies takes only its own job down, and the supervisor keeps
 * heartbeating for the others. And the temp directory of a killed job is
 * cleaned by the next start's sweep rather than being lost with the code that
 * would have removed it.
 *
 * The cost is a serialisation boundary: the job arrives on stdin as JSON and
 * the answer leaves on stdout behind `RESULT_MARK`, because a CLI or a library
 * can print to stdout at any time and the last line is not reliably ours.
 */

type Incoming = { id: string; kind: string; payload: Record<string, unknown> };

async function main() {
  const job = JSON.parse(await readAll()) as Incoming;
  const cfg = loadConfig();
  const api = new Api(cfg);

  switch (job.kind) {
    case "write_section":
      return writeSection(cfg, api, job.id, job.payload as unknown as WritePayload);
    case "ingest_source":
      return ingestSource(cfg, api, job.id, job.payload as unknown as IngestPayload);
    case "transcribe_audio":
      return transcribeAudio(cfg, api, job.id, job.payload as unknown as TranscribePayload);
    case "test_brain":
      return testBrain(cfg, job.payload as unknown as TestPayload);
    default:
      /*
       * A kind this worker has never heard of.
       *
       * Not retryable: every machine on the estate is running some version of
       * this file, and a newer server that invented a kind will get the same
       * answer from all of them. The sentence names the machine's own
       * staleness, because that is the thing somebody can act on.
       */
      throw new Refusal(
        `This machine's worker does not know how to run a "${job.kind}" job. Update the worker on this machine.`,
      );
  }
}

main().then(
  (result) => done({ ok: true, result }),
  (e: unknown) =>
    done({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      // A `Refusal` is this machine saying "the next one will fail the same
      // way": a bad payload, a transport it cannot honour, a tool that is not
      // here. Everything else gets the one retry, because the failures that
      // actually recur are the closed laptop and the dropped connection.
      retryable: !(e instanceof Refusal),
    }),
);

function done(answer: unknown) {
  process.stdout.write(`\n${RESULT_MARK}${JSON.stringify(answer)}\n`, () => {
    // Written, then out — `process.exit` on Windows can truncate a pipe that
    // has not flushed, and the truncated line is the one carrying the answer.
    process.exit(0);
  });
}

/** The whole job off stdin, because a payload is thousands of characters. */
function readAll() {
  return new Promise<string>((resolve, reject) => {
    let text = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (text += chunk));
    process.stdin.on("end", () => resolve(text));
    process.stdin.on("error", reject);
  });
}
