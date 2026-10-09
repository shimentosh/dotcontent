"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { SECTION_TYPE_GROUPS } from "@/lib/data";
import { download, fileNameFor, toFile } from "@/lib/packs-transfer";
import { PACK_STATUS, type Pack } from "@/lib/packs";
import { useStore } from "@/lib/store";
import {
  font,
  ghost,
  ghostHover,
  panel,
  primary,
  primaryActive,
  primaryHover,
  rise,
  t,
  w,
} from "@/lib/theme";
import { Hov } from "@/components/ui/Hov";
import { Popover } from "@/components/ui/Popover";
import {
  ChevronLeft,
  CopyIcon,
  MoreIcon,
  PacksIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  RefreshIcon,
} from "@/components/ui/Icons";
import {
  ClockGlyph,
  DocGlyph,
  GlobeGlyph,
  GridGlyph,
  DownloadGlyph,
  HashGlyph,
  KeyGlyph,
  ListGlyph,
  PulseGlyph,
  ReadGlyph,
  SpeechGlyph,
  StackGlyph,
  TagGlyph,
} from "@/components/ui/DocIcons";
import { StepTile } from "@/components/builder/StepPalette";

/**
 * One pack, as it really is.
 *
 * Everything on this page comes from the pack the URL names — its sections are
 * the sections a run will execute, and its rules are the system prompt the
 * model receives. This screen used to render one constant no matter which row
 * you clicked, which made every pack in the library look identical.
 */
