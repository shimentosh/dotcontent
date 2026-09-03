"use client";

import { PALETTE_GROUPS, type PaletteAction } from "@/lib/data";
import { useStore } from "@/lib/store";
import { font, layer, t, w } from "@/lib/theme";
import { Hov } from "@/components/ui/Hov";
import { SearchIcon } from "@/components/ui/Icons";

export function CommandPalette() {
  const { paletteOpen, closePalette, query, setQuery, go, openRunSetup } =
    useStore();

  if (!paletteOpen) return null;

  const needle = query.trim().toLowerCase();
  const groups = PALETTE_GROUPS.map((g) => ({
    ...g,
    items: needle
      ? g.items.filter((i) => i.label.toLowerCase().includes(needle))
      : g.items,
  })).filter((g) => g.items.length > 0);

  const run = (action: PaletteAction) => {
    closePalette();
    if (action.kind === "runSetup") openRunSetup();
    else go(action.href);
  };

  return (
    <Hov
      interactive={false}
      onClick={closePalette}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: layer.modal,
        background: "rgba(4,4,8,0.5)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        padding: "14vh 30px 30px",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 580,
          borderRadius: 20,
          background: "rgba(26,26,32,0.76)",
          backdropFilter: "blur(50px) saturate(155%)",
          WebkitBackdropFilter: "blur(50px) saturate(155%)",
          border: `1px solid ${w(0.14)}`,
          boxShadow: `0 40px 90px rgba(0,0,0,0.62), inset 0 1px 0 ${w(0.13)}`,
          overflow: "hidden",
          animation: "os-pop 160ms ease-out",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 11,
            padding: "15px 18px",
            borderBottom: `1px solid ${w(0.09)}`,
          }}
        >
          <SearchIcon size={16} stroke={t(0.4)} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command or search…"
            aria-label="Type a command or search"
            autoFocus
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "#f0f0f4",
              fontSize: 14.5,
            }}
          />
          <span
            style={{
              fontFamily: font.mono,
              fontSize: 10,
              color: t(0.3),
              border: `1px solid ${w(0.12)}`,
              borderRadius: 5,
              padding: "1px 5px",
            }}
          >
            ESC
          </span>
        </div>

        <div style={{ maxHeight: "56vh", overflowY: "auto", padding: 8 }}>
          {groups.map((g) => (
            <div key={g.name} style={{ marginBottom: 6 }}>
              <div
                style={{
                  fontFamily: font.mono,
                  fontSize: 9.5,
                  letterSpacing: "0.14em",
                  color: t(0.34),
                  padding: "7px 10px 5px",
                }}
              >
                {g.name}
              </div>
              {g.items.map((c) => (
                <Hov
                  key={c.label}
                  onClick={() => run(c.action)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 11,
                    padding: "9px 10px",
                    borderRadius: 10,
                    cursor: "pointer",
                  }}
                  hover={{ background: w(0.09) }}
                >
                  <span
                    style={{
                      width: 22,
                      height: 22,
                      flex: "0 0 22px",
                      borderRadius: 7,
                      display: "grid",
                      placeItems: "center",
                      fontSize: 11,
                      background: c.bg,
                      color: c.fg,
                    }}
                  >
                    {c.glyph}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>
                    {c.label}
                  </span>
                  <span
                    style={{
                      marginLeft: "auto",
                      fontFamily: font.mono,
                      fontSize: 10,
                      color: t(0.3),
                    }}
                  >
                    {c.hint}
                  </span>
                </Hov>
              ))}
            </div>
          ))}

          {groups.length === 0 ? (
            <div
              style={{
                padding: "18px 10px 22px",
                fontSize: 13,
                color: t(0.4),
              }}
            >
              No commands match “{query}”.
            </div>
          ) : null}
        </div>
      </div>
    </Hov>
  );
}
