/**
 * What counts as the same name, in one place.
 *
 * Three shelves called "Powerful websites you know" exist because nothing ever
 * asked. The same hole let a topic be added twice and let the generator
 * propose one that had already been written — every path had its own idea of
 * sameness, or none at all.
 *
 * Everything that creates a series or a topic goes through here, on the server
 * as well as in the browser: a check the UI does is a courtesy, and a check the
 * repository does is the rule.
 */

/** Words too small to tell two names apart. */
const NOISE = new Set(["the", "a", "an"]);

/**
 * A name reduced to what actually distinguishes it.
 *
 * "Powerful Websites You Know", "powerful websites you know" and "The powerful
 * websites you know!" all land on the same string. `https://TinyPNG.com/` and
 * `tinypng.com` do too, because half the topics here are websites and the
 * scheme is not part of which site it is.
 */
export function normalizeName(raw: string): string {
  let s = (raw ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "");

  s = s.trim().toLowerCase();
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  s = s.replace(/^www\./, "");
  s = s.replace(/\/+$/, "");

  // Punctuation carries no meaning in a name people typed by hand; a dot
  // inside a domain does, so it survives while the rest goes.
  s = s.replace(/[^\p{L}\p{N}\s.]/gu, " ");
  s = s.replace(/\s+/g, " ").trim();

  const words = s.split(" ").filter(Boolean);
  while (words.length > 1 && NOISE.has(words[0])) words.shift();

  return words.join(" ");
}

/** Two names nobody would call different. */
export const sameName = (a: string, b: string) =>
  normalizeName(a) === normalizeName(b) && normalizeName(a) !== "";

export type Named = { id?: string; name: string };

/** The existing thing with this name, if there is one. */
export function findSame<T extends Named>(
  name: string,
  existing: readonly T[],
): T | undefined {
  const key = normalizeName(name);
  if (!key) return undefined;
  return existing.find((e) => normalizeName(e.name) === key);
}

/**
 * Names close enough to be worth a second look, but not close enough to refuse.
 *
 * "Powerful websites you know" against "Powerful Website You Should Know":
 * three words in common out of five, which is a person making the same shelf
 * twice — and also, sometimes, two genuinely different things. Refusing would
 * be wrong; saying nothing is how the first pair happened.
 */
export function nearMatches<T extends Named>(
  name: string,
  existing: readonly T[],
  threshold = 0.6,
): T[] {
  const mine = new Set(normalizeName(name).split(" ").filter(Boolean));
  if (mine.size === 0) return [];

  return existing
    .filter((e) => !sameName(e.name, name))
    .map((e) => {
      const theirs = new Set(normalizeName(e.name).split(" ").filter(Boolean));
      if (theirs.size === 0) return { e, score: 0 };
      let shared = 0;
      for (const w of mine) if (theirs.has(w)) shared += 1;
      // Against the shorter name, so a long title that contains a short one
      // scores high rather than being diluted by its own extra words.
      return { e, score: shared / Math.min(mine.size, theirs.size) };
    })
    .filter((x) => x.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.e);
}

/**
 * Split a list of proposed names into the ones that are new and the ones
 * already covered — by what exists, and by each other.
 *
 * Used by every path that adds more than one at a time: a pasted import, a
 * generated batch. Duplicates inside the batch itself count as covered, or
 * pasting the same line twice would still make two topics.
 */
export function partitionNew<T extends Named>(
  proposed: readonly string[],
  existing: readonly T[],
): { fresh: string[]; covered: { name: string; by: T | null }[] } {
  const seen = new Map(existing.map((e) => [normalizeName(e.name), e]));
  const fresh: string[] = [];
  const covered: { name: string; by: T | null }[] = [];

  for (const raw of proposed) {
    const name = raw.trim();
    if (!name) continue;
    const key = normalizeName(name);
    if (!key) continue;

    if (seen.has(key)) {
      covered.push({ name, by: seen.get(key) ?? null });
      continue;
    }
    seen.set(key, { name } as T);
    fresh.push(name);
  }

  return { fresh, covered };
}
