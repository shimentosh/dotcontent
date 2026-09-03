"use client";

import type { Pack } from "@/lib/packs";
import { partName } from "@/lib/topics";
import { font, panel, rise, t, w } from "@/lib/theme";
import { Hov } from "@/components/ui/Hov";
import { Button, Rail as UiRail } from "@/components/ui";
import { ListGlyph, TopicGlyph } from "@/components/ui/DocIcons";
import { ChevronLeft, PlayIcon } from "@/components/ui/Icons";

/**
 * A topic that has produced nothing yet.
 *
 * This was a centred box reading "Nothing written for X yet" with a button
 * back to the list — a dead end at the exact moment you had arrived somewhere
 * wanting to do something, and with no clue what doing it would involve.
 *
 * It is the same shell as the reader now: the rail on the left so it is a
 * place rather than a wall, and beside it the answer to the only two questions
 * you have here — what would this write, and how do I start it.
 */

export type RailTopic = {
  id: string;
  name: string;
  slug: string;
  written: number;
  total: number;
};

export type UnwrittenTopicProps = {
  topic: {
    id: string;
    name: string;
    part: number | null;
    context: string;
    series: { name: string; pack: string; partLabel: string };
  };
  /** The template the shelf points at, when it points at one. */
  template?: Pack;
  rail: RailTopic[];
  filter: string;
  setFilter: (value: string) => void;
  go: (href: string) => void;
  onRun: () => void;
  /** Set between the press and the run existing, so the button can say so. */
  starting?: boolean;
};

