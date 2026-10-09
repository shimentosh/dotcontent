/**
 * What every run hands its prompts, and what to call it in one.
 *
 * `{{part_number}}` has worked in a section prompt since the engine was
 * written, and nothing anywhere said so — the four keys were spelled out in
 * the run sheet, read by `interpolate`, and mentioned to a person nowhere. A
 * placeholder nobody can discover is a feature nobody has.
 *
 * One list, so the sheet that fills them and the builder that offers them
 * cannot disagree about what exists.
 */

export type RunInput = {
  /** The name inside the braces. */
  key: string;
  /** What it is called on screen. */
  label: string;
  /** One line: where the value comes from. */
  from: string;
};

export const RUN_INPUTS: readonly RunInput[] = [
  {
    key: "topic",
    label: "Topic",
    from: "The topic's own name: a product, a keyword, an idea, or a link.",
  },
  {
    key: "series",
    label: "Series",
    from: "The name of the shelf the topic stands on.",
  },
  {
    key: "part",
    label: "Part",
    from: 'The whole thing, as the series names it: "Episode 07". Empty on a series that does not number.',
  },
  {
    key: "part_number",
    label: "Part number",
    from: 'Just the number: "07". Empty on a series that does not number.',
  },
  {
    key: "part_label",
    label: "Part word",
    from: 'Just the word: "Episode". Chosen on the series, under Numbering.',
  },
  {
    key: "series_context",
    label: "Series brief",
    from: "What the shelf is about — the themes you typed, or the headlines it read off the web.",
  },
  {
    key: "website_url",
    label: "Website URL",
    from: "The topic, when the topic is a link. Empty otherwise.",
  },
  {
    key: "extra_instruction",
    label: "Topic context",
    from: "Whatever was written in the topic's own context box.",
  },
];

/** `{{key}}`, as it is typed into a prompt. */
export const placeholder = (key: string) => `{{${key}}}`;
