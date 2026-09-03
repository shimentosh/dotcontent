/**
 * Reading a page or a feed off the open web.
 *
 * Content OS had no crawler — `lib/tools.ts` said so in a comment — so a series
 * could only ever be about the four words you typed into its brief. This is
 * the smallest thing that fixes that: fetch a URL, work out whether it is a
 * feed or a page, and turn either into a list of headlines and some readable
 * text.
 *
 * No parser library. A feed is regular enough that regex is honest about what
 * it can and cannot do, and an HTML page is being reduced to "the words a
 * person would read" rather than a DOM — a dependency that promises more
 * accuracy than this needs would still be guessing at which div is the article.
 */

/** What came back, in a shape both the UI and a prompt can use. */
export type FetchedSource = {
  url: string;
  kind: "feed" | "page";
  /** The site or feed's own name. */
  title: string;
  items: FetchedItem[];
  /** Readable prose, for a page that is one article rather than a list. */
  text: string;
  fetchedAt: string;
};

export type FetchedItem = {
  title: string;
  link: string;
  /** One line, when the source gives one. */
  summary: string;
  /** As published, unparsed — feeds disagree about the format. */
  date: string;
};

export class FetchError extends Error {
  // Assigned rather than declared as a constructor parameter property: those
  // need a full TypeScript compiler, and this module is worth being able to
  // run straight from node when checking it against a real site.
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** How much prose to keep. Enough to frame ideas from, not a whole book. */
const MAX_TEXT = 12_000;
/** How many headlines. A feed of 200 is a wall, not a brief. */
const MAX_ITEMS = 40;

/*
 * A real browser's user agent.
 *
 * Not to be sneaky — plenty of sites answer a bare fetch with a 403 and a
 * page saying to enable JavaScript, and the difference between "this site
 * refuses robots" and "this app forgot to introduce itself" is worth ruling
 * out before showing someone an error.
 */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export async function fetchSource(raw: string): Promise<FetchedSource> {
  const url = normalise(raw);

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "user-agent": UA, accept: "text/html,application/xml,*/*" },
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    // Every one of these is "the request never completed", and the message
    // node gives is the only thing that says which.
    throw new FetchError(
      e instanceof Error && e.name === "TimeoutError"
        ? "That site took too long to answer."
        : `Could not reach that address — ${e instanceof Error ? e.message : "the request failed"}`,
      502,
    );
  }

  if (!res.ok) {
    throw new FetchError(
      `That address answered ${res.status}${res.status === 403 ? " — the site is refusing automated requests." : "."}`,
      502,
    );
  }

  const body = await res.text();
  const type = res.headers.get("content-type") ?? "";
  const fetchedAt = new Date().toISOString();

  if (looksLikeFeed(type, body)) {
    const items = feedItems(body);
    if (!items.length) {
      throw new FetchError("That looks like a feed, but it has no entries.", 502);
    }
    return {
      url,
      kind: "feed",
      title: feedTitle(body) || hostOf(url),
      items,
      text: "",
      fetchedAt,
    };
  }

  const text = pageText(body);
  const items = pageLinks(body, url);
  if (!text.trim() && !items.length) {
    throw new FetchError(
      "Nothing readable came back — the page may need JavaScript to render.",
      502,
    );
  }
  return {
    url,
    kind: "page",
    title: pageTitle(body) || hostOf(url),
    items,
    text,
    fetchedAt,
  };
}

/** "techcrunch.com" → "https://techcrunch.com". */
function normalise(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) throw new FetchError("Paste an address first.", 400);
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new FetchError("That is not an address.", 400);
  }
  /*
   * Public hosts only.
   *
   * The server does the fetching, so an address here is a request made from
   * inside the network this app runs on. Without this, "localhost:5437" or a
   * 192.168 address would let anyone with the UI read things the browser
   * never could.
   */
  const host = parsed.hostname.toLowerCase();
  const blocked =
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.test(host) ||
    host === "[::1]";
  if (blocked) {
    throw new FetchError("Only public web addresses can be read.", 400);
  }
  return parsed.toString();
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

