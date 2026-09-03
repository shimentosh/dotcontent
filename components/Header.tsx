"use client";

import { apiFetch } from "@/lib/api-base";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";

import { useStore } from "@/lib/store";
import { ago } from "@/lib/packs-client";
import {
  font,
  primary,
  primaryActive,
  primaryHover,
  spring,
  t,
  w,
} from "@/lib/theme";
import { Hov } from "@/components/ui/Hov";
import { Popover } from "@/components/ui/Popover";
import { BellIcon, PlusIcon, SearchIcon } from "@/components/ui/Icons";

const menuRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 9,
  padding: "8px 9px",
  borderRadius: 10,
  cursor: "pointer",
  fontSize: 12.5,
};

export function Header() {
  const { createOpen, toggleCreate, openPalette, openRunSetup, go, runs } =
    useStore();

  /*
   * What has actually happened, newest first.
   *
   * Four fixed lines used to live here — "Bangla Script v4 approved", a
   * voiceover regenerated — describing work nobody did, on a bell that
   * carried a live blue dot. A section finishing is the only event this app
   * has, so it is the only thing the bell can honestly report.
   */
  const activity = runs
    .flatMap((r) =>
      r.sections
        .filter((s) => s.state === "done" || s.state === "failed")
        .map((s) => ({
          dot: s.state === "done" ? "#4bb07a" : "#c9553f",
          text: `${s.title} ${s.state === "done" ? "written" : "failed"} for ${r.title}`,
          at: s.updatedAt,
        })),
    )
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 8)
    .map((v) => ({ ...v, time: ago(v.at) }));

  const createRef = useRef<HTMLDivElement>(null);

  /*
   * The bell had a live blue dot on it and no handler — the one control in the
   * app that actively claimed something was waiting for you and then refused to
   * say what. Local state rather than the store: nothing outside the header
   * opens it, and a menu that only its own button controls does not need to be
   * global.
   */
  const bellRef = useRef<HTMLDivElement>(null);
  const [bellOpen, setBellOpen] = useState(false);

  useEffect(() => {
    if (!bellOpen) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      const inside =
        Boolean(target.closest('[data-menu="bell"]')) ||
        Boolean(bellRef.current?.contains(target));
      if (!inside) setBellOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [bellOpen]);

  // The design only closed this on Escape or on navigating; clicking away
  // should close it too. The menu itself is portalled out of the header, so
  // it is matched by its data-menu marker rather than by containment in the
  // trigger.
  useEffect(() => {
    if (!createOpen) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      const inside =
        Boolean(target.closest('[data-menu="create"]')) ||
        Boolean(createRef.current?.contains(target));
      if (!inside) toggleCreate();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [createOpen, toggleCreate]);

  return (
    <header
      style={{
        flex: "0 0 auto",
        // The backdrop filter below makes this header its own stacking
        // context, so it needs to sit above the scrolling content.
        position: "relative",
        zIndex: 30,
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "11px 20px",
        // Matches the sidebar material so the two read as one continuous pane
        // of glass wrapping the content.
        background: `linear-gradient(180deg, ${w(0.058)}, ${w(0.026)})`,
        backdropFilter: "blur(48px) saturate(165%)",
        WebkitBackdropFilter: "blur(48px) saturate(165%)",
        borderBottom: `1px solid ${w(0.06)}`,
        boxShadow: `inset 0 1px 0 ${w(0.05)}, 0 8px 26px -12px rgba(0,0,0,0.5)`,
      }}
    >
      <Hov
        onClick={openPalette}
        aria-label="Search topics, templates, content"
        style={{
          flex: 1,
          maxWidth: 440,
          display: "flex",
          alignItems: "center",
          gap: 9,
          height: 31,
          padding: "0 11px",
          borderRadius: 9,
          // A recessed well: darker than its surround, with the inner shadow
          // falling from the top edge so it reads as carved in rather than
          // sitting on top.
          background: "rgba(0,0,0,0.24)",
          border: `1px solid ${w(0.07)}`,
          boxShadow: `inset 0 1px 2px rgba(0,0,0,0.45), 0 1px 0 ${w(0.04)}`,
          cursor: "text",
          color: t(0.42),
          fontSize: 12.5,
          transition: `border-color 220ms ${spring}, background 220ms ${spring}`,
        }}
        hover={{ borderColor: w(0.18), background: "rgba(0,0,0,0.3)" }}
      >
        <SearchIcon size={13} />
        <span>Search topics, templates, content…</span>
        <span
          style={{
            marginLeft: "auto",
            fontFamily: font.mono,
            fontSize: 10,
            border: `1px solid ${w(0.12)}`,
            borderRadius: 5,
            padding: "1px 5px",
          }}
        >
          ⌘K
        </span>
      </Hov>

      <div
        style={{
          marginLeft: "auto",
          display: "flex",
          alignItems: "center",
          gap: 9,
        }}
      >
        <div style={{ position: "relative" }} ref={createRef}>
          <Hov
            onClick={toggleCreate}
            aria-expanded={createOpen}
            aria-haspopup="menu"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              height: 31,
              padding: "0 13px",
              borderRadius: 9,
              fontSize: 12.5,
              fontWeight: 600,
              // `primary` now carries its own layered shadow; overriding it
              // here would flatten the control back out.
              ...primary,
            }}
            hover={primaryHover}
            active={primaryActive}
          >
            <PlusIcon size={13} stroke="#fff" />
            <span>Create</span>
          </Hov>

          <Popover
            anchorRef={createRef}
            open={createOpen}
            align="right"
            width={214}
            data-menu="create"
          >
            {[
              { label: "Create Topic", href: "/content" },
              { label: "Create Content Template", href: "/builder" },
              { label: "Create Content", href: "/content" },
              // Not a create, but the one place every tool is listed — and
              // this menu is where a person looks for "what can this thing do".
              { label: "All tools", href: "/tools/manage" },
            ].map((item) => (
              <Hov
                key={item.label}
                onClick={() => go(item.href)}
                style={{ ...menuRow, borderRadius: 9 }}
                hover={{ background: w(0.09) }}
              >
                {item.label}
              </Hov>
            ))}
            <div
              style={{ height: 1, margin: "5px 7px", background: w(0.09) }}
            />
            <Hov
              onClick={() => openRunSetup()}
              style={{
                ...menuRow,
                borderRadius: 9,
                color: "#0057fc",
                fontWeight: 600,
              }}
              hover={{ background: "rgba(0,87,252,0.14)" }}
            >
              Generate from Template
            </Hov>
          </Popover>
        </div>

        <div ref={bellRef} style={{ position: "relative" }}>
          <Hov
            aria-label="Notifications"
            aria-expanded={bellOpen}
            aria-haspopup="menu"
            onClick={() => setBellOpen((v) => !v)}
            style={{
              width: 31,
              height: 31,
              display: "grid",
              placeItems: "center",
              borderRadius: 9,
              background: bellOpen ? w(0.12) : w(0.06),
              border: `1px solid ${w(0.09)}`,
              cursor: "pointer",
              position: "relative",
            }}
            hover={{ background: w(0.1) }}
          >
            <BellIcon size={15} stroke={t(0.75)} />
            <span
              style={{
                position: "absolute",
                top: 6,
                right: 7,
                width: 5,
                height: 5,
                borderRadius: "50%",
                background: "#0057fc",
                boxShadow: "0 0 8px #0057fc",
              }}
            />
          </Hov>

          <Popover
            anchorRef={bellRef}
            open={bellOpen}
            align="right"
            width={288}
            data-menu="bell"
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 10px 7px",
              }}
            >
              <span
                style={{
                  fontFamily: font.mono,
                  fontSize: 9.5,
                  letterSpacing: "0.14em",
                  color: t(0.42),
                }}
              >
                ACTIVITY
              </span>
              <span
                style={{
                  marginLeft: "auto",
                  fontFamily: font.mono,
                  fontSize: 10,
                  color: t(0.3),
                }}
              >
                {activity.length}
              </span>
            </div>

            {activity.map((a) => (
              <div
                key={a.text}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 9,
                  padding: "8px 10px",
                }}
              >
                <span
                  style={{
                    marginTop: 5,
                    width: 6,
                    height: 6,
                    flex: "0 0 6px",
                    borderRadius: "50%",
                    background: a.dot,
                  }}
                />
                <span
                  style={{
                    flex: 1,
                    fontSize: 12,
                    lineHeight: 1.45,
                    color: t(0.72),
                  }}
                >
                  {a.text}
                </span>
                <span
                  style={{
                    fontFamily: font.mono,
                    fontSize: 10,
                    color: t(0.32),
                  }}
                >
                  {a.time}
                </span>
              </div>
            ))}
          </Popover>
        </div>

        <Account />
      </div>
    </header>
  );
}