export function PackDetailView({ slug }: { slug: string }) {
  const {
    go,
    openRunSetup,
    openAddSection,
    showInstructions,
    toggleInstructions,
    packs,
    editPack,
    duplicatePack,
    restorePack: restore,
    askConfirm,
  } = useStore();

  const pack = packs.find((p) => p.id === slug);

  /*
   * The overflow menu behind the "..." button.
   *
   * Every template edits — the shipped ones are seeded rows like any other. What a
   * shipped template gets EXTRA is Restore, which is the thing that makes editing
   * a tuned twelve-section prompt a reasonable offer rather than a trap.
   */
  const moreRef = useRef<HTMLDivElement>(null);
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    if (!moreOpen) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      const inside =
        Boolean(target.closest('[data-menu="template-more"]')) ||
        Boolean(moreRef.current?.contains(target));
      if (!inside) setMoreOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);

  if (!pack) {
    return (
      <div
        style={{
          ...rise(240),
          maxWidth: 1180,
          margin: "0 auto",
          padding: "26px 30px",
        }}
      >
        <Back go={go} />
        <p style={{ fontSize: 14, color: t(0.5) }}>
          {packs.length ? "No template by that name." : "Loading the template library…"}
        </p>
      </div>
    );
  }

  const sections = pack.draft.sections;
  const rules = pack.draft.rules.trim();
  const status = PACK_STATUS[pack.status];

  const MORE: { label: string; icon: ReactNode; run: () => void }[] = [
    {
      label: "Run template",
      icon: <PlayIcon size={11} fill="currentColor" />,
      run: () => openRunSetup(),
    },
    {
      label: "Edit in builder",
      icon: <PencilIcon size={13} />,
      run: () => editPack(pack.id),
    },
    {
      label: "Duplicate",
      icon: <CopyIcon size={13} />,
      run: () => duplicatePack(pack.id),
    },
    {
      // The whole brief as a file — rules, sections, prompts, inputs — so a
      // template can be sent to somebody rather than described to them.
      label: "Export as a file",
      icon: <DownloadGlyph size={13} stroke="currentColor" />,
      run: () => download(fileNameFor(pack.name), toFile(pack)),
    },
    {
      label: "Add a section",
      icon: <PlusIcon size={13} strokeWidth={2} />,
      run: () => openAddSection("pack", pack.id),
    },
    ...(pack.shipped
      ? [
          {
            label: "Restore the shipped version",
            icon: <RefreshIcon size={13} />,
            run: () =>
              askConfirm({
                title: "Restore this template?",
                body: "Every section, rule and input goes back to the version that ships with the app. Anything you changed here is lost; content already written keeps the version it ran under.",
                confirmLabel: "Restore it",
                onConfirm: () => restore(pack.id),
              }),
          },
        ]
      : []),
    {
      label: showInstructions ? "Hide template rules" : "Show template rules",
      icon: <ReadGlyph size={13} stroke="currentColor" />,
      run: toggleInstructions,
    },
  ];

  return (
    <div
      style={{
        ...rise(240),
        maxWidth: 1180,
        margin: "0 auto",
        padding: "26px 30px 60px",
      }}
    >
      <Back go={go} />

      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 20,
          marginBottom: 24,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 7,
            }}
          >
            <span
              aria-hidden="true"
              style={{
                display: "grid",
                placeItems: "center",
                flex: "none",
                width: 34,
                height: 34,
                borderRadius: 11,
                background: "rgba(0,87,252,0.16)",
                color: "#6a9dff",
              }}
            >
              <PacksIcon size={17} stroke="currentColor" />
            </span>
            <h1
              style={{
                fontFamily: font.tight,
                fontSize: 30,
                fontWeight: 700,
                letterSpacing: "-0.03em",
                margin: 0,
              }}
            >
              {pack.name}
            </h1>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 10.5,
                fontFamily: font.mono,
                letterSpacing: "0.1em",
                padding: "3px 9px",
                borderRadius: 20,
                background: status.bg,
                color: status.fg,
              }}
            >
              <span
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: "50%",
                  background: status.fg,
                }}
              />
              {pack.status}
            </span>
            {pack.shipped ? (
              <span
                title="A version of this ships with the app, so it can be restored"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  fontSize: 10.5,
                  fontFamily: font.mono,
                  letterSpacing: "0.1em",
                  padding: "3px 9px",
                  borderRadius: 20,
                  background: w(0.07),
                  color: t(0.5),
                }}
              >
                <RefreshIcon size={10} stroke="currentColor" />
                RESTORABLE
              </span>
            ) : null}
          </div>
          <p
            style={{
              margin: 0,
              fontSize: 14,
              color: t(0.5),
              maxWidth: 660,
              textWrap: "pretty",
            }}
          >
            {pack.desc || "No description yet."}
          </p>
        </div>

        <div style={{ display: "flex", gap: 8, flex: "0 0 auto" }}>
          <Hov
            onClick={() => openRunSetup()}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              height: 34,
              padding: "0 15px",
              borderRadius: 10,
              fontSize: 13,
              fontWeight: 600,
              ...primary,
            }}
            hover={primaryHover}
            active={primaryActive}
          >
            <PlayIcon size={13} />
            <span>Run Template</span>
          </Hov>
          <div ref={moreRef} style={{ position: "relative" }}>
            <Hov
              onClick={() => setMoreOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              aria-label="More template actions"
              title="More template actions"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 34,
                height: 34,
                borderRadius: 10,
                ...ghost,
              }}
              hover={ghostHover}
            >
              <MoreIcon size={15} />
            </Hov>
            <Popover
              anchorRef={moreRef}
              open={moreOpen}
              align="right"
              width={198}
              offset={6}
              data-menu="template-more"
            >
              {MORE.map((item) => (
                <Hov
                  key={item.label}
                  role="menuitem"
                  onClick={() => {
                    setMoreOpen(false);
                    item.run();
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 9,
                    padding: "8px 11px",
                    borderRadius: 9,
                    fontSize: 12.5,
                    color: t(0.75),
                    cursor: "pointer",
                  }}
                  hover={{ background: w(0.09), color: "#f0f0f4" }}
                >
                  {/* The glyph inherits the row's colour, so it brightens with
                      the label on hover rather than staying behind it. */}
                  <span style={{ display: "flex", flex: "none", opacity: 0.72 }}>
                    {item.icon}
                  </span>
                  {item.label}
                </Hov>
              ))}
            </Popover>
          </div>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 340px",
          gap: 14,
          alignItems: "start",
        }}
      >
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 11,
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                fontFamily: font.mono,
                fontSize: 10,
                letterSpacing: "0.14em",
                color: t(0.42),
              }}
            >
              <StackGlyph size={12} stroke={t(0.32)} />
              SECTIONS
            </span>
            <span style={{ flex: 1, height: 1, background: w(0.07) }} />
            <span style={{ fontSize: 11.5, color: t(0.38) }}>
              {sections.length} in order
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {sections.map((s, i) => (
              <div
                key={s.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "34px 1fr",
                  gap: 13,
                  alignItems: "start",
                  padding: "13px 15px",
                  borderRadius: 14,
                  background: w(0.04),
                  border: `1px solid ${w(0.075)}`,
                  backdropFilter: "blur(20px)",
                }}
              >
                <SectionTile name={s.name} type={s.type} n={i + 1} />
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      marginBottom: 4,
                    }}
                  >
                    <span style={{ fontSize: 13.5, fontWeight: 600 }}>
                      {s.name}
                    </span>
                    <TypeBadge type={s.type} />
                  </div>
                  {s.summary?.trim() ? (
                    <div
                      style={{
                        fontSize: 12.5,
                        color: t(0.6),
                        marginBottom: 5,
                        textWrap: "pretty",
                      }}
                    >
                      {s.summary.trim()}
                    </div>
                  ) : null}
                  {/*
                    The section's own prompt, clamped. It is the only thing that
                    distinguishes one section from another, and a name alone
                    tells you nothing about what will be written.
                  */}
                  <div
                    style={{
                      fontSize: 12,
                      color: t(0.42),
                      lineHeight: 1.5,
                      display: "-webkit-box",
                      WebkitLineClamp: s.summary?.trim() ? 2 : 3,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                      textWrap: "pretty",
                    }}
                  >
                    {s.brief.trim() ||
                      "No prompt written for this section yet."}
                  </div>
                </div>
              </div>
            ))}

            {(
              <Hov
                onClick={() => openAddSection("pack", pack.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  padding: 13,
                  borderRadius: 14,
                  border: `1px dashed ${w(0.16)}`,
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: t(0.55),
                  cursor: "pointer",
                }}
                hover={{
                  background: w(0.05),
                  color: "#f0f0f4",
                  borderColor: w(0.3),
                }}
              >
                <PlusIcon size={14} strokeWidth={2.2} />
                <span>Add Section</span>
              </Hov>
            )}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            position: "sticky",
            top: 0,
          }}
        >
          <div style={{ ...panel(17), padding: 16 }}>
            <Label icon={<GridGlyph size={12} stroke={t(0.32)} />}>
              TEMPLATE OVERVIEW
            </Label>
            {overviewOf(pack).map((o) => {
              const Glyph = o.icon;
              return (
                <div
                  key={o.k}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "7px 0",
                    borderTop: `1px solid ${w(0.055)}`,
                  }}
                >
                  <span
                    style={{
                      flex: "0 0 92px",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 12,
                      color: t(0.42),
                    }}
                  >
                    <Glyph size={12} stroke={t(0.3)} />
                    {o.k}
                  </span>
                  <span
                    style={{
                      flex: 1,
                      fontSize: 12.5,
                      fontWeight: 500,
                      textWrap: "pretty",
                    }}
                  >
                    {o.v}
                  </span>
                </div>
              );
            })}
          </div>

          <div style={{ ...panel(17), padding: 16 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                marginBottom: 12,
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 7,
                  fontFamily: font.mono,
                  fontSize: 10,
                  letterSpacing: "0.14em",
                  color: t(0.42),
                }}
              >
                <ReadGlyph size={12} stroke={t(0.32)} />
                TEMPLATE RULES
              </span>
              <Hov
                as="span"
                onClick={toggleInstructions}
                aria-expanded={showInstructions}
                style={{
                  marginLeft: "auto",
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: "#0057fc",
                  cursor: "pointer",
                }}
              >
                {showInstructions ? "Hide Full Text" : "View Full Text"}
              </Hov>
            </div>

            {!rules ? (
              <div style={{ fontSize: 12.5, color: t(0.42) }}>
                No rules written. Every section runs on its own prompt alone.
              </div>
            ) : showInstructions ? (
              <div
                style={{
                  padding: 12,
                  borderRadius: 11,
                  background: "rgba(0,0,0,0.4)",
                  border: `1px solid ${w(0.08)}`,
                  fontFamily: font.mono,
                  fontSize: 10.5,
                  lineHeight: 1.7,
                  color: t(0.6),
                  whiteSpace: "pre-wrap",
                  maxHeight: 420,
                  overflowY: "auto",
                }}
              >
                {rules}
              </div>
            ) : (
              /*
                Collapsed, the rules read as their headline lines — the ones in
                caps or ending in a colon. A tuned prompt runs to thousands of
                characters, and its first paragraph is not a summary of it.
              */
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {/* By position: two sections of a prompt can carry the same
                    heading, and a repeated line is not two identities. */}
                {headlines(rules).map((line, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      gap: 9,
                      fontSize: 12.5,
                      color: t(0.72),
                      lineHeight: 1.45,
                    }}
                  >
                    <span style={{ color: "#0057fc", flex: "0 0 auto" }}>
                      —
                    </span>
                    <span style={{ textWrap: "pretty" }}>{line}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ ...panel(17), padding: 16 }}>
            <Label icon={<KeyGlyph size={12} stroke={t(0.32)} />}>
              ASKS FOR
            </Label>
            {(pack.inputs ?? []).length ? (
              (pack.inputs ?? []).map((input) => {
                const Glyph = inputGlyph(input.key, input.label);
                return (
                  <div
                    key={input.key}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 9,
                      padding: "5px 0",
                      fontSize: 12.5,
                      color: t(0.72),
                    }}
                  >
                    <Glyph
                      size={13}
                      stroke={input.required ? "#d3a54f" : t(0.3)}
                    />
                    <span>{input.label}</span>
                    <span
                      style={{
                        marginLeft: "auto",
                        fontFamily: font.mono,
                        fontSize: 10.5,
                        color: input.required ? "#e0a83c" : t(0.32),
                      }}
                    >
                      {input.required ? "REQUIRED" : "optional"}
                    </span>
                  </div>
                );
              })
            ) : (
              <div style={{ fontSize: 12.5, color: t(0.42) }}>
                Nothing — it runs on the workspace voice and the topic alone.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Every step the builder can add, by name. */
const KINDS = new Set(
  SECTION_TYPE_GROUPS.flatMap((group) => group.items.map((item) => item.name)),
);

/**
 * A shipped section carries a TIER where a built one carries a KIND.
 *
 * The templates that ship with the app were written as prompts, not dragged
 * out of the palette, so `type` on their sections says how much thinking each
 * is worth — cheap, standard, high — and nothing about what it makes. Read
 * literally, every row on this page wore the same fallback tile. The name is
 * what actually says: a section called "Bangla script" is a script wherever it
 * came from, so the words decide the tile and the palette's own table decides
 * how that tile looks.
 */
const KIND_WORDS: [RegExp, string][] = [
  // Before CTA and Caption, which "first comment" and "caption and first
  // comment" would otherwise fall into.
  [/first comment/i, "First comment"],
  [/research|identif|verif|facts|takeaway|search intent/i, "Research"],
  [/cta|keyword/i, "CTA"],
  [/hook|opening/i, "Hook"],
  [/script/i, "Script"],
  [/caption|title card/i, "Caption"],
  [/hashtag|tags?/i, "Hashtags"],
  [/email|newsletter|subject line/i, "Email"],
  [/blog|article|written review|faq/i, "Article"],
  [/seo|title|headline/i, "Title"],
  [/description|blurb/i, "Description"],
  [/facebook|linkedin|instagram|social|x posts|thread|teaser|launch-day|ad copy/i, "Social post"],
  [/plan|structure|outline|brief|angle|verdict|clip/i, "Plan"],
];

const kindOf = (name: string, type: string) => {
  if (KINDS.has(type)) return type;
  for (const [words, kind] of KIND_WORDS) if (words.test(name)) return kind;
  return type;
};

/**
 * How hard a section is worth thinking about, as the run engine reads it.
 *
 * The scale runs cool to warm, because that is the only thing it is: HIGH is
 * not better than CHEAP, it is slower and dearer, and the two rows on this
 * page that carry it are the two worth knowing about before you press Run.
 * STANDARD is most of them, so it stays out of the way.
 */
const TIER: Record<string, { fg: string; bg: string }> = {
  cheap: { fg: "#63bdad", bg: "rgba(96,182,168,0.13)" },
  standard: { fg: t(0.45), bg: w(0.06) },
  high: { fg: "#d3a54f", bg: "rgba(201,154,63,0.14)" },
};

/** The step's tile, with its place in the order under it. */
function SectionTile({
  name,
  type,
  n,
}: {
  name: string;
  type: string;
  n: number;
}) {
  const kind = kindOf(name, type);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 5,
      }}
    >
      {/* The same tile the palette, the canvas and the summary wear, so a
          section looks the same everywhere it appears. */}
      <span title={kind} style={{ display: "flex" }}>
        <StepTile name={kind} size={30} />
      </span>
      <span style={{ fontFamily: font.mono, fontSize: 10, color: t(0.3) }}>
        {String(n).padStart(2, "0")}
      </span>
    </div>
  );
}

