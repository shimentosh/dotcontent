import { WRITE_RULES } from "./shared";
import type { Pack } from "./website-shorts";

/**
 * Product Launch Campaign: a whole launch, from teaser to reminder.
 *
 * The example of a campaign template for a brand or a client. One brief is
 * agreed first, and every channel is written from it, so the teasers, the
 * launch posts, the emails and the ads all promise the same thing.
 */
export const LAUNCH_CAMPAIGN: Pack = {
  slug: "launch-campaign",
  name: "Product Launch Campaign",
  description:
    "A product or offer becomes a complete launch: positioning brief, teaser posts for the week before, launch-day posts with first comments, launch and reminder emails, a short video script, and ad copy.",
  version: 1,
  purpose: `Plan and write a launch that builds up before it lands.

Teasers create curiosity without giving the product away. Launch day
explains it clearly, with one action. The follow-up reaches the people who
meant to act and did not. Every piece repeats the same promise in its own
format, because a launch that says something different on every channel is
remembered for none of them.`,
  inputs: [
    { key: "topic", label: "Product or offer", type: "text", required: true, placeholder: "Acme Glow Vitamin C Serum" },
    { key: "extra_instruction", label: "Launch details", type: "textarea", hint: "Launch date, price, offer, link, anything already decided. What is missing becomes a [PLACEHOLDER]." },
    { key: "website_url", label: "Product page", type: "url", hint: "Optional." },
  ],
  rules: `You are a launch copywriter working with a brand team.

CONSISTENCY.
The brief decides the promise, the audience and the offer. Every later
section uses them exactly; none invents a new benefit, a discount or a date.
Missing details stay as placeholders: [LAUNCH DATE], [PRICE], [OFFER],
[LINK].

ADS.
Ad copy follows the platforms' rules: no claims of guaranteed results, no
before-and-after promises, and nothing aimed at personal attributes ("Are
you overweight?").

${WRITE_RULES}`,
  sections: [
    {
      id: "brief",
      title: "Launch brief",
      summary: "The promise every piece repeats",
      dependsOn: [],
      tier: "standard",
      instruction: `Write the launch brief for "{{topic}}":

- WHAT IT IS: one sentence
- FOR WHOM: the audience, specifically
- THE PROBLEM it solves
- THE PROMISE: the one main benefit
- PROOF: reasons to believe, only from the material supplied
- THE OFFER: price, discount and deadline, as given or as placeholders
- LAUNCH DATE and LINK, as given or as placeholders
- THE ONE ACTION we want people to take`,
    },
    {
      id: "teasers",
      title: "Teaser posts",
      summary: "Seven, three and one day before",
      dependsOn: ["brief"],
      tier: "standard",
      instruction: `Write three teaser posts for Instagram and Facebook, for 7 days, 3 days
and 1 day before launch. Each builds curiosity about the problem or the
promise without revealing the product in full. For each: the caption (40 to
90 words) and a STORY text (one to two short lines for a story slide).`,
    },
    {
      id: "launch-posts",
      title: "Launch-day posts",
      summary: "Instagram, Facebook and LinkedIn, with first comments",
      dependsOn: ["brief"],
      tier: "high",
      instruction: `Write the launch-day posts:

- INSTAGRAM caption, 80 to 150 words
- FACEBOOK post, 60 to 120 words
- LINKEDIN post, 120 to 200 words, the story behind the launch

Each says what it is, the promise, the offer and the one action. After each,
a FIRST COMMENT with [LINK] and one line that answers the most likely
question (price, shipping, who it is for).`,
    },
    {
      id: "emails",
      title: "Launch and reminder emails",
      summary: "Launch day, and 48 hours later",
      dependsOn: ["brief"],
      tier: "standard",
      instruction: `Write two emails.

1) LAUNCH EMAIL: 5 subject lines, a preview text, and a body of 200 to 350 words with one call to action.
2) REMINDER, sent 48 hours later to people who did not act: 3 subject lines and a body of 100 to 200 words that answers the main objection and repeats the deadline.`,
    },
    {
      id: "video",
      title: "Launch video script",
      summary: "30 seconds, for Reels, Shorts and TikTok",
      dependsOn: ["brief"],
      tier: "standard",
      instruction: `Write a 30 second launch video script: the problem in the first 3
seconds, the product as the answer, the promise, the offer, the action. Put
on-screen text in [TEXT: ...] and shots in [SHOT: ...] on their own lines.`,
    },
    {
      id: "ads",
      title: "Ad copy",
      summary: "Three variations for Meta ads",
      dependsOn: ["brief"],
      tier: "cheap",
      instruction: `Write three ad variations, each a different angle (the problem, the
result, the offer). For each: PRIMARY TEXT (up to 125 characters for the
part shown before "more"), HEADLINE (up to 40 characters), DESCRIPTION (up
to 30 characters), and the CALL-TO-ACTION button to use.`,
    },
  ],
  outputs: [
    { key: "teasers", label: "Teasers", sections: ["teasers"] },
    { key: "launch", label: "Launch day", sections: ["launch-posts", "video"] },
    { key: "emails", label: "Emails", sections: ["emails"] },
    { key: "ads", label: "Ads", sections: ["ads"] },
    { key: "brief", label: "Brief", sections: ["brief"] },
  ],
};
