"use client";

import { API_URL } from "@/lib/api-base";
import { useStore } from "@/lib/store";
import { font } from "@/lib/theme";

/**
 * "The API is not running" — said plainly, at the top, in red.
 *
 * Without this the console rendered the design's sample workspaces and
 * "0 templates" whenever the API process was down, which reads as "my work
 * is gone". It is not gone; nothing is answering on the port. The store
 * asks every few seconds whether it is back and reloads when it is, so this
 * disappears on its own once `./start.sh` is up.
 */
export function ApiDownBanner() {
  const { apiDown } = useStore();
  if (!apiDown) return null;

  return (
    <div
      role="alert"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 16px",
        background: "rgba(209,101,107,0.16)",
        borderBottom: "1px solid rgba(209,101,107,0.35)",
        color: "#f2b8bc",
        fontSize: 13,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          flex: "none",
          borderRadius: "50%",
          background: "#d1656b",
          animation: "os-pulse 1.1s ease-in-out infinite",
        }}
      />
      <span style={{ flex: 1, minWidth: 0 }}>
        <strong style={{ color: "#ffd9db" }}>The API is not running</strong> —
        nothing is answering at{" "}
        <code style={{ fontFamily: font.mono, fontSize: 12 }}>{API_URL}</code>.
        Your templates and content are in the database and will be back the
        moment it is. Start it with{" "}
        <code style={{ fontFamily: font.mono, fontSize: 12 }}>./start.sh</code>{" "}
        (or <code style={{ fontFamily: font.mono, fontSize: 12 }}>npm run api:dev</code>);
        this page reloads on its own when it answers.
      </span>
    </div>
  );
}
