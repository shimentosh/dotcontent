"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import type { Pack } from "@/lib/packs/enbn-website";
import { PACK_STATUSES, type PackStatus } from "@/lib/packs";
import { systemPrompt, userPrompt } from "@/lib/server/prompt";

import {
  type DraftSection,
  type PackDraft,
} from "@/lib/data";
import { useStore } from "@/lib/store";
import { font, ghost, ghostHover, primary, rise, spring, t, w } from "@/lib/theme";
import { Hov } from "@/components/ui/Hov";
import { Field, TextArea, TextInput } from "@/components/ui/Field";
import { PlaceholderChips, Segmented } from "@/components/ui";
import { StepPicker } from "@/components/builder/StepPicker";
import {
  STEP_DRAG,
  StepPalette,
  StepTile,
} from "@/components/builder/StepPalette";
import {
  ChevronDown,
  CloseIcon,
  DragIcon,
  PlusIcon,
} from "@/components/ui/Icons";



const STATUS_OPTIONS = PACK_STATUSES.map((s) => ({ value: s, label: s }));

const chars = (v: string) => `${v.trim().length} chars`;


/**
 * Exactly what a section will be sent, assembled by the server's own code.
 *
 * This used to be a second implementation living here: rules, then context,
 * then audience, in an order the server never used. A preview that composes
 * the prompt differently from the thing that runs it is worse than no preview
 * — it is confidently wrong about the one thing you opened it to check.
 *
 * The brand voice is a labelled placeholder because it belongs to the
 * workspace, not the pack, and which workspace runs this is not known until it
 * runs. Showing the slot is the point: that is where "who is watching" comes
 * from, and it is why the pack no longer asks.
 */
export function composePrompt(draft: PackDraft, section: DraftSection) {
  const pack: Pack = {
    slug: "",
    name: draft.name,
    description: draft.summary,
    version: 1,
    inputs: [],
    purpose: draft.purpose,
    rules: draft.rules,
    sections: draft.sections.map(asDef),
    outputs: [],
  };

  return [
    "=== SYSTEM ===",
    systemPrompt(pack, {}, "[ the workspace's brand voice is prepended here ]"),
    "=== USER ===",
    userPrompt(asDef(section), pack, {}, {}),
  ].join("\n\n");
}

/**
 * A draft section in the shape the prompt builder reads.
 *
 * The builder edits names and briefs; the engine runs titles and instructions.
 * One translation, here, so the preview cannot drift from the run.
 */
function asDef(section: DraftSection) {
  return {
    id: section.id,
    title: section.name,
    summary: "",
    dependsOn: [] as string[],
    tier: "standard" as const,
    instruction: section.brief.trim() || "— no prompt written yet —",
  };
}

/**
 * The line between two steps, with the + that puts one there.
 *
 * The button sits ON the connector rather than beside it, because the gap is
 * the thing it acts on. Pressing it opens the picker in place, so the steps
 * either side stay on screen while you choose — which a centred modal over a
 * dimmed page cannot do.
 */
