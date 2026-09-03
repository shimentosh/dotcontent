"use client";

import { useEffect } from "react";

import { useStore } from "@/lib/store";
import { color, font, ghost, ghostHover, layer, t, w } from "@/lib/theme";
import { Hov } from "@/components/ui/Hov";
import { AlertIcon } from "@/components/ui/Icons";

/**
 * The yes/no in front of anything irreversible.
 *
 * There was none. Every destructive control in the app was either inert or
 * would have fired on the first click — "Delete account", sitting under the
 * words "this cannot be undone", was a button with no handler at all.
 *
 * One dialog, driven from the store, rather than a `confirm()`: the native one
 * blocks the thread, cannot be styled, and on a page built out of glass looks
 * like the browser has crashed. The confirming button is always named for the
 * act it performs — never "OK", which is the word you click without reading.
 */
export function ConfirmDialog() {
  const { confirm, closeConfirm } = useStore();

  useEffect(() => {
    if (!confirm) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeConfirm();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirm, closeConfirm]);

  if (!confirm) return null;

  return (
    <Hov
      interactive={false}
      onClick={closeConfirm}
      style={{
        position: "fixed",
        inset: 0,
        // Above the workspace sheet, which is what usually opens it.
        zIndex: layer.confirm,
        background: "rgba(4,4,8,0.6)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        display: "grid",
        placeItems: "center",
        padding: 30,
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={confirm.title}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 400,
          borderRadius: 20,
          background: "rgba(24,24,30,0.82)",
          backdropFilter: "blur(60px) saturate(155%)",
          WebkitBackdropFilter: "blur(60px) saturate(155%)",
          border: `1px solid ${w(0.13)}`,
          boxShadow: `0 40px 90px rgba(0,0,0,0.65), inset 0 1px 0 ${w(0.14)}`,
          overflow: "hidden",
          animation: "os-pop 160ms ease-out",
        }}
      >
        <div style={{ display: "flex", gap: 13, padding: "20px 20px 16px" }}>
          <span
            style={{
              width: 32,
              height: 32,
              flex: "none",
              borderRadius: 11,
              display: "grid",
              placeItems: "center",
              background: "rgba(209,101,107,0.14)",
            }}
          >
            <AlertIcon size={15} stroke={color.bad} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontFamily: font.tight,
                fontSize: 15.5,
                fontWeight: 700,
                letterSpacing: "-0.015em",
              }}
            >
              {confirm.title}
            </div>
            <p
              style={{
                margin: "5px 0 0",
                fontSize: 12.5,
                lineHeight: 1.6,
                color: t(0.55),
              }}
            >
              {confirm.body}
            </p>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            padding: "12px 20px",
            borderTop: `1px solid ${w(0.08)}`,
          }}
        >
          {/* Cancel first and quiet, the destructive one last and outlined
              rather than filled — a filled red button is the brightest thing on
              a dark dialog, which is the wrong thing to make easiest to hit. */}
          <Hov
            onClick={closeConfirm}
            style={{
              height: 33,
              padding: "0 15px",
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
          {confirm.alternative ? (
            <Hov
              onClick={() => {
                confirm.alternative?.onChoose();
                closeConfirm();
              }}
              style={{
                height: 33,
                padding: "0 15px",
                display: "grid",
                placeItems: "center",
                borderRadius: 10,
                fontSize: 12.5,
                fontWeight: 600,
                cursor: "pointer",
                color: "#f0f0f4",
                background: w(0.09),
                border: `1px solid ${w(0.13)}`,
              }}
              hover={{ background: w(0.15) }}
            >
              {confirm.alternative.label}
            </Hov>
          ) : null}
          {/* The one that does the thing, named for the act it performs. The
              name changes with what is about to happen — "Delete topics too"
              when there are topics — so it carries a stable handle as well. */}
          <Hov
            data-confirm="go"
            onClick={() => {
              confirm.onConfirm();
              closeConfirm();
            }}
            style={{
              height: 33,
              padding: "0 15px",
              display: "grid",
              placeItems: "center",
              borderRadius: 10,
              fontSize: 12.5,
              fontWeight: 600,
              cursor: "pointer",
              color: color.bad,
              background: "rgba(209,101,107,0.12)",
              border: "1px solid rgba(209,101,107,0.3)",
            }}
            hover={{ background: "rgba(209,101,107,0.24)" }}
          >
            {confirm.confirmLabel}
          </Hov>
        </div>
      </div>
    </Hov>
  );
}
