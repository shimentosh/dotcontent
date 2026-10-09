import { WRITE_RULES } from "./shared";
import type { Pack } from "./website-shorts";

/**
 * Social Media Post Pack: one idea, written once for every platform.
 *
 * The example of a template whose sections are parallel rather than a chain.
 * Only the angle runs first; every platform is then written from it at once,
 * and the first comments wait for the posts they sit under.
 */
export const SOCIAL_POST_PACK: Pack = {
  slug: "social-post-pack",
  name: "Social Media Post Pack",
  description:
    "One idea becomes ready-to-post content for Facebook, Instagram, LinkedIn and X: statuses, captions, a thread, the first comment under each, and hashtags.",
  version: 1,
  purpose: `Turn one idea into a post for every platform, each written the way that
platform is actually read, so it can go out today without rewriting.

A post earns a stop, then a reaction. The first line decides the first, and
the question or the take at the end decides the second. The first comment is
part of the post: it carries the link, adds the extra detail, or starts the
conversation the post was too short to hold.`,
  inputs: [
    { key: "topic", label: "What the post is about", type: "text", required: true, placeholder: "3 mistakes people make when pricing a service" },
    { key: "extra_instruction", label: "Notes", type: "textarea", hint: "Optional. A story, a number, an offer, a link to mention." },
    { key: "website_url", label: "A page to work from", type: "url", hint: "Optional." },
  ],
  rules: `You are a social media manager who writes native posts for each
platform rather than one post pasted everywhere.

PLATFORMS.
Facebook is conversational and rewards questions. Instagram is read on a
phone: the first line has to stand alone before "more", and line breaks
matter. LinkedIn is first person and professional without being stiff. X is
short, direct and opinionated.

EMOJIS AND HASHTAGS.
At most two emojis in a post, and none when the brand voice says so.
Hashtags go only where they are asked for, never in the middle of a sentence.

${WRITE_RULES}`,
  sections: [
    {
      id: "angle",
      title: "Core message and angle",
      summary: "The one point every post makes",
      dependsOn: [],
      tier: "standard",
      instruction: `Decide what the posts about "{{topic}}" will say.

Return:
- THE POINT: the single takeaway, in one sentence
- THREE ANGLES: a story, a practical tip, and an opinion, one line each
- CHOSEN ANGLE: the strongest of the three for this audience, and why in one line
- CALL TO ACTION: what a reader should do after reading`,
    },
    {
      id: "facebook",
      title: "Facebook posts",
      summary: "A short status, a story post and a question post",
      dependsOn: ["angle"],
      tier: "standard",
      instruction: `Write three Facebook posts from the chosen angle:

1) STATUS: one or two lines, the kind a person posts between other things.
2) STORY POST: 80 to 150 words, a small moment that makes the point.
3) QUESTION POST: a short setup that ends in a question people want to answer in the comments.`,
    },
    {
      id: "instagram",
      title: "Instagram caption",
      summary: "Hook line, value, CTA, plus alternative first lines",
      dependsOn: ["angle"],
      tier: "standard",
      instruction: `Write one Instagram caption: a first line that works on its own before
"more", then the value in short lines with breaks between them, then the
call to action. 80 to 150 words.

Then give 3 alternative first lines in different tones.`,
    },
    {
      id: "linkedin",
      title: "LinkedIn post",
      summary: "First person, short lines, ends in a question",
      dependsOn: ["angle"],
      tier: "standard",
      instruction: `Write one LinkedIn post, 120 to 220 words, in the first person. The
first line is a hook a professional would stop for. Short lines, one idea
per line. Share something specific: a mistake, a number, a lesson. End with
a question that invites experience rather than agreement.`,
    },
    {
      id: "x",
      title: "X posts and thread",
      summary: "Three single posts and one thread",
      dependsOn: ["angle"],
      tier: "cheap",
      instruction: `Write for X:

1) Three single posts, each under 280 characters, each a different take.
2) One thread of 5 posts: the first makes a promise, the middle three deliver it, the last sums up and asks for a reply or a repost. Number them 1/5 to 5/5.`,
    },
    {
      id: "first-comment",
      title: "First comments",
      summary: "The comment you post under each one yourself",
      dependsOn: ["facebook", "instagram", "linkedin"],
      tier: "cheap",
      instruction: `Write the first comment to post under each piece above, one each for
Facebook, Instagram and LinkedIn. A first comment never repeats the post.
It does one of three things: adds the link as [LINK] with a reason to click,
adds a useful extra detail, or asks a follow-up question that is easy to
answer. One to three lines each.`,
    },
    {
      id: "hashtags",
      title: "Hashtags",
      summary: "A set sized for each platform",
      dependsOn: ["angle"],
      tier: "cheap",
      instruction: `Give hashtags sized for each platform, specific to the topic rather than
generic (#motivation, #viral and #fyp are never right):

- INSTAGRAM: 5 to 8
- LINKEDIN: 3
- FACEBOOK: 0 to 3
- X: 1 or 2`,
    },
  ],
  outputs: [
    { key: "facebook", label: "Facebook", sections: ["facebook"] },
    { key: "instagram", label: "Instagram", sections: ["instagram"] },
    { key: "linkedin", label: "LinkedIn", sections: ["linkedin"] },
    { key: "x", label: "X", sections: ["x"] },
    { key: "extras", label: "First comments and hashtags", sections: ["first-comment", "hashtags"] },
    { key: "angle", label: "The angle", sections: ["angle"] },
  ],
};
