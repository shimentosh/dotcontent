"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import {
  LANGUAGES,
  PROJECT_STATUS,
  PROJECT_STATUSES,
  langLabel,
  type Project,
  type ProjectStatus,
} from "@/lib/data";
import { useStore } from "@/lib/store";
import { color, font, ghost, ghostHover, kicker, layer, primary, primaryActive, primaryHover, spring, t, w } from "@/lib/theme";
import { Hov } from "@/components/ui/Hov";
import { WorkspaceMark } from "@/components/ui/WorkspaceMark";
import { TextArea, TextInput } from "@/components/ui/Field";
import {
  ArchiveIcon,
  CheckIcon,
  CloseIcon,
  GlobeIcon,
  LiveIcon,
  PauseIcon,
  PencilIcon,
  PlanIcon,
  PlusIcon,
  TargetIcon,
  TrashIcon,
  VoiceIcon,
} from "@/components/ui/Icons";

/**
 * Editing a workspace: what it publishes as, where it is in its life, and the
 * voice every pack under it writes in.
 *
 * A sheet rather than an inline editor on the card. The voice is a page of
 * prose — it needs room the overview does not have, and expanding a card in
 * place shoves everything under it around while you type.
 */
export function ProjectSheet() {
  const {
    projects,
    projectSheet,
    closeProjectSheet,
    updateProject,
    addProject,
    removeProject,
    askConfirm,
  } = useStore();

  useEffect(() => {
    if (projectSheet === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeProjectSheet();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [projectSheet, closeProjectSheet]);

  if (projectSheet === null) return null;

  /* Creating and editing are the same eight fields, so they are the same form.
     A blank workspace stands in for the row that does not exist yet — every
     field starts empty and Save appends instead of patching. */
  const making = projectSheet === "new";
  const project = making ? BLANK : projects[projectSheet];
  if (!project) return null;

  return (
    /*
      Keyed by the project, so opening a different one remounts the editor with
      that project's values. The alternative — one long-lived form reseeded by
      an effect — is a render pass spent showing the previous brand's voice, and
      exactly what `react-hooks/set-state-in-effect` is pointing at.
    */
    <Editor
      key={String(projectSheet)}
      project={project}
      making={making}
      // The last workspace has nowhere to send you: every screen reads its
      // packs, topics and voice off the current one.
      onDelete={
        making || projects.length <= 1
          ? undefined
          : () =>
              askConfirm({
                title: `Delete ${project.name}?`,
                body: "Its topics, templates and content go with it. This cannot be undone.",
                confirmLabel: "Delete workspace",
                onConfirm: () => {
                  removeProject(projectSheet);
                  closeProjectSheet();
                },
              })
      }
      onClose={closeProjectSheet}
      onSave={(patch) => {
        if (making) addProject(patch);
        else updateProject(projectSheet, patch);
        closeProjectSheet();
      }}
    />
  );
}

/** The longest edge an uploaded mark is kept at. */
const MARK_PX = 256;

/**
 * A picked file, as a small square data URL.
 *
 * Downscaled and re-encoded rather than read straight through: a photo off a
 * phone is several megabytes of base64, and this one is going into React state
 * to be drawn at 24 pixels in the sidebar. Cropped to a centre square first, so
 * a portrait does not arrive squashed.
 */
function readMark(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const side = Math.min(img.width, img.height);
      const canvas = document.createElement("canvas");
      canvas.width = MARK_PX;
      canvas.height = MARK_PX;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("no 2d context"));
        return;
      }
      ctx.drawImage(
        img,
        (img.width - side) / 2,
        (img.height - side) / 2,
        side,
        side,
        0,
        0,
        MARK_PX,
        MARK_PX,
      );
      resolve(canvas.toDataURL("image/webp", 0.82));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("not an image"));
    };
    img.src = url;
  });
}

