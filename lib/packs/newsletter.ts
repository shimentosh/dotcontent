import { WRITE_RULES } from "./shared";
import type { Pack } from "./website-shorts";

/**
 * Newsletter Email: one issue, subject line to P.S.
 *
 * The example of a short template. Three sections that run in order are
 * often all a format needs, and the subject lines are written after the plan
 * so they promise what the email actually delivers.
 */
export const NEWSLETTER: Pack = {
  slug: "newsletter",
  name: "Newsletter Email",
  description:
    "One topic becomes a newsletter issue people open and read: the plan, 10 subject lines with preview text, the full email, and a post that brings in new subscribers.",
  version: 1,
  purpose: `Write an email that gets opened, read to the end, and clicked.

One idea per issue. The subject line earns the open, the first two lines earn
the read, and one clear action earns the click. An email that tries to say
four things gets none of them.`,
  inputs: [
    { key: "topic", label: "This issue's topic", type: "text", required: true, placeholder: "What I learned from 100 client calls" },
    { key: "extra_instruction", label: "What to include", type: "textarea", hint: "Optional. Links, news, an offer, a story." },
    { key: "series", label: "Newsletter name", type: "text", hint: "Taken from the series the topic is on." },
  ],
  rules: `You write a newsletter the way a person writes to people they know:
warm, direct, and worth the time it takes to read.

EMAIL.
Short paragraphs, one to three sentences. Plain text formatting that
survives every email app: no tables, at most a short list. One call to
action, repeated at most once. Sign off as the brand voice would.

${WRITE_RULES}`,
  sections: [
    {
      id: "plan",
      title: "Issue plan",
      summary: "The one idea, and how the email gets there",
      dependsOn: [],
      tier: "standard",
      instruction: `Plan this issue of {{series}} about "{{topic}}".

Return: THE ONE IDEA (one sentence), WHAT THE READER GETS (one sentence),
the STRUCTURE (a hook, the insight, the practical part, the call to action,
one line each), and the CALL TO ACTION itself.`,
    },
    {
      id: "subject",
      title: "Subject lines and preview text",
      summary: "10 subjects, the best three with preview text",
      dependsOn: ["plan"],
      tier: "cheap",
      instruction: `Write 10 subject lines, each under 45 characters, in different styles:
curiosity, benefit, a number, a question, personal, and plain. No clickbait
the email does not pay off, no ALL CAPS, at most one emoji.

Then mark the best three, and give each a preview text of 40 to 90
characters that adds to the subject rather than repeating it.`,
    },
    {
      id: "body",
      title: "The email",
      summary: "Greeting to P.S., ready to send",
      dependsOn: ["plan"],
      tier: "high",
      instruction: `Write the email, 300 to 600 words, following the plan. A greeting, a
first line that pulls the reader in, the insight, the practical part, the
call to action as its own line, a sign-off, and a P.S. that either repeats
the action or adds one small extra.`,
    },
    {
      id: "promo",
      title: "Social post for new subscribers",
      summary: "A post that brings in new readers",
      dependsOn: ["body"],
      tier: "cheap",
      instruction: `Write one post for LinkedIn or X that shares the most useful part of this
issue and invites people to subscribe. Give away something real. Then a
FIRST COMMENT with the sign-up link as [SIGNUP LINK].`,
    },
  ],
  outputs: [
    { key: "email", label: "Email", sections: ["subject", "body"] },
    { key: "promo", label: "Promotion", sections: ["promo"] },
    { key: "plan", label: "Plan", sections: ["plan"] },
  ],
};