/** The tier badge — or nothing, when the tile has already said it. */
function TypeBadge({ type }: { type: string }) {
  const tier = TIER[type.toLowerCase()];
  // A known kind is exactly what the tile draws, in the colour it draws it
  // everywhere else. Printing the word beside the name is the same thing said
  // twice, and it crowds out the summary line, which is not.
  if (!tier && KINDS.has(type)) return null;
  const look = tier ?? { fg: t(0.5), bg: w(0.07) };
  return (
    <span
      style={{
        flex: "none",
        fontSize: 9.5,
        fontFamily: font.mono,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        padding: "2px 7px",
        borderRadius: 5,
        background: look.bg,
        color: look.fg,
      }}
    >
      {type}
    </span>
  );
}

function Back({ go }: { go: (href: string) => void }) {
  return (
    <Hov
      onClick={() => go("/packs")}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 12,
        color: t(0.5),
        cursor: "pointer",
        marginBottom: 14,
      }}
      hover={{ color: "#f0f0f4" }}
    >
      <ChevronLeft size={13} />
      <span>Templates</span>
    </Hov>
  );
}

function Label({ icon, children }: { icon?: ReactNode; children: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        fontFamily: font.mono,
        fontSize: 10,
        letterSpacing: "0.14em",
        color: t(0.42),
        marginBottom: 13,
      }}
    >
      {icon}
      {children}
    </div>
  );
}