/**
 * Who is signed in, and the way out.
 *
 * The avatar was two fixed letters — it said SR whoever was using the console,
 * including nobody. It is now the account's own initials, and clicking it
 * offers the two things you ever want from an avatar: which account this is,
 * and sign out.
 */
function Account() {
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [me, setMe] = useState<{ email: string; name: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void apiFetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((body: { user?: { email: string; name: string } | null }) => {
        if (!cancelled) setMe(body.user ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      const inside =
        Boolean(target.closest('[data-menu="account"]')) ||
        Boolean(ref.current?.contains(target));
      if (!inside) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <Hov
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={me ? `Account — ${me.email}` : "Account"}
        title={me?.email ?? "Account"}
        style={{
          width: 31,
          height: 31,
          borderRadius: "50%",
          background: "linear-gradient(150deg,#93a7c0,#4a5a70)",
          display: "grid",
          placeItems: "center",
          fontSize: 11.5,
          fontWeight: 700,
          cursor: "pointer",
          boxShadow: `inset 0 1px 0 ${w(0.3)}`,
        }}
      >
        {initials(me?.name || me?.email || "")}
      </Hov>

      <Popover
        anchorRef={ref}
        open={open}
        align="right"
        width={210}
        data-menu="account"
      >
        <div style={{ padding: "8px 11px 9px" }}>
          <div style={{ fontSize: 12.5, fontWeight: 600 }}>
            {me?.name || "Signed in"}
          </div>
          <div
            style={{
              marginTop: 2,
              fontSize: 11,
              color: t(0.42),
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {me?.email ?? "…"}
          </div>
        </div>
        <Hov
          role="menuitem"
          href="/settings"
          onClick={() => setOpen(false)}
          style={menuItem}
          hover={{ background: w(0.09), color: "#f0f0f4" }}
        >
          Settings
        </Hov>
        <Hov
          role="menuitem"
          onClick={() => {
            setOpen(false);
            void apiFetch("/api/auth/logout", { method: "POST" }).then(() =>
              router.replace("/login"),
            );
          }}
          style={menuItem}
          hover={{ background: w(0.09), color: "#f0f0f4" }}
        >
          Sign out
        </Hov>
      </Popover>
    </div>
  );
}

const menuItem = {
  display: "block",
  padding: "8px 11px",
  borderRadius: 9,
  fontSize: 12.5,
  color: "rgba(240,240,244,0.75)",
  cursor: "pointer",
  textDecoration: "none",
} as const;

/** Two letters out of a name, or one out of an email. */
function initials(value: string) {
  if (!value) return "··";
  if (value.includes("@")) return value.slice(0, 2).toUpperCase();
  const parts = value.trim().split(/\s+/);
  return (
    parts.length > 1
      ? parts[0][0] + parts[parts.length - 1][0]
      : value.slice(0, 2)
  ).toUpperCase();
}
