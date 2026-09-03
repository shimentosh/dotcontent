/**
 * One slug rule, for every name that becomes part of a URL.
 *
 * There were five copies of this — in `lib/topics.ts`, `lib/run-doc.ts`,
 * `lib/content-docs.ts`, `lib/packs-transfer.ts` and the packs repo — all
 * spelling out the same three lines. Copies of a rule are only a tidiness
 * problem until two of them disagree, and two of these are load-bearing
 * against each other: `/content/<slug>` finds its topic by comparing
 * `slug(topic.name)` to what is in the address bar. A stray change to one
 * would not fail a build or a test; it would 404 a page that was working
 * yesterday, for one topic, silently.
 *
 * Deliberately plain: lowercase, anything that is not a letter or a digit
 * becomes a hyphen, no hyphens on the ends. It is not reversible and does not
 * try to be — Bangla names collapse to an empty string, which is why callers
 * that must have something (a pack's own id) supply a fallback.
 */
export const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
