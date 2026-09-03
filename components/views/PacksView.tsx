"use client";

import { useRef, useState } from "react";

import { PACK_STATUS, type Pack } from "@/lib/packs";
import {
  TransferError,
  download,
  fileNameFor,
  fromFile,
  toFile,
} from "@/lib/packs-transfer";
import { useStore } from "@/lib/store";
import {
  font,
  ghost,
  ghostHover,
  panel,
  primary,
  rise,
  spring,
  t,
  w,
} from "@/lib/theme";
import { Hov } from "@/components/ui/Hov";
import { IconButton } from "@/components/ui";
import { CaretRight, GridGlyph, ListGlyph } from "@/components/ui/DocIcons";
import { PencilIcon, TrashIcon } from "@/components/ui/Icons";
import { DownloadGlyph } from "@/components/ui/DocIcons";

type Layout = "list" | "grid";

/** PACK · STATUS · SECTIONS · USED · actions — the Content list's column set. */
const GRID = "1fr 118px 104px 84px 96px";

export function PacksView() {
  const { go, packs, deletePack, askConfirm, newPack, editPack, importPack } =
    useStore();
  const [layout, setLayout] = useState<Layout>("list");

  /*
   * Import and export, as files.
   *
   * A template is a brief someone spent hours tuning, and until now it could
   * only be copied by opening two builders side by side and retyping twelve
   * prompts. The file carries the whole thing — rules, sections, inputs — so a
   * template can be sent to somebody the way any other document is.
   */
  const fileBox = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState("");

  const exportPack = (pack: Pack) =>
    download(fileNameFor(pack.name), toFile(pack));

  const importFile = async (file: File) => {
    setImporting("");
    try {
      const slug = await importPack(fromFile(JSON.parse(await file.text())));
      // Straight into the builder on the new template: an import that lands
      // silently in a list of twelve is one you then have to go looking for.
      editPack(slug);
    } catch (e) {
      setImporting(
        e instanceof TransferError
          ? e.message
          : e instanceof SyntaxError
            ? "That file is not readable JSON."
            : e instanceof Error
              ? e.message
              : "That file could not be imported.",
      );
    }
  };

  const remove = (pack: Pack) =>
    askConfirm({
      title: `Delete “${pack.name}”?`,
      body: `${pack.sections} sections and everything written into them go with it. Content this template already produced stays where it is.`,
      confirmLabel: "Delete template",
      onConfirm: () => deletePack(pack.id),
    });

  const rowActions = (pack: Pack) => (
    <span
      style={{
        justifySelf: "end",
        display: "flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      <IconButton
        label={`Export ${pack.name}`}
        onClick={() => exportPack(pack)}
        stopPropagation
      >
        <DownloadGlyph size={12} stroke="currentColor" />
      </IconButton>
      <IconButton
        label={`Edit ${pack.name}`}
        onClick={() => editPack(pack.id)}
        stopPropagation
      >
        <PencilIcon size={12} stroke="currentColor" />
      </IconButton>
      <IconButton
        label={`Delete ${pack.name}`}
        variant="danger"
        onClick={() => remove(pack)}
        stopPropagation
      >
        <TrashIcon size={12} stroke="currentColor" />
      </IconButton>
      <CaretRight size={12} stroke={t(0.28)} />
    </span>
  );

  return (
    <div
      style={{
        ...rise(240),
        maxWidth: 1180,
        margin: "0 auto",
        padding: "34px 30px 60px",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-end", marginBottom: 20 }}>
        <div>
          <h1
            style={{
              fontFamily: font.tight,
              fontSize: 28,
              fontWeight: 700,
              letterSpacing: "-0.025em",
              margin: "0 0 5px",
            }}
          >
            Templates
          </h1>
          <p style={{ margin: 0, fontSize: 13.5, color: t(0.48) }}>
            A template is a production brief. Point it at a topic and it makes
            everything.
          </p>
        </div>
        <Hov
          onClick={() => fileBox.current?.click()}
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: 7,
            height: 32,
            padding: "0 13px",
            borderRadius: 9,
            fontSize: 12.5,
            fontWeight: 600,
            ...ghost,
          }}
          hover={ghostHover}
        >
          Import template
        </Hov>
        <input
          ref={fileBox}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            // Cleared so the same file can be chosen twice — the second time is
            // usually after fixing whatever the first attempt complained about.
            e.target.value = "";
            if (file) void importFile(file);
          }}
        />
        <Hov
          onClick={newPack}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            height: 32,
            padding: "0 13px",
            borderRadius: 9,
            fontSize: 12.5,
            fontWeight: 600,
            ...primary,
          }}
        >
          Create Template
        </Hov>
      </div>

      {importing ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            marginBottom: 16,
            padding: "11px 13px",
            borderRadius: 12,
            background: "rgba(209,101,107,0.12)",
            border: "1px solid rgba(209,101,107,0.25)",
            fontSize: 12.5,
            color: "#e0a3a7",
          }}
        >
          <span style={{ flex: 1, textWrap: "pretty" }}>{importing}</span>
          <Hov
            as="span"
            onClick={() => setImporting("")}
            style={{ cursor: "pointer", fontWeight: 600 }}
            hover={{ color: "#fff" }}
          >
            Dismiss
          </Hov>
        </div>
      ) : null}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 20,
        }}
      >
        <span style={{ fontSize: 12, color: t(0.4) }}>
          {packs.length} {packs.length === 1 ? "template" : "templates"}
        </span>

        <div
          style={{
            marginLeft: "auto",
            display: "inline-flex",
            gap: 3,
            padding: 3,
            borderRadius: 10,
            background: "rgba(0,0,0,0.3)",
            border: `1px solid ${w(0.07)}`,
          }}
        >
          {(
            [
              ["list", ListGlyph, "List view"],
              ["grid", GridGlyph, "Card view"],
            ] as const
          ).map(([key, Glyph, label]) => {
            const on = layout === key;
            return (
              <Hov
                key={key}
                onClick={() => setLayout(key)}
                aria-pressed={on}
                aria-label={label}
                title={label}
                style={{
                  width: 28,
                  height: 24,
                  display: "grid",
                  placeItems: "center",
                  borderRadius: 7,
                  cursor: "pointer",
                  background: on ? w(0.12) : "transparent",
                  color: on ? "#f0f0f4" : t(0.45),
                  transition: `background 200ms ${spring}, color 200ms ${spring}`,
                }}
                hover={on ? undefined : { color: t(0.8) }}
              >
                <Glyph size={13} stroke="currentColor" />
              </Hov>
            );
          })}
        </div>
      </div>

      {layout === "list" ? (
        <div style={{ ...panel(18), overflow: "hidden" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: GRID,
              gap: 14,
              padding: "10px 18px",
              borderBottom: `1px solid ${w(0.07)}`,
              background: w(0.02),
              fontFamily: font.mono,
              fontSize: 9.5,
              letterSpacing: "0.13em",
              color: t(0.38),
            }}
          >
            <span>TEMPLATE</span>
            <span>STATUS</span>
            <span>SECTIONS</span>
            <span>USED</span>
            <span />
          </div>

          {packs.map((p, i) => (
            <Hov
              key={p.id}
              onClick={() => go(`/pack/${p.id}`)}
              href={`/pack/${p.id}`}
              style={{
                display: "grid",
                gridTemplateColumns: GRID,
                gap: 14,
                alignItems: "center",
                padding: "12px 18px",
                borderTop: i === 0 ? "none" : `1px solid ${w(0.04)}`,
                cursor: "pointer",
                color: "inherit",
                textDecoration: "none",
                transition: "background 140ms",
              }}
              hover={{ background: w(0.055) }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  minWidth: 0,
                }}
              >
                <span
                  style={{
                    width: 34,
                    height: 34,
                    flex: "none",
                    borderRadius: 11,
                    display: "grid",
                    placeItems: "center",
                    fontFamily: font.mono,
                    fontSize: 10.5,
                    background: PACK_STATUS[p.status].bg,
                    color: PACK_STATUS[p.status].fg,
                    border: `1px solid ${w(0.07)}`,
                  }}
                >
                  {p.n}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13.5,
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {p.name}
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
                    {p.desc}
                  </div>
                </div>
              </div>

              <span
                style={{
                  justifySelf: "start",
                  fontFamily: font.mono,
                  fontSize: 9.5,
                  letterSpacing: "0.1em",
                  padding: "3px 8px",
                  borderRadius: 20,
                  background: PACK_STATUS[p.status].bg,
                  color: PACK_STATUS[p.status].fg,
                }}
              >
                {p.status}
              </span>

              <span style={{ fontSize: 12, color: t(0.5) }}>
                <span style={{ fontFamily: font.mono, color: t(0.72) }}>
                  {p.sections}
                </span>{" "}
                sections
              </span>

              <span
                style={{
                  fontFamily: font.mono,
                  fontSize: 10.5,
                  color: t(0.38),
                }}
              >
                {p.used}
              </span>

              {rowActions(p)}
            </Hov>
          ))}
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3,1fr)",
            gap: 12,
          }}
        >
          {packs.map((p) => (
            <Hov
              key={p.id}
              onClick={() => go(`/pack/${p.id}`)}
              href={`/pack/${p.id}`}
              style={{
                display: "flex",
                flexDirection: "column",
                padding: 17,
                borderRadius: 17,
                cursor: "pointer",
                color: "inherit",
                textDecoration: "none",
                background: w(0.045),
                border: `1px solid ${w(0.08)}`,
                backdropFilter: "blur(30px) saturate(155%)",
                boxShadow: `0 10px 28px rgba(0,0,0,0.28), inset 0 1px 0 ${w(0.06)}`,
                transition: "all 180ms",
              }}
              hover={{
                background: w(0.08),
                transform: "translateY(-2px)",
                borderColor: w(0.18),
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  marginBottom: 12,
                }}
              >
                <span
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 8,
                    display: "grid",
                    placeItems: "center",
                    fontFamily: font.mono,
                    fontSize: 10,
                    background: PACK_STATUS[p.status].bg,
                    color: PACK_STATUS[p.status].fg,
                  }}
                >
                  {p.n}
                </span>
                <span
                  style={{
                    marginLeft: "auto",
                    fontSize: 10.5,
                    fontFamily: font.mono,
                    letterSpacing: "0.1em",
                    padding: "2px 7px",
                    borderRadius: 20,
                    background: PACK_STATUS[p.status].bg,
                    color: PACK_STATUS[p.status].fg,
                  }}
                >
                  {p.status}
                </span>
              </div>

              <div
                style={{
                  fontSize: 15,
                  fontWeight: 600,
                  letterSpacing: "-0.01em",
                  marginBottom: 5,
                }}
              >
                {p.name}
              </div>
              <div
                style={{
                  fontSize: 12.5,
                  color: t(0.48),
                  lineHeight: 1.5,
                  marginBottom: 14,
                  minHeight: 38,
                  textWrap: "pretty",
                }}
              >
                {p.desc}
              </div>

              <div
                style={{
                  marginTop: "auto",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  paddingTop: 12,
                  borderTop: `1px solid ${w(0.07)}`,
                  fontSize: 11.5,
                  color: t(0.45),
                }}
              >
                <span style={{ fontFamily: font.mono, color: t(0.7) }}>
                  {p.sections}
                </span>
                <span>sections</span>
                <span style={{ marginLeft: "auto" }}>{p.used}</span>
                <IconButton
                  label={`Export ${p.name}`}
                  onClick={() => exportPack(p)}
                  stopPropagation
                >
                  <DownloadGlyph size={12} stroke="currentColor" />
                </IconButton>
                <IconButton
                  label={`Edit ${p.name}`}
                  onClick={() => editPack(p.id)}
                  stopPropagation
                >
                  <PencilIcon size={12} stroke="currentColor" />
                </IconButton>
                <IconButton
                  label={`Delete ${p.name}`}
                  variant="danger"
                  onClick={() => remove(p)}
                  stopPropagation
                >
                  <TrashIcon size={12} stroke="currentColor" />
                </IconButton>
              </div>
            </Hov>
          ))}
        </div>
      )}

    </div>
  );
}