/** What a workspace looks like before you have typed anything into it. */
const BLANK: Project = {
  // No id: it does not exist on the server until Save creates it.
  id: "",
  name: "",
  handle: "",
  channel: "",
  status: "Planning",
  goal: "",
  brandVoice: "",
  tint: "linear-gradient(150deg,#6a9dff,#0043c8)",
  photo: null,
  langs: [],
  topics: "0",
  packs: "0",
  content: "0",
  run: "Idle",
  dot: "rgba(240,240,244,0.3)",
};

/** The icon each state gets. Held here rather than in data.ts, which is strings. */
const STATUS_ICON: Record<ProjectStatus, (p: { size?: number; stroke?: string }) => ReactNode> = {
  Active: LiveIcon,
  Planning: PlanIcon,
  Paused: PauseIcon,
  Archived: ArchiveIcon,
};

/**
 * A band of the form.
 *
 * The fields were a flat stack of eight, which is the shape that makes a dialog
 * feel like a database table with a Save button. Three named groups — who it
 * is, where it publishes, how it writes — turn the same eight into something
 * you can scan for the one you came to change.
 */
function Group({
  label,
  aside,
  children,
}: {
  label: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section style={{ marginBottom: 22 }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 8,
          marginBottom: 11,
        }}
      >
        <span style={kicker(9.5)}>{label}</span>
        {aside ? <span style={{ marginLeft: "auto" }}>{aside}</span> : null}
      </div>
      {children}
    </section>
  );
}

/** Label above a control, without `Field`'s built-in bottom margin. */
function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label style={{ display: "block" }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 7,
          marginBottom: 6,
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: t(0.82) }}>
          {label}
        </span>
        {hint ? (
          <span style={{ fontSize: 11, color: t(0.36) }}>{hint}</span>
        ) : null}
      </div>
      {children}
    </label>
  );
}