const overviewOf = (pack: Pack) => [
  { k: "Sections", icon: ListGlyph, v: String(pack.draft.sections.length) },
  {
    k: "Version",
    icon: TagGlyph,
    v: pack.version ? `v${pack.version}` : "—",
  },
  { k: "Runs", icon: PulseGlyph, v: String(pack.runs ?? 0) },
  { k: "Last used", icon: ClockGlyph, v: pack.used },
  {
    k: "Source",
    icon: DocGlyph,
    v: pack.shipped ? "Seeded from the app" : "Written here",
  },
];

/**
 * The glyph for an input, read off what it asks for.
 *
 * The inputs are free-form — a template names its own — so this matches the
 * words rather than a fixed list, and falls back to a plain document for
 * anything it does not recognise.
 */
function inputGlyph(key: string, label: string) {
  const s = `${key} ${label}`.toLowerCase();
  if (/url|link|website|site|source/.test(s)) return GlobeGlyph;
  // Number before series, so "Series part" is read as the number it is.
  if (/part|number|count|episode|index/.test(s)) return HashGlyph;
  if (/series|shelf|collection/.test(s)) return StackGlyph;
  if (/instruction|note|extra|brief|prompt/.test(s)) return SpeechGlyph;
  return DocGlyph;
}

/**
 * The lines of a rules block worth showing collapsed.
 *
 * A heading in these prompts is a short line that shouts — all caps, or ending
 * in a colon. Falling back to the first few lines keeps a plainly written pack
 * from showing an empty panel.
 */
function headlines(rules: string) {
  const lines = rules
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const shouted = lines.filter((l) => {
    if (l.length < 4 || l.length > 70) return false;
    // A template placeholder is also all caps. "[STEP 2]," is not a heading,
    // and six of them in a row is what this panel showed before.
    if (/[[\]{}]/.test(l)) return false;
    if (!/[A-Z]/.test(l)) return false;
    const letters = l.replace(/[^A-Za-z ]/g, "");
    return letters === letters.toUpperCase();
  });
  return (shouted.length ? shouted : lines).slice(0, 6);
}