function Insert({
  at,
  open,
  onOpen,
  onPick,
  onDropStep,
  first = false,
  last = false,
}: {
  at: number;
  open: boolean;
  onOpen: (at: number | null) => void;
  onPick: (name: string, type: string, at?: number) => void;
  /** A step dragged in from the palette, or an existing one being moved. */
  onDropStep: (e: React.DragEvent, at: number) => void;
  first?: boolean;
  last?: boolean;
}) {
  const [over, setOver] = useState(false);
  const [near, setNear] = useState(false);
  if (open) {
    return (
      <div style={{ padding: "10px 0 10px 27px" }}>
        <StepPicker
          onPick={(name, type) => {
            onPick(name, type, at);
            onOpen(null);
          }}
          onCancel={() => onOpen(null)}
        />
      </div>
    );
  }

  // An empty flow has no line to hang a dot on; the caller shows a full-width
  // invitation there instead.
  if (first && last) return null;

  return (
    <div
      onDragOver={(e) => {
        // Only claim the drop if it is one of ours; without preventDefault the
        // browser refuses it and the drag ends in the "no" cursor.
        if (!e.dataTransfer.types.includes(STEP_DRAG)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        onDropStep(e, at);
      }}
      onPointerEnter={() => setNear(true)}
      onPointerLeave={() => setNear(false)}
      style={{
        position: "relative",
        // Grows while something is being dragged over it, so the gap you are
        // about to drop into is the one that opened up.
        height: over ? 46 : first ? 20 : 26,
        marginLeft: 27,
        transition: `height 140ms ${spring}`,
      }}
    >
      <span
        aria-hidden
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 2,
          background: over ? "#0057fc" : w(0.16),
          transition: `background 140ms ${spring}`,
        }}
      />

      {over ? (
        <span
          aria-hidden
          style={{
            position: "absolute",
            left: 14,
            right: 0,
            top: "50%",
            height: 2,
            borderRadius: 2,
            background: "#0057fc",
            boxShadow: "0 0 12px rgba(0,87,252,0.7)",
          }}
        />
      ) : null}
      {/*
        The + only when the cursor is in this gap.

        One dashed circle between every pair of steps meant a twelve-step
        template drew thirteen of them down the side, and the flow read as a
        row of buttons with some text next to them. The gap is still clickable
        and still a drop target; it just stops advertising itself when you are
        reading rather than editing.

        Kept mounted rather than conditionally rendered, so it can fade — and
        so it stays in the tab order for anyone not using a mouse.
      */}
      <Hov
        onClick={() => onOpen(at)}
        aria-label={first ? "Add a step at the start" : `Add a step after step ${at}`}
        title="Add a step here"
        style={{
          position: "absolute",
          left: -10,
          top: "50%",
          transform: "translateY(-50%)",
          width: 22,
          height: 22,
          display: "grid",
          placeItems: "center",
          borderRadius: "50%",
          cursor: "pointer",
          color: t(0.4),
          background: "#0e0e14",
          border: `1px dashed ${w(0.2)}`,
          opacity: near && !over ? 1 : 0,
          pointerEvents: near ? "auto" : "none",
          transition: `opacity 140ms ${spring}, color 160ms ${spring}, border-color 160ms ${spring}, background 160ms ${spring}`,
        }}
        hover={{ color: "#fff", background: "#0057fc", borderColor: "#0057fc" }}
      >
        <PlusIcon size={11} strokeWidth={2.4} stroke="currentColor" />
      </Hov>
    </div>
  );
}

/**
 * @param slug The template being edited, from `/builder/<slug>`. Absent on
 *   `/builder`, which is where a template that does not exist yet is written.
 */