function Editor({
  project,
  making,
  onClose,
  onSave,
  onDelete,
}: {
  project: Project;
  /** Creating rather than editing — the copy and the Save button change. */
  making: boolean;
  onClose: () => void;
  onSave: (patch: Partial<Project>) => void;
  /** Absent when there is nothing to delete, or nothing left to delete it to. */
  onDelete?: () => void;
}) {
  // Local until Save. The brand voice governs every line the project produces,
  // so a keystroke reaching the live project as you type would make "close
  // without saving" impossible.
  const [name, setName] = useState(project.name);
  const [handle, setHandle] = useState(project.handle);
  const [langs, setLangs] = useState<string[]>(project.langs);
  const [channel, setChannel] = useState(project.channel);
  const [status, setStatus] = useState<ProjectStatus>(project.status);
  const [goal, setGoal] = useState(project.goal);
  const [voice, setVoice] = useState(project.brandVoice);
  const [adding, setAdding] = useState("");
  const [photo, setPhoto] = useState<string | null>(project.photo);
  const [photoError, setPhotoError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const pickPhoto = async (file?: File | null) => {
    if (!file) return;
    setPhotoError("");
    try {
      setPhoto(await readMark(file));
    } catch {
      // A .heic, a PDF renamed to .png, a file the decoder simply refuses —
      // all of which land here rather than as a broken square on four screens.
      setPhotoError("That file could not be read as an image.");
    }
  };

  /* A project's own languages first, then the rest of the offered set. Keeps a
     language it already had — one typed in before this list existed, say — from
     vanishing out of the picker just because it is not on the list. */
  const offered = [...langs, ...LANGUAGES.filter((l) => !langs.includes(l))];

  const toggleLang = (lang: string) =>
    setLangs((list) =>
      list.includes(lang) ? list.filter((l) => l !== lang) : [...list, lang],
    );

  const addLang = () => {
    const next = adding.trim();
    setAdding("");
    if (!next || langs.includes(next)) return;
    setLangs((list) => [...list, next]);
  };

  const named = name.trim().length > 0;

  const save = () => {
    // Guarded rather than merely styled disabled: Enter in a text field and a
    // click both land here, and a workspace with no name is a row you cannot
    // find again. When editing, the existing name stands.
    if (!named && making) return;
    onSave({
      name: name.trim() || project.name,
      handle: handle.trim() || project.handle,
      langs,
      photo,
      channel: channel.trim(),
      status,
      goal: goal.trim(),
      // Trimmed, not coerced back: clearing the box is how you remove a voice,
      // and that has to be something you can do.
      brandVoice: voice.trim(),
    });
  };

  const voiceChars = voice.trim().length;

  return (
    <Hov
      interactive={false}
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: layer.sheet,
        background: "rgba(4,4,8,0.58)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        display: "grid",
        placeItems: "center",
        padding: 30,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={making ? "New workspace" : `Edit ${project.name}`}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 620,
          maxHeight: "86vh",
          display: "flex",
          flexDirection: "column",
          borderRadius: 24,
          background: "rgba(24,24,30,0.78)",
          backdropFilter: "blur(60px) saturate(155%)",
          WebkitBackdropFilter: "blur(60px) saturate(155%)",
          border: `1px solid ${w(0.13)}`,
          boxShadow: `0 50px 110px rgba(0,0,0,0.65), inset 0 1px 0 ${w(0.14)}`,
          overflow: "hidden",
          animation: "os-pop 180ms ease-out",
        }}
      >
        {/*
          The header is the project as it will look once saved — the tile, the
          name being typed, the status being chosen. It is the only preview in
          the sheet, and it costs nothing: the same values the fields hold.
        */}
        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            gap: 13,
            padding: "17px 20px",
            borderBottom: `1px solid ${w(0.08)}`,
            background: `linear-gradient(180deg, ${w(0.05)}, transparent)`,
          }}
        >
          <WorkspaceMark
            project={{ ...project, photo }}
            size={40}
            radius={13}
            style={{ boxShadow: `inset 0 1px 0 ${w(0.3)}, 0 4px 14px -4px rgba(0,0,0,0.6)` }}
          />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  fontFamily: font.tight,
                  fontSize: 17,
                  fontWeight: 700,
                  letterSpacing: "-0.02em",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {name.trim() || (making ? "New workspace" : project.name)}
              </span>
              <span
                style={{
                  flex: "none",
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  fontSize: 10,
                  fontWeight: 600,
                  padding: "2px 8px",
                  borderRadius: 20,
                  background: PROJECT_STATUS[status][1],
                  color: PROJECT_STATUS[status][2],
                }}
              >
                <span
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: "50%",
                    background: PROJECT_STATUS[status][2],
                  }}
                />
                {PROJECT_STATUS[status][0]}
              </span>
            </div>
            <div
              style={{
                marginTop: 2,
                fontSize: 11.5,
                color: t(0.42),
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {handle.trim() || (making ? "Name it, then set it up" : project.handle)}
              {langs.length ? ` · ${langLabel(langs)}` : ""}
            </div>
          </div>

          <Hov
            as="span"
            aria-label="Close"
            onClick={onClose}
            style={{
              flex: "none",
              width: 28,
              height: 28,
              display: "grid",
              placeItems: "center",
              borderRadius: 9,
              cursor: "pointer",
              color: t(0.5),
            }}
            hover={{ background: w(0.1), color: "#f0f0f4" }}
          >
            <CloseIcon size={14} stroke="currentColor" />
          </Hov>
        </div>

        <div style={{ overflowY: "auto", padding: "20px 22px 4px" }}>
          <Group label="IDENTITY">
            {/*
              The mark, and the two things you can do to it.

              A workspace's mark was a gradient square you could not change —
              four brands, four colours, no way to put an actual logo on any of
              them. The tile is the button: click it to pick a file, and the
              icon underneath is what a workspace looks like until you do.
            */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                marginBottom: 16,
              }}
            >
              <Hov
                aria-label={photo ? "Change photo" : "Upload a photo"}
                onClick={() => fileRef.current?.click()}
                style={{ position: "relative", cursor: "pointer" }}
                hover={{ filter: "brightness(1.12)" }}
              >
                <WorkspaceMark
                  project={{ ...project, photo }}
                  size={56}
                  radius={17}
                />
                <span
                  aria-hidden
                  style={{
                    position: "absolute",
                    right: -4,
                    bottom: -4,
                    width: 22,
                    height: 22,
                    display: "grid",
                    placeItems: "center",
                    borderRadius: "50%",
                    background: "rgba(24,24,30,0.94)",
                    border: `1px solid ${w(0.16)}`,
                  }}
                >
                  <PencilIcon size={10} stroke={t(0.75)} />
                </span>
              </Hov>

              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", gap: 7 }}>
                  <Hov
                    as="span"
                    onClick={() => fileRef.current?.click()}
                    style={{
                      display: "grid",
                      placeItems: "center",
                      height: 30,
                      padding: "0 12px",
                      borderRadius: 9,
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "pointer",
                      ...ghost,
                    }}
                    hover={ghostHover}
                  >
                    {photo ? "Change photo" : "Upload photo"}
                  </Hov>
                  {photo ? (
                    <Hov
                      as="span"
                      onClick={() => {
                        setPhoto(null);
                        setPhotoError("");
                      }}
                      style={{
                        display: "grid",
                        placeItems: "center",
                        height: 30,
                        padding: "0 12px",
                        borderRadius: 9,
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: "pointer",
                        color: t(0.6),
                      }}
                      hover={{ background: w(0.08), color: "#f0f0f4" }}
                    >
                      Remove
                    </Hov>
                  ) : null}
                </div>
                <p
                  style={{
                    margin: "6px 0 0",
                    fontSize: 11,
                    lineHeight: 1.5,
                    color: photoError ? color.warn : t(0.36),
                  }}
                >
                  {photoError ||
                    (photo
                      ? "Cropped square and scaled down — it is drawn as small as 24px."
                      : "Square works best. Without one, the workspace icon is used.")}
                </p>
              </div>

              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  void pickPhoto(e.target.files?.[0]);
                  // Cleared so picking the SAME file again still fires change.
                  e.target.value = "";
                }}
              />
            </div>

            <div style={{ display: "grid", gap: 12 }}>
              <Row
              label="Workspace name"
              hint={making && !named ? "required" : "what you call this brand"}
            >
                <TextInput
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="AI Growth Studio"
                />
              </Row>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Row label="Handle" hint="the account">
                  <TextInput
                    value={handle}
                    onChange={(e) => setHandle(e.target.value)}
                    placeholder="@aigrowth"
                  />
                </Row>
                <Row label="Channel name" hint="what a viewer sees">
                  <TextInput
                    value={channel}
                    onChange={(e) => setChannel(e.target.value)}
                    placeholder="AI Growth Studio BN"
                  />
                </Row>
              </div>
            </div>
          </Group>

          <Group
            label="STATUS"
            aside={
              <span style={{ fontSize: 11, color: t(0.36) }}>
                {STATUS_HINT[status]}
              </span>
            }
          >
            {/*
              A segmented control in one sunken track, not four loose buttons.

              As buttons the four read as four separate things you could press,
              which is the wrong grammar for a field that holds exactly one of
              them. In a track the selection is obviously a position, and the
              icon carries the meaning at a glance so you are not reading four
              words to find the one that is lit.
            */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4,1fr)",
                gap: 4,
                padding: 4,
                borderRadius: 14,
                background: "rgba(0,0,0,0.32)",
                border: `1px solid ${w(0.07)}`,
              }}
            >
              {PROJECT_STATUSES.map((key) => {
                const [label, bg, fg] = PROJECT_STATUS[key];
                const Icon = STATUS_ICON[key];
                const on = status === key;
                return (
                  <Hov
                    as="span"
                    key={key}
                    onClick={() => setStatus(key)}
                    aria-pressed={on}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 7,
                      height: 40,
                      borderRadius: 11,
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "pointer",
                      color: on ? fg : t(0.45),
                      background: on ? bg : "transparent",
                      boxShadow: on ? `inset 0 0 0 1px ${fg}55` : "none",
                      transition: `background 200ms ${spring}, color 200ms ${spring}, box-shadow 200ms ${spring}`,
                    }}
                    hover={on ? {} : { background: w(0.06), color: t(0.75) }}
                  >
                    <Icon size={13} stroke="currentColor" />
                    {label}
                  </Hov>
                );
              })}
            </div>
          </Group>

          <Group
            label="LANGUAGES"
            aside={
              <span
                style={{
                  fontSize: 11,
                  color: langs.length ? t(0.36) : color.warn,
                }}
              >
                {langs.length
                  ? `${langs.length} picked`
                  : "none picked — templates will not know what to write in"}
              </span>
            }
          >
            {/*
              Pick from a list rather than type a string. It was a free-text box
              holding "Bangla · English", which is a way to typo your way to a
              fourth spelling of Bangla and a separator nothing agrees on.
            */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
              {offered.map((lang) => {
                const on = langs.includes(lang);
                return (
                  <Hov
                    as="span"
                    key={lang}
                    onClick={() => toggleLang(lang)}
                    aria-pressed={on}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      height: 32,
                      padding: on ? "0 12px 0 9px" : "0 12px",
                      borderRadius: 10,
                      fontSize: 12.5,
                      fontWeight: on ? 600 : 500,
                      cursor: "pointer",
                      color: on ? color.accentBright : t(0.55),
                      background: on ? "rgba(0,87,252,0.18)" : "rgba(0,0,0,0.28)",
                      border: `1px solid ${on ? "rgba(0,87,252,0.5)" : w(0.08)}`,
                      transition: `all 180ms ${spring}`,
                    }}
                    hover={
                      on
                        ? { background: "rgba(0,87,252,0.26)" }
                        : { background: w(0.08), color: t(0.8) }
                    }
                  >
                    {on ? <CheckIcon size={12} stroke="currentColor" /> : null}
                    {lang}
                  </Hov>
                );
              })}

              {/* Anything not on the list. The picker is a starting set, not a
                  closed one — plenty of brands publish in something else. */}
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  height: 32,
                  padding: "0 4px 0 10px",
                  borderRadius: 10,
                  background: "rgba(0,0,0,0.28)",
                  border: `1px dashed ${w(0.2)}`,
                }}
              >
                <GlobeIcon size={12} stroke={t(0.5)} />
                <input
                  value={adding}
                  onChange={(e) => setAdding(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    addLang();
                  }}
                  placeholder="Add…"
                  aria-label="Add a language"
                  style={{
                    width: 66,
                    border: "none",
                    outline: "none",
                    background: "transparent",
                    color: "#f0f0f4",
                    fontSize: 12.5,
                  }}
                />
                {/* The affordance is the plus, so it stays legible before you
                    have typed anything rather than fading to a hint of itself. */}
                <Hov
                  as="span"
                  aria-label="Add language"
                  onClick={addLang}
                  style={{
                    width: 24,
                    height: 24,
                    display: "grid",
                    placeItems: "center",
                    borderRadius: 7,
                    cursor: "pointer",
                    opacity: adding.trim() ? 1 : 0.6,
                    background: adding.trim() ? "rgba(0,87,252,0.22)" : "transparent",
                  }}
                  hover={{ background: "rgba(0,87,252,0.32)" }}
                >
                  <PlusIcon size={11} stroke={color.accentText} />
                </Hov>
              </span>
            </div>
          </Group>

          <Group label="INTENT">
            <Row label="Goal" hint="one line, why this workspace exists">
              {/* The icon sits in the field rather than beside the label, so the
                  goal reads as one object rather than a labelled text box. */}
              <span style={{ position: "relative", display: "block" }}>
                <TargetIcon
                  size={14}
                  stroke={color.accentText}
                  style={{
                    position: "absolute",
                    left: 12,
                    top: "50%",
                    transform: "translateY(-50%)",
                    pointerEvents: "none",
                  }}
                />
                <TextInput
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  placeholder="Grow to 50k followers with useful websites"
                  style={{ paddingLeft: 34 }}
                />
              </span>
            </Row>
          </Group>

          <Group
            label="BRAND VOICE"
            aside={
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontFamily: font.mono,
                  fontSize: 10,
                  color: voiceChars ? t(0.4) : color.warn,
                }}
              >
                <VoiceIcon size={11} stroke="currentColor" />
                {voiceChars ? `${voiceChars.toLocaleString()} chars` : "not set"}
              </span>
            }
          >
            <TextArea
              rows={11}
              value={voice}
              onChange={(e) => setVoice(e.target.value)}
              spellCheck={false}
              placeholder={`How this brand writes. Paste it if you already have it.

Spoken, second person, no jargon. Always close on what the viewer gets.`}
              style={{
                // Sans, not the monospace default: this is prose you read, and
                // 12px mono at 60 characters wide is where a voice guide turns
                // into a config file.
                fontFamily: font.sans,
                fontSize: 12.5,
                lineHeight: 1.7,
                minHeight: 150,
              }}
              mono={false}
            />
            <p
              style={{
                margin: "9px 0 0",
                fontSize: 11.5,
                lineHeight: 1.55,
                color: t(0.4),
              }}
            >
              Prepended to every template in this workspace, for every section — so a
              brief never has to describe the tone again.
            </p>
          </Group>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "13px 22px",
            borderTop: `1px solid ${w(0.08)}`,
            background: `linear-gradient(0deg, ${w(0.04)}, transparent)`,
          }}
        >
          {/* Destructive, so it sits on the far side of the footer from Save —
              far enough that a hurried click cannot reach the wrong one. It is
              absent while creating, and absent on the last workspace. */}
          {onDelete ? (
            <Hov
              onClick={onDelete}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                height: 35,
                padding: "0 13px",
                borderRadius: 11,
                fontSize: 12.5,
                fontWeight: 600,
                cursor: "pointer",
                color: color.bad,
                background: "rgba(209,101,107,0.1)",
                border: "1px solid rgba(209,101,107,0.24)",
              }}
              hover={{ background: "rgba(209,101,107,0.2)" }}
            >
              <TrashIcon size={12} stroke="currentColor" />
              Delete
            </Hov>
          ) : null}

          {!voiceChars ? (
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                fontSize: 11.5,
                color: color.warn,
              }}
            >
              <VoiceIcon size={12} stroke="currentColor" />
              No voice yet — templates will run on their own rules only.
            </span>
          ) : null}

          <Hov
            onClick={onClose}
            style={{
              marginLeft: "auto",
              height: 35,
              padding: "0 16px",
              display: "grid",
              placeItems: "center",
              borderRadius: 11,
              fontSize: 12.5,
              fontWeight: 600,
              ...ghost,
            }}
            hover={ghostHover}
          >
            Cancel
          </Hov>
          <Hov
            onClick={save}
            aria-disabled={making && !named}
            style={{
              height: 35,
              padding: "0 18px",
              display: "grid",
              placeItems: "center",
              borderRadius: 11,
              fontSize: 12.5,
              fontWeight: 600,
              ...primary,
              ...(making && !named
                ? { opacity: 0.45, cursor: "not-allowed" }
                : null),
            }}
            hover={primaryHover}
            active={primaryActive}
          >
            {making ? "Create workspace" : "Save workspace"}
          </Hov>
        </div>
      </div>
    </Hov>
  );
}

/** What each state actually means, said once beside the control. */
const STATUS_HINT: Record<ProjectStatus, string> = {
  Active: "publishing now",
  Planning: "set up, not publishing yet",
  Paused: "on hold, coming back",
  Archived: "finished, kept for reference",
};
