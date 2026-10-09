import { WRITE_RULES } from "./shared";
import type { Pack } from "./website-shorts";

/**
 * SEO Blog Post: one keyword in, a publishable article out.
 *
 * The example of a long-form template. Research decides the angle before a
 * word is written, the outline is agreed before the draft, and the draft is
 * handed both, so the article cannot wander off the search it is meant to win.
 */
export const SEO_BLOG_POST: Pack = {
  slug: "seo-blog-post",
  name: "SEO Blog Post",
  description:
    "A topic or keyword becomes a search-ready article: intent research, outline, titles and meta description, the full post, an FAQ, and the social posts that promote it.",
  version: 1,
  purpose: `Write a blog post that ranks for one search and is worth reading to the end.

The reader arrived with a question. Answer it in the first few sentences,
then go further than the pages already ranking: a clearer explanation, a
real example, a step they missed. A post that ranks and gets closed in ten
seconds has failed, and so has one that is read and never found.`,
  inputs: [
    { key: "topic", label: "Topic or keyword", type: "text", required: true, placeholder: "how to start a podcast on a budget" },
    { key: "website_url", label: "A page to work from", type: "url", hint: "Optional. Your product page, or a source the post should draw on." },
    { key: "extra_instruction", label: "Notes", type: "textarea", hint: "Optional. Your own experience, a point of view, a product to mention." },
  ],
  rules: `You are a senior content writer who writes for search and for people,
in that order of discovery and the reverse order of importance.

SEARCH.
One primary keyword per post, used naturally in the title, the first
paragraph and one heading. Never stuff it. Secondary keywords appear where
they belong in the text, not in a list at the end.

STRUCTURE.
Headings say what the section answers. Paragraphs are two to four sentences.
Use a list when the content is a list, and a table when the reader is
comparing.

${WRITE_RULES}`,
  sections: [
    {
      id: "research",
      title: "Search intent and keywords",
      summary: "What the searcher wants, and what to cover",
      dependsOn: [],
      tier: "high",
      instruction: `Work out the search behind "{{topic}}".

Return:
- PRIMARY KEYWORD: the phrase this post should rank for
- SEARCH INTENT: informational, commercial, transactional or navigational, and what the searcher is really trying to do, in one sentence
- READER: who is searching, and what they already know
- SECONDARY KEYWORDS: 6 to 10 related phrases
- QUESTIONS PEOPLE ASK: 5 to 8, phrased the way people type them
- MUST COVER: the points a complete answer has to include
- OUR ANGLE: the one thing this post will do better than a generic answer
- FACTS TO VERIFY: any number or claim the post will need, marked UNVERIFIED unless it is in the material above`,
    },
    {
      id: "outline",
      title: "Outline",
      summary: "Headings, order and length, agreed first",
      dependsOn: ["research"],
      tier: "standard",
      instruction: `Outline the post for "{{topic}}" from the research above.

Give the H1, then every H2 and H3 in order, each with one line on what that
part says. Put the direct answer to the search in the introduction. Note
where an example, a table or a step-by-step list belongs. End with the
target length in words (usually 1,200 to 1,800) and the call to action.`,
    },
    {
      id: "titles",
      title: "Title, meta description and slug",
      summary: "What shows up in Google",
      dependsOn: ["research"],
      tier: "cheap",
      instruction: `Write what appears in the search results.

1) TITLE: 5 options, each 50 to 60 characters, primary keyword near the start. Mark the best one.
2) META DESCRIPTION: 2 options, each 140 to 155 characters, saying what the reader gets.
3) URL SLUG: one, lowercase, hyphenated, 3 to 6 words.`,
    },
    {
      id: "article",
      title: "Blog post",
      summary: "The full article, ready to paste",
      dependsOn: ["research", "outline", "titles"],
      tier: "high",
      instruction: `Write the full blog post, following the outline exactly.

Open with the best title from above as the H1. The introduction answers the
search in its first two or three sentences, then says what the rest of the
post covers. Every section delivers what its heading promises. Use a real,
specific example in at least two sections. Close with a short conclusion and
the call to action from the outline.`,
    },
    {
      id: "faq",
      title: "FAQ",
      summary: "Questions and answers, ready for FAQ schema",
      dependsOn: ["research", "article"],
      tier: "standard",
      instruction: `Write an FAQ section for the end of the post: 5 questions from the
research's QUESTIONS PEOPLE ASK that the article does not already answer in
full. Each answer is 40 to 60 words and stands on its own, so it works as a
featured snippet. Format each as a ### question followed by its answer.`,
    },
    {
      id: "promo",
      title: "Social posts to promote it",
      summary: "LinkedIn, X and Facebook, with first comments",
      dependsOn: ["titles", "article"],
      tier: "standard",
      instruction: `Write the posts that send people to the article. Each one gives a
real piece of the value, not just "new post is up".

- LINKEDIN: 120 to 200 words, a strong first line, short lines, ending in a question.
- X: one post under 280 characters, and a 4-post thread.
- FACEBOOK: 60 to 120 words, conversational.

After each, a FIRST COMMENT carrying the link as [LINK] and one line that
makes clicking worth it.`,
    },
  ],
  outputs: [
    { key: "post", label: "Blog post", sections: ["titles", "article", "faq"] },
    { key: "brief", label: "SEO brief", sections: ["research", "outline"] },
    { key: "promotion", label: "Promotion", sections: ["promo"] },
  ],
};
