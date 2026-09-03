import { describe, expect, it } from "vitest";

import { parse } from "@/lib/server/services/researcher";

/**
 * What the researcher can make of an answer.
 *
 * The model is asked for bare JSON and reliably sends back something else: a
 * fenced block, a sentence of preamble, occasionally both. Every one of those
 * failures reads as "the tool found nothing" rather than as an error, so this
 * is the parse that has to be forgiving.
 */
describe("parse", () => {
  it("reads plain JSON", () => {
    expect(parse('{"site":{"name":"remove.bg"}}')).toEqual({
      site: { name: "remove.bg" },
    });
  });

  it("reads it out of a code fence", () => {
    const answer = 'Here you go:\n\n```json\n{"does":"removes backgrounds"}\n```';
    expect(parse(answer)).toEqual({ does: "removes backgrounds" });
  });

  it("reads it out of an unlabelled fence", () => {
    expect(parse('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("finds the object inside prose on both sides", () => {
    const answer = 'I looked at the frames.\n{"a":1}\nHope that helps.';
    expect(parse(answer)).toEqual({ a: 1 });
  });

  it("returns null rather than throwing on nonsense", () => {
    expect(parse("I could not see the frames.")).toBeNull();
    expect(parse('{"a": ')).toBeNull();
    expect(parse("")).toBeNull();
  });

  it("keeps nested objects whole", () => {
    const answer = '{"ideas":[{"title":"one","angle":"a"},{"title":"two"}]}';
    expect((parse(answer) as { ideas: unknown[] }).ideas).toHaveLength(2);
  });
});