export function BuilderView({ slug }: { slug?: string } = {}) {
  const {
    draft,
    setDraft,
    updateDraftSection,
    removeDraftSection,
    moveDraftSection,
    moveDraftSectionTo,
    addDraftSection,
    editingSection,
    setEditingSection,
    testSection,
    setTestSection,
    draftPackId,
    packs,
    savePack,
    loadPackDraft,
    go,
  } = useStore();

  /*
   * The URL is what says which template this is.
   *
   * Clicking Edit in the library loads the draft and navigates in one go, so
   * this usually finds the work already done. It matters on the other ways in
   * — a pasted link, a refresh, a second tab — where the click never happened
   * and the packs arrive a moment after the screen does. It runs once per
   * template: after it, `draftPackId` matches the slug, so nothing here can
   * overwrite what is being typed.
   */
  useEffect(() => {
    if (!slug || draftPackId === slug) return;
    if (!packs.some((p) => p.id === slug)) return;
    loadPackDraft(slug);
  }, [slug, draftPackId, packs, loadPackDraft]);

  /*
   * The two prompt boxes, so the placeholder chips can insert at the cursor.
   *
   * One ref for all the sections rather than one each: the builder opens
   * exactly one section at a time, so only one of these boxes is ever mounted.
   */
  const rulesBox = useRef<HTMLTextAreaElement>(null);
  const sectionBox = useRef<HTMLTextAreaElement>(null);

  /** Editing a pack that already exists, rather than writing a new one. */
  const editingPack = packs.find((p) => p.id === draftPackId) ?? null;

  /** Which gap in the flow has the picker open, if any. */
  const [insertAt, setInsertAt] = useState<number | null>(null);
  /** The step being dragged within the flow, so a drop can move it. */
  const [dragging, setDragging] = useState<string | null>(null);

  /**
   * Something dropped on a gap in the flow.
   *
   * Two things can be dropped: a kind from the palette, which becomes a new
   * step at that index, and a step already on the canvas, which moves there.
   * Moving accounts for the row leaving its old place — dropping step 2 into
   * the gap below step 5 has to land after 5, not after what used to be 5.
   */
  const onDropStep = useCallback(
    (e: React.DragEvent, at: number) => {
      const raw = e.dataTransfer.getData(STEP_DRAG);
      if (!raw) return;
      e.preventDefault();

      const payload = JSON.parse(raw) as {
        name?: string;
        type?: string;
        id?: string;
      };

      if (payload.id) {
        moveDraftSectionTo(payload.id, at);
        setDragging(null);
        return;
      }
      if (payload.name) addDraftSection(payload.name, payload.type ?? payload.name, at);
    },
    [addDraftSection, moveDraftSectionTo],
  );

  const written = draft.sections.filter((s) => s.brief.trim()).length;

  const preview = useMemo(() => {
    const section =
      draft.sections.find((s) => s.id === testSection) ?? draft.sections[0];
    return section ? { section, text: composePrompt(draft, section) } : null;
  }, [draft, testSection]);


  /*
   * A slug with no template behind it — a link to one that was deleted, or a
   * typo. Saying so beats opening an empty builder: that looks like the new
   * template screen, and Save would quietly make a second template rather than
   * edit the one the link was for.
   */
  if (slug && !packs.some((p) => p.id === slug)) {
    return (
      <div
        style={{
          ...rise(240),
          maxWidth: 1180,
          margin: "0 auto",
          padding: "26px 30px",
        }}
      >
        <h1
          style={{
            fontFamily: font.tight,
            fontSize: 22,
            fontWeight: 700,
            letterSpacing: "-0.02em",
            margin: "0 0 6px",
          }}
        >
          {packs.length ? "No template by that name" : "Opening the builder…"}
        </h1>
        <p style={{ margin: "0 0 18px", fontSize: 13.5, color: t(0.48) }}>
          {packs.length
            ? "It may have been deleted. The library has the rest."
            : "Loading the template library."}
        </p>
        {packs.length ? (
          <Hov
            onClick={() => go("/packs")}
            style={{
              height: 33,
              padding: "0 14px",
              display: "inline-grid",
              placeItems: "center",
              borderRadius: 10,
              fontSize: 12.5,
              fontWeight: 600,
              ...ghost,
            }}
            hover={ghostHover}
          >
            Back to templates
          </Hov>
        ) : null}
      </div>
    );
  }

  return (
    <div
      style={{
        ...rise(240),
        /*
         * The builder takes the window.
         *
         * It was a 1060px column down the middle of a 1900px screen: the flow
         * you are assembling had a third of the room while two thirds sat
         * empty either side, and the parts you assemble it from lived in a
         * modal because there was nowhere to put them. A builder is a bench —
         * rail, canvas, parts — and all three fit only if it stops pretending
         * to be a document.
         */
        maxWidth: "none",
        margin: "0 auto",
        padding: "26px 26px 40px",
      }}
    >
      <h1
        style={{
          fontFamily: font.tight,
          fontSize: 28,
          fontWeight: 700,
          letterSpacing: "-0.025em",
          margin: "0 0 5px",
        }}
      >
        {draft.name.trim() || "New Content Template"}
      </h1>
      <p style={{ margin: "0 0 22px", fontSize: 13.5, color: t(0.48) }}>
        {editingPack
          ? `Editing ${editingPack.name} — the same brief the template runs on.`
          : "Describe what you want produced. No wiring, no nodes."}
      </p>

      <div
        style={{
          display: "grid",
          /*
           * The canvas, and the parts you build it from.
           *
           * The third column on the left used to be a step rail — Pack,
           * Sections, Shared brief — which is a table of contents for a page
           * that is now one page. What is left is the thing you are editing
           * and the shelf you take pieces off.
           */
          gridTemplateColumns: "minmax(0, 1fr) 268px",
          gap: 16,
          alignItems: "start",
        }}
      >

        <div
          style={{
            padding: 22,
            borderRadius: 18,
            background: w(0.045),
            border: `1px solid ${w(0.08)}`,
            backdropFilter: "blur(30px) saturate(155%)",
            boxShadow: `0 12px 34px rgba(0,0,0,0.32), inset 0 1px 0 ${w(0.06)}`,
          }}
        >

          {/*
            One page, not three steps.

            The wizard gated the only screen that matters behind a step
            you had already filled in: two fields, then Continue, before
            you could see a single section. Everything is on one page now,
            in the order you actually work — what it is called, what it
            produces, then the brief that rides on all of it.
          */}
            <>
              <Field label="Template name">
                <TextInput
                  value={draft.name}
                  onChange={(e) => setDraft({ name: e.target.value })}
                  placeholder="e.g. Dropship Product Teardown"
                />
              </Field>
              <Field label="One-line description" hint="shown in the library">
                <TextInput
                  value={draft.summary}
                  onChange={(e) => setDraft({ summary: e.target.value })}
                  placeholder="What someone picking this template needs to know"
                />
              </Field>
              <Field label="Status" hint="what the library shows beside it">
                <Segmented
                  full
                  tone="accent"
                  options={STATUS_OPTIONS}
                  value={draft.status}
                  onChange={(status) =>
                    setDraft({ status: status as PackStatus })
                  }
                  style={{ height: 38 }}
                />
              </Field>
            </>

            <>
              {/*
                A flow, not a list.

                The steps run in order and each one is written on top of the
                ones before it, so the thing on screen should be a chain: a
                line from each step to the next, and a + ON that line where a
                new one would go. A stack of rows with one "Add Section"
                button at the bottom said neither — every step landed at the
                end regardless of where you were looking, and getting it into
                the middle meant walking it up with the arrows.
              */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  marginBottom: 12,
                }}
              >
                <Insert
                  at={0}
                  open={insertAt === 0}
                  onOpen={setInsertAt}
                  onPick={addDraftSection}
                  onDropStep={onDropStep}
                  first
                  last={draft.sections.length === 0}
                />

                {/* Nothing in the flow yet: a dot on a line nobody can see is
                    not an invitation, so the empty state is the invitation. */}
                {draft.sections.length === 0 && insertAt !== 0 ? (
                  <Hov
                    onClick={() => setInsertAt(0)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                      padding: 16,
                      borderRadius: 13,
                      border: `1px dashed ${w(0.16)}`,
                      fontSize: 12.5,
                      fontWeight: 600,
                      color: t(0.55),
                      cursor: "pointer",
                    }}
                    hover={{ background: w(0.05), color: "#f0f0f4" }}
                  >
                    <PlusIcon size={14} strokeWidth={2.2} />
                    <span>Add the first step</span>
                  </Hov>
                ) : null}
                {draft.sections.map((s, i) => {
                  const open = editingSection === s.id;
                  const empty = !s.brief.trim();
                  return (
                    <div key={s.id} style={{ position: "relative" }}>
                    {/*
                      The spine, carried THROUGH the row.

                      It only existed in the gaps before, so a twelve-step
                      template drew twelve short lines with cards sitting
                      beside them — a list with decoration rather than a
                      sequence. Running it behind the row and putting a node on
                      it at each step is what makes the order look like an
                      order.
                    */}
                    <span
                      aria-hidden
                      style={{
                        position: "absolute",
                        left: 27,
                        top: 0,
                        bottom: 0,
                        width: 2,
                        background: w(0.16),
                      }}
                    />
                    <span
                      aria-hidden
                      style={{
                        position: "absolute",
                        left: 22,
                        top: 15,
                        width: 12,
                        height: 12,
                        borderRadius: "50%",
                        background: "#0e0e14",
                        border: `2px solid ${
                          open ? "#0057fc" : empty ? w(0.22) : "#4bb07a"
                        }`,
                        boxShadow: open ? "0 0 10px rgba(0,87,252,0.6)" : undefined,
                        transition: `border-color 160ms ${spring}`,
                      }}
                    />
                    <div
                      style={{ marginLeft: 44 }}
                    >
                    <div
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData(
                          STEP_DRAG,
                          JSON.stringify({ id: s.id }),
                        );
                        e.dataTransfer.effectAllowed = "move";
                        setDragging(s.id);
                      }}
                      onDragEnd={() => setDragging(null)}
                      style={{
                        borderRadius: 13,
                        background: open ? w(0.07) : w(0.045),
                        border: `1px solid ${open ? w(0.18) : w(0.08)}`,
                        overflow: "hidden",
                        opacity: dragging === s.id ? 0.45 : 1,
                        transition:
                          "background 150ms, border-color 150ms, opacity 150ms",
                      }}
                    >
                      <Hov
                        onClick={() => setEditingSection(open ? null : s.id)}
                        aria-expanded={open}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 11,
                          padding: "10px 13px",
                          cursor: "pointer",
                        }}
                        hover={{ background: w(0.035) }}
                      >
                        <span
                          title="Drag to reorder"
                          style={{ cursor: "grab", display: "flex" }}
                        >
                          <DragIcon />
                        </span>
                        <span
                          style={{
                            fontFamily: font.mono,
                            fontSize: 11,
                            color: t(0.32),
                          }}
                        >
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        {/* The same tile it wore in the palette: a column of
                            near-identical cards needs one thing that says what
                            step 7 actually is without being read. */}
                        <StepTile name={s.type} size={26} />
                        <span style={{ fontSize: 13, fontWeight: 600 }}>
                          {s.name || "Untitled section"}
                        </span>
                        {/* Only when it says something the name does not:
                            "Research · RESEARCH" is one fact printed twice. */}
                        {s.type.toLowerCase() !== s.name.trim().toLowerCase() ? (
                          <span
                            style={{
                              fontSize: 9.5,
                              fontFamily: font.mono,
                              letterSpacing: "0.1em",
                              textTransform: "uppercase",
                              padding: "2px 6px",
                              borderRadius: 5,
                              background: w(0.07),
                              color: t(0.5),
                            }}
                          >
                            {s.type}
                          </span>
                        ) : null}
                        {empty ? (
                          <span
                            style={{
                              fontSize: 9.5,
                              fontFamily: font.mono,
                              letterSpacing: "0.1em",
                              padding: "2px 6px",
                              borderRadius: 5,
                              background: "rgba(201,154,63,0.16)",
                              color: "#c99a3f",
                            }}
                          >
                            NO PROMPT
                          </span>
                        ) : null}

                        <span
                          style={{
                            marginLeft: "auto",
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                          }}
                        >
                          <Stepper
                            label="Move up"
                            disabled={i === 0}
                            onClick={() => moveDraftSection(s.id, -1)}
                          >
                            <ChevronDown
                              size={12}
                              stroke="currentColor"
                              style={{ transform: "rotate(180deg)" }}
                            />
                          </Stepper>
                          <Stepper
                            label="Move down"
                            disabled={i === draft.sections.length - 1}
                            onClick={() => moveDraftSection(s.id, 1)}
                          >
                            <ChevronDown size={12} stroke="currentColor" />
                          </Stepper>
                          <span
                            style={{
                              fontSize: 11.5,
                              fontWeight: 600,
                              padding: "0 4px",
                              color: open ? "#6a9dff" : t(0.45),
                            }}
                          >
                            {open ? "Done" : "Configure"}
                          </span>
                        </span>
                      </Hov>

                      {open ? (
                        <div
                          style={{
                            padding: "4px 13px 14px",
                            borderTop: `1px solid ${w(0.07)}`,
                          }}
                        >
                          <div style={{ marginTop: 12 }}>
                            <Field label="Section name">
                              <TextInput
                                value={s.name}
                                onChange={(e) =>
                                  updateDraftSection(s.id, {
                                    name: e.target.value,
                                  })
                                }
                                placeholder="e.g. Teardown Beats"
                              />
                            </Field>
                          </div>

                          <Field
                            label="Section prompt"
                            hint="written on top of the template rules"
                            counter={chars(s.brief)}
                          >
                            <TextArea
                              boxRef={sectionBox}
                              rows={10}
                              value={s.brief}
                              onChange={(e) =>
                                updateDraftSection(s.id, {
                                  brief: e.target.value,
                                })
                              }
                              placeholder={
                                "What this step does, and exactly what it returns."
                              }
                            />
                          </Field>

                          <PlaceholderChips
                            target={sectionBox}
                            onInsert={(brief) =>
                              updateDraftSection(s.id, { brief })
                            }
                          />

                          <div style={{ display: "flex", gap: 8 }}>
                            <Hov
                              onClick={() => {
                                // The preview is further down the same page
                                // now, rather than a step of its own — so this
                                // points it at this section and goes there.
                                setTestSection(s.id);
                                document
                                  .getElementById("prompt-preview")
                                  ?.scrollIntoView({ behavior: "smooth", block: "center" });
                              }}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                                height: 30,
                                padding: "0 12px",
                                borderRadius: 9,
                                fontSize: 11.5,
                                fontWeight: 600,
                                ...ghost,
                              }}
                              hover={ghostHover}
                            >
                              Preview full prompt
                            </Hov>
                            <Hov
                              onClick={() => removeDraftSection(s.id)}
                              style={{
                                marginLeft: "auto",
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                                height: 30,
                                padding: "0 12px",
                                borderRadius: 9,
                                fontSize: 11.5,
                                fontWeight: 600,
                                cursor: "pointer",
                                color: "#d1656b",
                                background: "rgba(209,101,107,0.12)",
                                border: "1px solid rgba(209,101,107,0.25)",
                              }}
                              hover={{ background: "rgba(209,101,107,0.22)" }}
                            >
                              <CloseIcon size={10} stroke="currentColor" />
                              Remove
                            </Hov>
                          </div>
                        </div>
                      ) : null}
                    </div>
                    </div>

                    <Insert
                      at={i + 1}
                      open={insertAt === i + 1}
                      onOpen={setInsertAt}
                      onPick={addDraftSection}
                      onDropStep={onDropStep}
                      last={i === draft.sections.length - 1}
                    />
                    </div>
                  );
                })}
              </div>
            </>

            {/*
              One note for all four, rather than four hints saying the same
              thing. What they share is the only thing worth knowing: they are
              sent above every section&rsquo;s own prompt, on every section, so
              they are paid for once per section and repetition costs money.
            */}
            <div
              style={{
                display: "flex",
                gap: 11,
                marginBottom: 16,
                padding: "11px 13px",
                borderRadius: 12,
                background: w(0.04),
                borderWidth: 1,
                borderStyle: "solid",
                borderColor: w(0.08),
                fontSize: 12,
                color: t(0.55),
                textWrap: "pretty",
              }}
            >
              <span>
                All four are sent to the model above every section&rsquo;s own
                prompt, in this order. Sections alone are enough for a simple
                pack — fill these in when every section needs to know the same
                thing, and keep them short, because they ride on all{" "}
                {draft.sections.length || "your"} of them.
              </span>
            </div>
            <Field
              label="Purpose"
              hint="what it makes, and what it must not do"
              counter={chars(draft.purpose)}
            >
              <TextArea
                rows={5}
                value={draft.purpose}
                onChange={(e) => setDraft({ purpose: e.target.value })}
                placeholder="Turn one product page into a teardown video plus the social package around it."
              />
            </Field>
            <Field
              label="Template rules"
              hint="prepended to every section prompt"
              counter={chars(draft.rules)}
            >
              <TextArea
                boxRef={rulesBox}
                rows={10}
                value={draft.rules}
                onChange={(e) => setDraft({ rules: e.target.value })}
                placeholder={
                  "CORE RULES:\n1. Use only the supplied context.\n2. Never invent claims or pricing."
                }
              />
            </Field>
            <PlaceholderChips
              target={rulesBox}
              onInsert={(rules) => setDraft({ rules })}
              note="Click to insert. Each one is replaced with the run's own value when it starts. The rules ride on every section, so a fixed line that always names the part belongs here rather than in each one."
            />
            <>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 6,
                  marginBottom: 14,
                }}
              >
                {draft.sections.map((s, i) => {
                  const on = preview?.section.id === s.id;
                  return (
                    <Hov
                      as="span"
                      key={s.id}
                      onClick={() => setTestSection(s.id)}
                      aria-pressed={on}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "6px 11px",
                        borderRadius: 9,
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: "pointer",
                        background: on ? "rgba(0,87,252,0.16)" : w(0.05),
                        border: `1px solid ${
                          on ? "rgba(0,87,252,0.4)" : w(0.08)
                        }`,
                        color: on ? "#6a9dff" : t(0.6),
                      }}
                      hover={on ? undefined : { background: w(0.1) }}
                    >
                      <span style={{ fontFamily: font.mono, fontSize: 10 }}>
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      {s.name}
                    </Hov>
                  );
                })}
              </div>

              {preview ? (
                <>
                  <div
                    id="prompt-preview"
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      marginBottom: 7,
                      scrollMarginTop: 90,
                    }}
                  >
                    <span style={{ fontSize: 12.5, fontWeight: 600 }}>
                      Composed prompt
                    </span>
                    <span
                      style={{
                        marginLeft: "auto",
                        fontFamily: font.mono,
                        fontSize: 10,
                        color: t(0.32),
                      }}
                    >
                      {preview.text.length} chars
                    </span>
                  </div>
                  <pre
                    style={{
                      margin: "0 0 16px",
                      padding: "14px 16px",
                      maxHeight: 380,
                      overflow: "auto",
                      borderRadius: 12,
                      background: "rgba(0,0,0,0.34)",
                      border: `1px solid ${w(0.08)}`,
                      fontFamily: font.mono,
                      fontSize: 11.5,
                      lineHeight: 1.7,
                      color: t(0.78),
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {preview.text}
                  </pre>
                </>
              ) : (
                <p style={{ fontSize: 13, color: t(0.45), marginBottom: 20 }}>
                  Add a section first — there is nothing to compose yet.
                </p>
              )}
            </>
            <div style={{ marginBottom: 20 }}>
              {[
                ["Name", draft.name || "—"],
                ["Description", draft.summary || "—"],
                ["Purpose", chars(draft.purpose)],
                ["Template rules", chars(draft.rules)],
                [
                  "Sections",
                  `${draft.sections.length} · ${written} with a prompt`,
                ],
              ].map(([k, v]) => (
                <div
                  key={k}
                  style={{
                    display: "flex",
                    gap: 14,
                    padding: "9px 2px",
                    borderBottom: `1px solid ${w(0.055)}`,
                    fontSize: 12.5,
                  }}
                >
                  <span style={{ width: 130, flex: "none", color: t(0.45) }}>
                    {k}
                  </span>
                  <span style={{ minWidth: 0 }}>{v}</span>
                </div>
              ))}

              {written < draft.sections.length ? (
                <div
                  style={{
                    marginTop: 14,
                    padding: "10px 12px",
                    borderRadius: 10,
                    fontSize: 12.5,
                    background: "rgba(201,154,63,0.12)",
                    border: "1px solid rgba(201,154,63,0.28)",
                    color: "#c99a3f",
                  }}
                >
                  {draft.sections.length - written} section
                  {draft.sections.length - written === 1 ? "" : "s"} still have
                  no prompt — they will run on the pack rules alone.
                </div>
              ) : null}
            </div>

          {/*
            Two buttons, because there is nowhere left to go.

            Back and Continue existed to walk you through three steps. With
            everything on one page they were a tour of a room you are standing
            in — the only questions left are whether you are keeping this and
            whether you are done looking at it.
          */}
          {/*
            Pinned to the bottom of the window.

            The page is a whole template — twelve prompts, the rules, the
            composed preview — so Save sat several screens below wherever you
            were working, and keeping it meant scrolling to the end to press a
            button about work you had already finished. Sticky rather than
            fixed, so it stays inside its column and never covers the palette.
          */}
          <div
            style={{
              position: "sticky",
              bottom: 0,
              zIndex: 1,
              display: "flex",
              gap: 8,
              marginTop: 16,
              padding: "12px 14px",
              marginInline: -14,
              borderTop: `1px solid ${w(0.09)}`,
              borderRadius: "0 0 14px 14px",
              // Opaque enough that a line of prompt scrolling under it does
              // not ghost through the buttons.
              background: "linear-gradient(180deg, rgba(12,12,17,0.94), rgba(12,12,17,0.99))",
              backdropFilter: "blur(20px) saturate(150%)",
              WebkitBackdropFilter: "blur(20px) saturate(150%)",
            }}
          >
            <Hov
              onClick={() => go("/packs")}
              style={{
                height: 33,
                padding: "0 14px",
                display: "grid",
                placeItems: "center",
                borderRadius: 10,
                fontSize: 12.5,
                fontWeight: 600,
                ...ghost,
              }}
              hover={ghostHover}
            >
              Cancel
            </Hov>
            <Hov
              onClick={() => {
                savePack();
                go("/packs");
              }}
              style={{
                marginLeft: "auto",
                height: 33,
                padding: "0 16px",
                display: "grid",
                placeItems: "center",
                borderRadius: 10,
                fontSize: 12.5,
                fontWeight: 600,
                ...primary,
              }}
            >
              {editingPack ? "Save changes" : "Create template"}
            </Hov>
          </div>
        </div>

        {/*
          The parts of the bench, always to hand.

          It used to swap for a summary card on the steps that were not the
          flow — which made sense when there were steps. There is one page now,
          the flow is always on it, so the shelf you take pieces off is always
          the useful thing to have beside it. The summary's other half, the
          name and the one-line, is on the page itself.
        */}
        <StepPalette onAdd={(name, type) => addDraftSection(name, type)} />
      </div>
    </div>
  );
}

/** The small up/down reorder button on a section row. */
function Stepper({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  const style: CSSProperties = {
    width: 22,
    height: 22,
    display: "grid",
    placeItems: "center",
    borderRadius: 7,
    color: t(0.45),
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.25 : 1,
  };
  return (
    <Hov
      as="span"
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onClick();
      }}
      style={style}
      hover={disabled ? undefined : { background: w(0.1), color: "#f0f0f4" }}
    >
      {children}
    </Hov>
  );
}
