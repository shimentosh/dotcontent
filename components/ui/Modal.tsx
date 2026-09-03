"use client";

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { font, layer, spring, t, w } from "@/lib/theme";
import { Hov } from "@/components/ui/Hov";
import { CloseIcon } from "@/components/ui/Icons";

export type ModalTone = "accent" | "danger" | "neutral";

/** The tile behind the header icon, per tone. */
const TILE: Record<ModalTone, { bg: string; border: string; fg: string }> = {
  accent: {
    bg: "rgba(0,87,252,0.16)",
    border: "rgba(0,87,252,0.32)",
    fg: "#6a9dff",
  },
  danger: {
    bg: "rgba(209,101,107,0.14)",
    border: "rgba(209,101,107,0.3)",
    fg: "#d1656b",
  },
  neutral: { bg: w(0.06), border: w(0.1), fg: t(0.65) },
};

/**
 * A centred dialog on a blurred backdrop.
 *
 * Portalled to <body> because a page that animates in — every routed view runs
 * `rise()` — is a containing block for its fixed children while that animation
 * plays, which would otherwise pin the modal inside the page rather than over
 * the window.
 *
 * Closes on Escape and on a click outside the panel; the caller keeps the open
 * state so the trigger can stay in charge of it.
 */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  icon,
  tone = "accent",
  width = 560,
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  /** A glyph for the header tile — says what kind of job this dialog is. */
  icon?: ReactNode;
  tone?: ModalTone;
  width?: number;
  footer?: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, open]);

  if (!open || typeof document === "undefined") return null;

  const tile = TILE[tone];

  return createPortal(
    <Hov
      interactive={false}
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: layer.modal,
        background: "rgba(4,4,8,0.6)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        display: "grid",
        placeItems: "center",
        padding: 30,
        animation: `os-fade 160ms ${spring} both`,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative",
          width: "100%",
          maxWidth: width,
          maxHeight: "82vh",
          display: "flex",
          flexDirection: "column",
          borderRadius: 20,
          background:
            "linear-gradient(180deg, rgba(40,40,48,0.86), rgba(20,20,26,0.9))",
          backdropFilter: "blur(50px) saturate(170%)",
          WebkitBackdropFilter: "blur(50px) saturate(170%)",
          border: `1px solid ${w(0.12)}`,
          borderTopColor: w(0.22),
          boxShadow: `0 40px 90px rgba(0,0,0,0.62), 0 2px 6px rgba(0,0,0,0.4), inset 0 1px 0 ${w(0.14)}`,
          overflow: "hidden",
          animation: `os-pop 220ms ${spring} both`,
        }}
      >
        {/* The light the panel is lit by: a wash behind the header, tinted by tone. */}
        <span
          aria-hidden
          style={{
            position: "absolute",
            inset: "0 0 auto 0",
            height: 120,
            pointerEvents: "none",
            background: `radial-gradient(120% 100% at 12% 0%, ${tile.bg}, transparent 70%)`,
          }}
        />

        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "16px 18px 14px",
            borderBottom: `1px solid ${w(0.08)}`,
          }}
        >
          {icon ? (
            <span
              style={{
                width: 34,
                height: 34,
                flex: "none",
                display: "grid",
                placeItems: "center",
                borderRadius: 11,
                background: tile.bg,
                border: `1px solid ${tile.border}`,
                color: tile.fg,
              }}
            >
              {icon}
            </span>
          ) : null}

          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontFamily: font.tight,
                fontSize: 16.5,
                fontWeight: 700,
                letterSpacing: "-0.02em",
              }}
            >
              {title}
            </div>
            {subtitle ? (
              <div
                style={{
                  marginTop: 2,
                  fontSize: 12.5,
                  lineHeight: 1.45,
                  color: t(0.45),
                }}
              >
                {subtitle}
              </div>
            ) : null}
          </div>

          <Hov
            onClick={onClose}
            aria-label="Close"
            title="Close"
            style={{
              marginLeft: "auto",
              alignSelf: "flex-start",
              width: 28,
              height: 28,
              flex: "none",
              display: "grid",
              placeItems: "center",
              borderRadius: 8,
              color: t(0.45),
              cursor: "pointer",
              transition: `background 180ms ${spring}, color 180ms ${spring}`,
            }}
            hover={{ background: w(0.1), color: "#f0f0f4" }}
          >
            <CloseIcon size={12} stroke="currentColor" />
          </Hov>
        </div>

        <div
          style={{
            position: "relative",
            padding: "18px 18px 20px",
            overflowY: "auto",
          }}
        >
          {children}
        </div>

        {footer ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "13px 18px",
              borderTop: `1px solid ${w(0.08)}`,
              background: "rgba(0,0,0,0.22)",
            }}
          >
            {footer}
          </div>
        ) : null}
      </div>
    </Hov>,
    document.body,
  );
}