export function UnwrittenTopic({
  topic,
  template,
  rail,
  filter,
  setFilter,
  go,
  onRun,
  starting = false,
}: UnwrittenTopicProps) {
  const sections = template?.draft.sections ?? [];

  return (
    <div
      style={{
        ...rise(240),
        maxWidth: 1320,
        margin: "0 auto",
        padding: "26px 30px 60px",
      }}
    >
      <Hov
        onClick={() => go("/content")}
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
        <span>Content</span>
      </Hov>

      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 20,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <h1
          style={{
            fontFamily: font.tight,
            fontSize: 30,
            fontWeight: 700,
            letterSpacing: "-0.03em",
            margin: 0,
          }}
        >
          {topic.name}
        </h1>
        {topic.part !== null ? (
          <span
            style={{
              fontFamily: font.mono,
              fontSize: 11,
              padding: "3px 8px",
              borderRadius: 20,
              background: w(0.07),
              color: t(0.55),
            }}
          >
            {partName(topic.series.partLabel, topic.part)}
          </span>
        ) : null}
      </div>
      <p style={{ margin: "6px 0 0", fontSize: 13, color: t(0.46) }}>
        {template ? `${template.name} · ` : ""}On {topic.series.name}
      </p>
        </div>

{/*
          Where Redo all / Download / Copy all sit on a written topic. The
          page's one action belongs in the page's action place.

          Offered with or without a template on the shelf: without one there is
          a question to answer rather than nothing to do, so the press opens the
          run sheet and asks which template — the button is never missing from
          the one screen whose entire purpose is starting this.
        */}
        <Button
          variant="primary"
          onClick={onRun}
          disabled={starting}
          icon={<PlayIcon size={11} fill="currentColor" />}
          style={{ flex: "0 0 auto" }}
        >
          {starting
            ? "Starting…"
            : template
              ? "Run this template"
              : "Pick a template and run"}
        </Button>
      </div>

      {/*
        The same chips the written page carries, saying the true version of
        what they say there. Switching between a written topic and an unwritten
        one in the rail should move the words on the page, not the page: the
        header, the counter, the status and the three columns all stay where
        they were.
      */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginTop: 14,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            padding: "6px 11px",
            borderRadius: 9,
            fontSize: 12,
            fontFamily: font.mono,
            background: w(0.06),
            border: `1px solid ${w(0.09)}`,
            color: t(0.62),
          }}
        >
          0/{sections.length || 0} written
        </span>

        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 11px",
            borderRadius: 9,
            fontSize: 12,
            background: "rgba(201,154,63,0.12)",
            border: "1px solid rgba(201,154,63,0.26)",
            color: "#c99a3f",
          }}
        >
          <span
            aria-hidden
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "currentColor",
            }}
          />
          <span style={{ fontWeight: 600 }}>No content generated yet</span>
          <span style={{ color: t(0.42), fontWeight: 500 }}>
            ·{" "}
            {starting
              ? "Starting the run…"
              : template
                ? `Press Run and ${template.name} writes all ${sections.length}`
                : "No template on this series"}
          </span>
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "208px 1fr 300px",
          gap: 14,
          alignItems: "start",
          marginTop: 18,
        }}
      >
        <Rail topics={rail} activeId={topic.id} filter={filter} setFilter={setFilter} go={go} />

        <div style={{ ...panel(16), padding: 20 }}>
          {template ? (
            <>
              <div style={{ fontSize: 14.5, fontWeight: 700 }}>
                {template.name} will write {sections.length} sections
              </div>
              <p
                style={{
                  margin: "5px 0 16px",
                  fontSize: 12.5,
                  color: t(0.5),
                  textWrap: "pretty",
                }}
              >
                {template.desc ||
                  "Each section gets its own prompt, written in this workspace's voice."}
              </p>

              {/*
                What it will produce, in order.

                Knowing that before you spend ten minutes of model time is the
                whole reason to show it — and it is the difference between a
                button you press hopefully and one you press deliberately.
              */}
              <Label>WHAT IT WILL WRITE</Label>
              <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                {sections.map((section, i) => (
                  <div
                    key={section.id}
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: 10,
                      padding: "6px 8px",
                      borderRadius: 8,
                      background: i % 2 ? "transparent" : w(0.03),
                    }}
                  >
                    <span
                      style={{
                        flex: "0 0 18px",
                        fontFamily: font.mono,
                        fontSize: 10.5,
                        color: t(0.3),
                      }}
                    >
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 12.5 }}>
                      {section.name}
                    </span>
                    <span
                      style={{
                        fontFamily: font.mono,
                        fontSize: 9.5,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        color: t(0.32),
                      }}
                    >
                      {section.type}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            /*
              A shelf with no template cannot write anything, and the fix is on
              the shelf rather than here — so this names the shelf and sends you
              to the list, where its Brief is.
            */
            <>
              <div style={{ fontSize: 14.5, fontWeight: 700 }}>
                {topic.series.name} has no template
              </div>
              <p
                style={{
                  margin: "5px 0 16px",
                  fontSize: 12.5,
                  color: t(0.5),
                  textWrap: "pretty",
                }}
              >
                A template is the set of sections a run writes. Run still works
                — it asks which template to use, every time. Pick one on this
                series&rsquo;s Brief and every topic on the shelf runs with the
                same one, unasked, and this page can show what it will write
                before you press anything.
              </p>
              <Button variant="accent" onClick={() => go("/content")}>
                Open {topic.series.name}
              </Button>
            </>
          )}

          {topic.context.trim() ? (
            <>
              <div style={{ marginTop: 22 }}>
                <Label>CONTEXT FOR THIS TOPIC</Label>
              </div>
              <p
                style={{
                  margin: 0,
                  fontSize: 12.5,
                  color: t(0.62),
                  lineHeight: 1.6,
                  textWrap: "pretty",
                }}
              >
                {topic.context.trim()}
              </p>
            </>
          ) : null}
        </div>

        {/*
          The third column, in the place the reader keeps it.

          It lists the same twelve rows the written page lists, in the same
          type, at the same width — every dot grey, because none of them has
          been written. Losing the column entirely is what made moving between
          a written topic and an unwritten one feel like two different screens.
        */}
        {sections.length ? (
          <div style={{ ...panel(17), padding: 14 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 10,
              }}
            >
              <ListGlyph size={12} stroke={t(0.45)} />
              <span
                style={{
                  fontFamily: font.mono,
                  fontSize: 10,
                  letterSpacing: "0.14em",
                  color: t(0.45),
                }}
              >
                SECTIONS
              </span>
              <span
                style={{
                  marginLeft: "auto",
                  fontFamily: font.mono,
                  fontSize: 10.5,
                  color: t(0.3),
                }}
              >
                0/{sections.length}
              </span>
            </div>

            <div style={{ display: "flex", flexDirection: "column" }}>
              {sections.map((section, i) => (
                <div
                  key={section.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 9,
                    padding: "6px 7px",
                    borderRadius: 9,
                  }}
                >
                  <span
                    style={{
                      fontFamily: font.mono,
                      fontSize: 10,
                      color: t(0.28),
                    }}
                  >
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontSize: 12,
                      color: t(0.55),
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {section.name}
                  </span>
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      flex: "none",
                      borderRadius: "50%",
                      background: w(0.18),
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Label({ children }: { children: string }) {
  return (
    <div
      style={{
        fontFamily: font.mono,
        fontSize: 9.5,
        letterSpacing: "0.14em",
        color: t(0.42),
        marginBottom: 9,
      }}
    >
      {children}
    </div>
  );
}

/**
 * The topics rail, the same one the reader uses.
 *
 * Present here for one reason: without it this page is a cul-de-sac. With it,
 * a topic nobody has written for is just the one you happen to be standing on.
 */
function Rail({
  topics,
  activeId,
  filter,
  setFilter,
  go,
}: {
  topics: RailTopic[];
  activeId: string;
  filter: string;
  setFilter: (value: string) => void;
  go: (href: string) => void;
}) {
  return (
    <UiRail
      label="TOPICS"
      filter={filter}
      onFilter={setFilter}
      filterLabel="Filter topics"
      activeId={activeId}
      items={topics.map((x) => ({
        id: x.id,
        label: x.name,
        count: x.written,
        href: `/content/${x.slug}`,
        icon: (
          <TopicGlyph
            size={12}
            stroke={
              x.total > 0 && x.written === x.total
                ? "#4bb07a"
                : x.written > 0
                  ? "#6a9dff"
                  : t(0.3)
            }
          />
        ),
      }))}
      onPick={(id) => {
        const picked = topics.find((x) => x.id === id);
        if (picked) go(`/content/${picked.slug}`);
      }}
    />
  );
}
