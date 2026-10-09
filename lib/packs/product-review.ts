import { WRITE_RULES } from "./shared";
import type { Pack } from "./website-shorts";

/**
 * Honest Product Review: researched once, published everywhere.
 *
 * The example of a template that crosses formats. The research and the
 * verdict are written once, and the video script, the written review and the
 * posts are all handed the same verdict, so the three cannot disagree about
 * whether the product is worth it.
 */
export const PRODUCT_REVIEW: Pack = {
  slug: "product-review",
  name: "Honest Product Review",
  description:
    "One product becomes a trustworthy review in every format: verdict with pros and cons, a video script, a written review for your blog, a social caption with first comment, and YouTube copy.",
  version: 1,
  purpose: `Write a review people trust enough to act on.

Trust comes from leading with the catch. Say what is wrong with the product
before what is right, say exactly who should skip it, and only then say who
it is for. A review that only praises reads as an advert, and nobody buys
from an advert they have recognised.`,
  inputs: [
    { key: "topic", label: "Product", type: "text", required: true, placeholder: "Kindle Paperwhite (2024)" },
    { key: "website_url", label: "Product page", type: "url", hint: "Optional. The official page, for specs and price." },
    { key: "extra_instruction", label: "Your own notes", type: "textarea", hint: "What you found using it. This is first-hand, and the review leans on it." },
  ],
  rules: `You are an independent reviewer. You are not paid by the brand, and the
review has to read that way.

HONESTY.
Lead with the catch. Every claim is something a buyer could check. No
superlatives, no urgency, no "limited time". The reviewer's own notes in the
inputs are first-hand experience: use them, and say when a point comes from
them. Anything else about the product comes only from the page supplied
above; what is not there is UNVERIFIED.

AFFILIATE LINKS.
Wherever a link goes, write [AFFILIATE LINK] and add a one-line disclosure
that the link may earn a commission.

${WRITE_RULES}`,
  sections: [
    {
      id: "research",
      title: "Product facts",
      summary: "What it is, what it costs, what it competes with",
      dependsOn: [],
      tier: "high",
      instruction: `Gather the facts about "{{topic}}".

Return: PRODUCT, MADE BY, PRICE, WHAT IT DOES, KEY SPECS or FEATURES (up to
8), WHAT IS IN THE BOX, MAIN ALTERNATIVES (2 or 3, with one line on how they
differ), and FROM THE REVIEWER'S NOTES (what the notes in the inputs say,
kept separate). Mark anything not in the supplied material as UNVERIFIED.`,
    },
    {
      id: "verdict",
      title: "Verdict, pros and cons",
      summary: "The judgement every other section repeats",
      dependsOn: ["research"],
      tier: "standard",
      instruction: `Decide the verdict, from the facts above:

- THE CATCH: the most important downside, in one sentence
- CONS: 2 to 4
- PROS: 3 to 5
- BUY IT IF: who it is right for
- SKIP IT IF: who should not buy it, and what they should look at instead
- VERDICT: one sentence
- SCORE: out of 10, with the one reason it is not higher`,
    },
    {
      id: "script",
      title: "Video review script",
      summary: "45 to 60 seconds, catch first",
      dependsOn: ["research", "verdict"],
      tier: "high",
      instruction: `Write a 45 to 60 second review video script. Open with the catch, not
the unboxing. Then what is good, who it is for, who should skip it, and the
verdict. End with the call to action (the link is in the description or the
first comment).

Put on-screen text in [TEXT: ...] and suggested shots in [SHOT: ...] on
their own lines, so the script can be filmed from as it is.`,
    },
    {
      id: "blog",
      title: "Written review",
      summary: "A blog review with a summary box",
      dependsOn: ["research", "verdict"],
      tier: "high",
      instruction: `Write the review as a blog post, 800 to 1,200 words.

Start with a SUMMARY box: the verdict, the score, three pros and two cons,
and BUY IT IF / SKIP IT IF. Then these sections as H2s: What it is; What is
good; What is not; Who should buy it; Alternatives; Verdict. Put the
affiliate disclosure under the summary box.`,
    },
    {
      id: "caption",
      title: "Social caption and first comment",
      summary: "For Instagram, Facebook and TikTok",
      dependsOn: ["verdict"],
      tier: "standard",
      instruction: `Write one social caption for the review video (60 to 120 words): the
catch as the first line, the verdict, who it is for, and "link in the first
comment".

Then the FIRST COMMENT: the [AFFILIATE LINK], one line on what it is, and
the disclosure.`,
    },
    {
      id: "youtube",
      title: "YouTube title and description",
      summary: "5 titles and a description with disclosure",
      dependsOn: ["verdict", "script"],
      tier: "standard",
      instruction: `Write the YouTube copy:

1) TITLES: 5 options, 50 to 70 characters, honest ("after 3 months", "the catch", "worth it?") rather than clickbait.
2) DESCRIPTION: two lines that sum up the verdict, then the pros and cons as a list, then [AFFILIATE LINK] with the disclosure, then 8 to 12 comma-separated tags.`,
    },
  ],
  outputs: [
    { key: "video", label: "Video", sections: ["script", "youtube"] },
    { key: "blog", label: "Written review", sections: ["blog"] },
    { key: "social", label: "Social", sections: ["caption"] },
    { key: "notes", label: "Research and verdict", sections: ["research", "verdict"] },
  ],
};
