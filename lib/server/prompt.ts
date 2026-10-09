import type { Pack, PackSectionDef } from "@/lib/packs/website-shorts";

/**
 * How a section's prompt is built.
 *
 * The same three-part shape the working system used, kept because it is what
 * the instructions were written against:
 *
 *   SYSTEM  = the workspace's brand voice, the pack's purpose, then its rules
 *   USER    = the inputs, then every dependency's finished text, then the task
 *
 * The dependency text matters more than it looks. A section never re-derives
 * what an earlier one established — the Bangla script is handed the English
 * script rather than the research, so the two cannot drift apart.
 */

/**
 * `{{key}}` in an instruction is replaced by the run's input of that name.
 *
 * Supplied and empty is not the same as never supplied, and they cannot have
 * the same outcome. A topic on a shelf that does not number parts has a part
 * number of nothing — the right result is the braces disappearing, not the
 * model being handed the literal characters `{{part_number}}` and left to
 * decide what they meant. A key the run has never heard of is a typo, and
 * that one stays on the page, because a prompt silently missing a line reads
 * exactly like a prompt that was written that way.
 */
export function interpolate(text: string, inputs: Record<string, string>) {
  return text.replace(/\{\{(\w+)\}\}/g, (whole, key: string) =>
    key in inputs ? inputs[key].trim() : whole,
  );
}

export function systemPrompt(
  pack: Pack,
  inputs: Record<string, string>,
  brandVoice: string,
) {
  /*
   * Voice, then purpose, then rules.
   *
   * The voice is whose account this is — who is watching, and how they are
   * spoken to — and a pack cannot overrule it. The purpose is what THIS pack
   * is trying to achieve, which is a property of the recipe rather than the
   * brand: the same pack run by two workspaces has one purpose and two
   * audiences, and only one of those belongs here.
   *
   * The purpose sits ABOVE the rules because it is the reason they exist. A
   * rule read without knowing what it is for gets followed literally; read
   * after "this has to earn a save and a comment", it gets followed sensibly.
   */
  const purpose = pack.purpose?.trim()
    ? `WHAT THIS PACK IS FOR:\n${pack.purpose.trim()}`
    : "";

  return [
    brandVoice.trim(),
    interpolate(purpose, inputs).trim(),
    interpolate(pack.rules, inputs).trim(),
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function userPrompt(
  section: PackSectionDef,
  pack: Pack,
  inputs: Record<string, string>,
  /** Finished text of every section, by id. */
  done: Record<string, string>,
  /** What was pulled out of the source video, when the run has one. */
  source = "",
) {
  const parts: string[] = [];

  /*
   * The video first, before the inputs.
   *
   * It is the evidence: the transcript, the caption and the stills are what
   * the first two sections are supposed to be reading, and burying them under
   * a list of form fields is how a model comes to answer from the form fields.
   */
  /*
   * The evidence, whatever kind it is, and its own heading.
   *
   * This used to hard-code "THE SOURCE VIDEO", which was right when a reel was
   * the only thing that could be attached. A page read off the site is the
   * same job — first-hand material to answer from — so the caller now hands
   * the whole block, heading included, and this only places it.
   */
  if (source.trim()) parts.push(source.trim());

  const supplied = Object.entries(inputs).filter(([, v]) => v?.trim());
  if (supplied.length) {
    parts.push(
      `INPUTS:\n${supplied.map(([k, v]) => `- ${k}: ${v}`).join("\n")}`,
    );
  }

  const upstream = section.dependsOn
    .map((id) => {
      const text = done[id];
      if (!text?.trim()) return null;
      const title = pack.sections.find((s) => s.id === id)?.title ?? id;
      return `--- ALREADY GENERATED: ${title} ---\n${text.trim()}`;
    })
    .filter(Boolean);
  if (upstream.length) parts.push(upstream.join("\n\n"));

  parts.push(
    `YOUR TASK — produce ONLY this section:\n\n## ${section.title}\n\n${interpolate(
      section.instruction,
      inputs,
    )}`,
  );

  return parts.join("\n\n");
}

/**
 * The order sections can run in, as waves.
 *
 * Everything in one wave has its dependencies satisfied by the waves before it,
 * so a wave can run in parallel. Returned as waves rather than a flat list
 * because "which of these can go at once" is the only scheduling question this
 * has, and a flat list throws that answer away.
 */
export function plan(pack: Pack): string[][] {
  const waves: string[][] = [];
  const placed = new Set<string>();

  while (placed.size < pack.sections.length) {
    const wave = pack.sections
      .filter((s) => !placed.has(s.id))
      .filter((s) => s.dependsOn.every((d) => placed.has(d)))
      .map((s) => s.id);

    // A section depending on something that does not exist would loop forever;
    // stopping with a short plan is better than hanging the request.
    if (!wave.length) break;
    wave.forEach((id) => placed.add(id));
    waves.push(wave);
  }

  return waves;
}