const looksLikeFeed = (type: string, body: string) =>
  /xml|rss|atom/i.test(type) ||
  /^\s*<\?xml|<rss[\s>]|<feed[\s>]/i.test(body.slice(0, 500));

/** Everything between two tags, first match, tags stripped. */
const tag = (source: string, name: string) => {
  const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i").exec(source);
  return m ? clean(m[1]) : "";
};

/**
 * Text out of markup: entities decoded, CDATA unwrapped, tags gone.
 *
 * Ordered deliberately — CDATA first, because its contents may themselves hold
 * markup, and entities last, so a `&lt;b&gt;` in the source does not become a
 * tag that the tag-stripper then eats.
 */
function clean(raw: string) {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;|&rsquo;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

function feedTitle(body: string) {
  // The feed's own title is the first one, before any entry opens.
  const head = body.split(/<item[\s>]|<entry[\s>]/i)[0];
  return tag(head, "title");
}

function feedItems(body: string): FetchedItem[] {
  const blocks =
    body.match(/<item[\s>][\s\S]*?<\/item>/gi) ??
    body.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ??
    [];

  return blocks.slice(0, MAX_ITEMS).map((block) => {
    // Atom puts the URL in an attribute; RSS puts it in the element.
    const href = /<link[^>]*href=["']([^"']+)["']/i.exec(block)?.[1] ?? "";
    return {
      title: tag(block, "title"),
      link: tag(block, "link") || href,
      summary: (
        tag(block, "description") ||
        tag(block, "summary") ||
        tag(block, "content")
      ).slice(0, 400),
      date: tag(block, "pubDate") || tag(block, "updated") || tag(block, "published"),
    };
  });
}

const pageTitle = (body: string) => tag(body, "title");

/**
 * The words on a page, minus the furniture.
 *
 * Script, style, nav, header, footer and aside go first — a site's menu
 * repeated into every brief would drown the article it came with. What is left
 * is headings and paragraphs, in the order they appear.
 */
function pageText(body: string) {
  const stripped = body
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(nav|header|footer|aside|form)[\s\S]*?<\/\1>/gi, " ");

  const description =
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i.exec(body)?.[1] ??
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i.exec(body)?.[1] ??
    "";

  const chunks = [clean(description)];
  for (const m of stripped.matchAll(/<(h1|h2|h3|p|li)[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const text = clean(m[2]);
    // One-word list items are a menu, not prose.
    if (text.length > 25) chunks.push(text);
  }

  return [...new Set(chunks.filter(Boolean))].join("\n\n").slice(0, MAX_TEXT);
}

/**
 * Headlines off a page that is a list of them.
 *
 * A news front page is a feed without the XML: its value is the same list of
 * titles, so it is read the same way rather than flattened into prose.
 */
function pageLinks(body: string, base: string): FetchedItem[] {
  const seen = new Set<string>();
  const out: FetchedItem[] = [];

  for (const m of body.matchAll(
    /<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    const title = clean(m[2]);
    // A headline is a sentence fragment; a nav item is a word or two.
    if (title.length < 28 || title.length > 200) continue;
    if (seen.has(title)) continue;
    seen.add(title);

    let link = m[1];
    try {
      link = new URL(m[1], base).toString();
    } catch {
      // A malformed href is not a reason to drop an otherwise good headline.
    }
    out.push({ title, link, summary: "", date: "" });
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

/**
 * What a series' brief becomes when it is read from a source.
 *
 * One theme per line, which is exactly what the hand-typed brief is — so
 * everything downstream (generating ideas, framing a prompt) works on fetched
 * material without knowing it was fetched.
 */
export function sourceToBrief(source: FetchedSource) {
  if (source.items.length) {
    return source.items
      .map((i) => i.title)
      .filter(Boolean)
      .join("\n");
  }
  return source.text
    .split("\n\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 30)
    .slice(0, MAX_ITEMS)
    .join("\n");
}
