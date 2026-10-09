import { WRITE_RULES } from "./shared";
import type { Pack } from "./website-shorts";

/**
 * Repurpose a Video: one recording, a week of content.
 *
 * The example of a template that works from a source. Paste the video's link
 * in the run sheet and the worker downloads it, cuts stills and transcribes
 * it; every section then answers from that transcript rather than from the
 * topic's name.
 */
export const REPURPOSE_VIDEO: Pack = {
  slug: "repurpose-video",
  name: "Repurpose a Video",
  description:
    "Paste a video link and get a week of content from it: key takeaways and quotes, short clip ideas, a blog article, posts for LinkedIn, Facebook and X, an Instagram carousel, and first comments.",
  version: 1,
  purpose: `Turn one video that already exists into a week of content, every piece
pulled from what the video actually says.

The video is the source of truth. A post that says something the speaker
never said is worse than no post, because it puts words in their mouth. The
best lines are usually already in the transcript: find them, keep them
word for word, and build around them.`,
  inputs: [
    { key: "topic", label: "What the video is about", type: "text", required: true, placeholder: "Podcast episode 12: pricing your first product", hint: "Paste the video's link in the run sheet, so it is downloaded and transcribed." },
    { key: "extra_instruction", label: "Notes", type: "textarea", hint: "Optional. Which part matters most, a link to promote." },
  ],
  rules: `You are a content editor who turns long recordings into posts.

THE SOURCE.
Work from THE SOURCE VIDEO block above: its transcript, caption and stills.
Quote the speaker only with words that are in the transcript, exactly. If no
source video was supplied, say so in one line at the top of the section and
work from the topic and notes instead, without inventing quotes.

${WRITE_RULES}`,
  sections: [
    {
      id: "takeaways",
      title: "Key takeaways and quotes",
      summary: "What the video says, in its own words",
      dependsOn: [],
      tier: "standard",
      instruction: `Pull out what the video says about "{{topic}}":

- CORE MESSAGE: one sentence
- KEY POINTS: 5 to 8, one line each, in the order they come up
- QUOTABLE LINES: 5 to 8, word for word from the transcript
- NUMBERS AND EXAMPLES: every figure, name or example the speaker gives`,
    },
    {
      id: "clips",
      title: "Short clip ideas",
      summary: "3 to 5 cuts for Reels, Shorts and TikTok",
      dependsOn: ["takeaways"],
      tier: "standard",
      instruction: `Suggest 3 to 5 short clips (15 to 60 seconds) to cut from the video. For
each: the QUOTE it opens on (word for word), what it covers, why it works on
its own, an ON-SCREEN CAPTION of up to 8 words, and a one-line post caption.`,
    },
    {
      id: "blog",
      title: "Blog article",
      summary: "The video, written up as an article",
      dependsOn: ["takeaways"],
      tier: "high",
      instruction: `Write a blog article of 700 to 1,000 words from the video. A title, an
introduction that says what the reader will learn, one H2 per key point,
two or three of the quotable lines as blockquotes, and a closing that
points to the full video as [VIDEO LINK].`,
    },
    {
      id: "posts",
      title: "Social posts",
      summary: "LinkedIn, Facebook, X and an Instagram carousel",
      dependsOn: ["takeaways"],
      tier: "standard",
      instruction: `Write posts from the video, each built around a different key point:

- LINKEDIN: 120 to 200 words, first person, ends in a question.
- FACEBOOK: a short status of one or two lines, and a longer post of 80 to 120 words.
- X: a thread of 5 posts, numbered 1/5 to 5/5.
- INSTAGRAM CAROUSEL: 7 slides, slide by slide (Slide 1 is the hook, the last is the call to action), each with at most 20 words, then the caption.`,
    },
    {
      id: "first-comment",
      title: "First comments and hashtags",
      summary: "What to post under each one",
      dependsOn: ["posts"],
      tier: "cheap",
      instruction: `For each post above, write the first comment to add under it: the full
video as [VIDEO LINK] with one line on why to watch it, or a question that
continues the conversation. Then hashtags: 5 to 8 for Instagram, 3 for
LinkedIn, 1 or 2 for X.`,
    },
  ],
  outputs: [
    { key: "clips", label: "Clips", sections: ["clips"] },
    { key: "blog", label: "Blog article", sections: ["blog"] },
    { key: "posts", label: "Posts", sections: ["posts", "first-comment"] },
    { key: "notes", label: "Takeaways", sections: ["takeaways"] },
  ],
};
