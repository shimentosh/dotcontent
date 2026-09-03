"use client";

import type { CSSProperties, ReactNode } from "react";

import { font } from "@/lib/theme";

/**
 * The colours a rendered block paints itself in — reading mode's palette,
 * narrowed to what text needs.
 */
export type TextPalette = {
  ink: string;
  strong: string;
  muted: string;
  rule: string;
  accent: string;
  sheet: string;
};

export type TextMetrics = {
  /** Body size in px; everything else is a ratio of it. */
  size: number;
  /** Bengali needs its own family and more leading than Latin. */
  bangla: boolean;
};

/**
 * Markdown, as far as a generated section actually uses it.
 *
 * The sections come back as markdown — headings, tables, bullets, the odd
 * fenced block — and reading mode was showing it verbatim: `## Website
 * research` above a row of pipes and dashes. That is the text, but it is not
 * the document, and a reading mode that renders a table as `|---|---|` is
 * worse than the page it was meant to improve.
 *
 * Deliberately not a full parser. No nested lists, no reference links, no HTML
 * passthrough — those never appear here, and each one would be a thing to get
 * subtly wrong. What is here is what the packs write.
 */
export function ReadingText({
  lines,
  palette,
  metrics,
}: {
  lines: string[];
  palette: TextPalette;
  metrics: TextMetrics;
}) {
  return <>{blocks(lines, palette, metrics)}</>;
}

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBER = /^\s*(\d+)[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const RULE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
const FENCE = /^\s*```/;
const ROW = /^\s*\|(.+)\|\s*$/;
/** The `|---|:--:|` line that turns the row above it into headers. */
const DIVIDER = /^\s*\|?[\s|:-]+\|[\s|:-]*$/;

const cells = (line: string) =>
  line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((c) => c.trim());

function blocks(
  lines: string[],
  c: TextPalette,
  m: TextMetrics,
): ReactNode[] {
  const out: ReactNode[] = [];
  const body: CSSProperties = {
    fontFamily: m.bangla ? font.bangla : font.read,
    fontSize: m.bangla ? m.size * 1.04 : m.size,
    lineHeight: m.bangla ? 1.95 : 1.72,
    color: c.ink,
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i += 1;
      continue;
    }

    // ``` fenced code ```
    if (FENCE.test(line)) {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE.test(lines[i])) {
        code.push(lines[i]);
        i += 1;
      }
      i += 1;
      out.push(
        <pre
          key={out.length}
          style={{
            margin: "0 0 1.1em",
            padding: "14px 16px",
            borderRadius: 10,
            overflowX: "auto",
            background: c.sheet,
            border: `1px solid ${c.rule}`,
            fontFamily: font.mono,
            fontSize: m.size * 0.8,
            lineHeight: 1.6,
            color: c.ink,
          }}
        >
          {code.join("\n")}
        </pre>,
      );
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const depth = heading[1].length;
      out.push(
        <p
          key={out.length}
          role="heading"
          aria-level={Math.min(depth + 1, 6)}
          style={{
            margin: out.length === 0 ? "0 0 0.5em" : "1.5em 0 0.5em",
            fontFamily: font.read,
            fontSize: m.size * (depth <= 2 ? 1.25 : 1.1),
            fontWeight: 600,
            lineHeight: 1.35,
            letterSpacing: "-0.01em",
            color: c.strong,
          }}
        >
          {inline(heading[2], c, m)}
        </p>,
      );
      i += 1;
      continue;
    }

    if (RULE.test(line)) {
      out.push(
        <span
          key={out.length}
          style={{
            display: "block",
            height: 1,
            margin: "1.8em 0",
            background: c.rule,
          }}
        />,
      );
      i += 1;
      continue;
    }

    // | a | b |  — with or without a header divider
    if (ROW.test(line)) {
      const rows: string[][] = [];
      let head: string[] | null = null;
      while (i < lines.length && ROW.test(lines[i])) {
        if (DIVIDER.test(lines[i]) && rows.length === 1) {
          head = rows.pop()!;
        } else {
          rows.push(cells(lines[i]));
        }
        i += 1;
      }
      out.push(
        <div
          key={out.length}
          style={{ margin: "0 0 1.2em", overflowX: "auto" }}
        >
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontFamily: font.sans,
              fontSize: m.size * 0.82,
              lineHeight: 1.5,
            }}
          >
            {head ? (
              <thead>
                <tr>
                  {head.map((cell, n) => (
                    <th
                      key={n}
                      style={{
                        textAlign: "left",
                        padding: "8px 12px 8px 0",
                        borderBottom: `1.5px solid ${c.rule}`,
                        fontWeight: 650,
                        color: c.strong,
                      }}
                    >
                      {inline(cell, c, m)}
                    </th>
                  ))}
                </tr>
              </thead>
            ) : null}
            <tbody>
              {rows.map((row, n) => (
                <tr key={n}>
                  {row.map((cell, k) => (
                    <td
                      key={k}
                      style={{
                        padding: "8px 12px 8px 0",
                        borderBottom: `1px solid ${c.rule}`,
                        verticalAlign: "top",
                        color: k === 0 ? c.strong : c.ink,
                      }}
                    >
                      {inline(cell, c, m)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (QUOTE.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) {
        quoted.push(QUOTE.exec(lines[i])![1]);
        i += 1;
      }
      out.push(
        <blockquote
          key={out.length}
          style={{
            margin: "0 0 1.1em",
            padding: "2px 0 2px 18px",
            borderLeft: `2px solid ${c.accent}`,
            ...body,
            color: c.muted,
            fontStyle: "italic",
          }}
        >
          {quoted.join(" ")}
        </blockquote>,
      );
      continue;
    }

    // - bullets, or 1. numbers
    if (BULLET.test(line) || NUMBER.test(line)) {
      const ordered = NUMBER.test(line);
      const items: string[] = [];
      while (
        i < lines.length &&
        (ordered ? NUMBER.test(lines[i]) : BULLET.test(lines[i]))
      ) {
        const match = ordered ? NUMBER.exec(lines[i])! : BULLET.exec(lines[i])!;
        items.push(ordered ? match[2] : match[1]);
        i += 1;
      }
      const List = ordered ? "ol" : "ul";
      out.push(
        <List
          key={out.length}
          style={{
            margin: "0 0 1.1em",
            paddingLeft: "1.35em",
            ...body,
          }}
        >
          {items.map((item, n) => (
            <li key={n} style={{ margin: "0 0 0.4em", paddingLeft: "0.15em" }}>
              {inline(item, c, m)}
            </li>
          ))}
        </List>,
      );
      continue;
    }

    /*
     * Everything else is a paragraph — one per line, not one per blank-line
     * block. Nothing here hard-wraps prose: a section that writes "NAME:" and
     * "URL:" on two lines means two lines, and joining them the way a markdown
     * renderer normally would ran them together into one.
     */
    out.push(
      <p key={out.length} style={{ margin: "0 0 0.75em", ...body }}>
        {inline(line, c, m)}
      </p>,
    );
    i += 1;
  }

  return out;
}

/** `code`, **bold**, *italic* and [links](url), in one pass. */
const INLINE =
  /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)|(_[^_\n]+_)|(\[[^\]]+\]\([^)\s]+\))/g;

function inline(text: string, c: TextPalette, m: TextMetrics): ReactNode {
  const out: ReactNode[] = [];
  let last = 0;

  for (const match of text.matchAll(INLINE)) {
    const at = match.index;
    if (at > last) out.push(text.slice(last, at));
    const token = match[0];

    if (token.startsWith("`")) {
      out.push(
        <code
          key={out.length}
          style={{
            fontFamily: font.mono,
            fontSize: m.size * 0.82,
            padding: "1px 5px",
            borderRadius: 5,
            background: c.sheet,
            border: `1px solid ${c.rule}`,
          }}
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("**")) {
      out.push(
        <strong key={out.length} style={{ fontWeight: 650, color: c.strong }}>
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith("[")) {
      const cut = token.indexOf("](");
      out.push(
        <a
          key={out.length}
          href={token.slice(cut + 2, -1)}
          target="_blank"
          rel="noreferrer"
          style={{ color: c.accent, textDecoration: "underline" }}
        >
          {token.slice(1, cut)}
        </a>,
      );
    } else {
      out.push(
        <em key={out.length} style={{ fontStyle: "italic" }}>
          {token.slice(1, -1)}
        </em>,
      );
    }
    last = at + token.length;
  }

  if (last < text.length) out.push(text.slice(last));
  return out.length === 1 ? out[0] : out;
}
