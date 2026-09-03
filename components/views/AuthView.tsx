"use client";

import { apiFetch } from "@/lib/api-base";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { font, panel, primary, primaryHover, rise, t, w } from "@/lib/theme";
import { Hov } from "@/components/ui/Hov";
import { CheckGlyph, KeyGlyph } from "@/components/ui/DocIcons";

/**
 * Signing in, and claiming the console.
 *
 * One component for both because they are the same form with a different verb,
 * and keeping them together is what stops the two drifting into two different
 * ideas of what an error looks like.
 *
 * It renders outside the app shell: there is no sidebar, no workspace switcher
 * and no command palette here, because none of them mean anything until we
 * know whose console this is.
 */
export function AuthView({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";
  /*
   * An invite token, straight off the link.
   *
   * Signup is closed once the console has an owner, so for everyone after the
   * first person this is the whole credential: no token, no account. Held in
   * the URL rather than typed, because a 43-character random string is not
   * something to ask anyone to copy by hand.
   */
  const invite = params.get("invite") ?? "";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /** null while we do not yet know — the button must not flicker. */
  const [open, setOpen] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    void apiFetch("/api/auth/me", { cache: "no-store" })
      .then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }))
      .then(({ status, body }: { status: number; body: { user?: unknown; signupOpen?: boolean; error?: string } }) => {
        if (cancelled) return;
        /*
         * A 503 is the database, not the account.
         *
         * This is the first request the app makes and the first place a
         * missing container shows up. Saying it here, on the page everyone
         * lands on, is the difference between a fix and a mystery.
         */
        if (status === 503) {
          setError(body.error ?? "The database is not running.");
          setOpen(false);
          return;
        }
        // Already signed in: there is nothing to do on this page.
        if (body.user) router.replace(next);
        // An invite opens the door even when the console has an owner.
        else setOpen(Boolean(body.signupOpen) || Boolean(invite));
      })
      .catch(() => setOpen(false));
    return () => {
      cancelled = true;
    };
  }, [router, next, invite]);

  const signup = mode === "signup";

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await apiFetch(`/api/auth/${signup ? "signup" : "login"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          signup ? { email, password, name, invite } : { email, password },
        ),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        // The server's own words. A 503 here means the database is down, and
        // "that did not work" would send you looking at your password.
        setError(body.error || "That did not work");
        return;
      }
      // Replace, not push: the back button must not return to a sign-in form
      // that then bounces forward again.
      router.replace(next);
      router.refresh();
    } catch {
      setError("Could not reach the server. Is it running?");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
      }}
    >
      <div style={{ ...rise(240), width: "100%", maxWidth: 400 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 22 }}>
          <span
            style={{
              width: 30,
              height: 30,
              borderRadius: 9,
              display: "grid",
              placeItems: "center",
              background: "linear-gradient(150deg,#5b93ff,#0057fc)",
            }}
          >
            <KeyGlyph size={15} stroke="#fff" />
          </span>
          <span
            style={{
              fontFamily: font.tight,
              fontSize: 17,
              fontWeight: 700,
              letterSpacing: "-0.02em",
            }}
          >
            Content OS
          </span>
        </div>

        <h1
          style={{
            fontFamily: font.tight,
            fontSize: 27,
            fontWeight: 700,
            letterSpacing: "-0.03em",
            margin: "0 0 6px",
          }}
        >
          {signup
            ? invite
              ? "Join this console"
              : "Claim this console"
            : "Sign in"}
        </h1>
        <p
          style={{
            margin: "0 0 22px",
            fontSize: 13.5,
            color: t(0.5),
            textWrap: "pretty",
          }}
        >
          {signup
            ? invite
              ? "You were invited. Your account is your own — the workspace, its templates and everything written in it are shared with the team."
              : "The first account becomes the owner. Everything in the database belongs to it, so there is only one."
            : "Your workspaces, templates and everything they have written are behind this."}
        </p>

        <form onSubmit={submit} style={{ ...panel(18), padding: 18 }}>
          {signup ? (
            <Field label="Name" hint="What the header calls you.">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                placeholder="Optional"
                style={inputStyle}
              />
            </Field>
          ) : null}

          <Field label="Email">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              required
              autoFocus
              placeholder="you@example.com"
              style={inputStyle}
            />
          </Field>

          <Field
            label="Password"
            hint={signup ? "At least 10 characters. Length beats symbols." : ""}
          >
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={signup ? "new-password" : "current-password"}
              required
              placeholder="••••••••••"
              style={inputStyle}
            />
          </Field>

          {error ? (
            <div
              role="alert"
              style={{
                marginTop: 12,
                padding: "9px 11px",
                borderRadius: 10,
                fontSize: 12.5,
                background: "rgba(198,74,74,0.12)",
                border: "1px solid rgba(198,74,74,0.3)",
                color: "#e08585",
                textWrap: "pretty",
              }}
            >
              {error}
            </div>
          ) : null}

          <Hov
            as="button"
            type="submit"
            disabled={busy}
            style={{
              marginTop: 16,
              width: "100%",
              height: 38,
              display: "grid",
              placeItems: "center",
              borderRadius: 11,
              fontSize: 13.5,
              fontWeight: 600,
              cursor: busy ? "default" : "pointer",
              opacity: busy ? 0.6 : 1,
              ...primary,
            }}
            hover={busy ? undefined : primaryHover}
          >
            {busy
              ? signup
                ? "Creating…"
                : "Signing in…"
              : signup
                ? "Create the owner account"
                : "Sign in"}
          </Hov>
        </form>

        <div style={{ marginTop: 14, fontSize: 12.5, color: t(0.45) }}>
          {signup ? (
            <>
              Already set up?{" "}
              <Hov
                as="a"
                href="/login"
                style={{ color: "#6a9dff", fontWeight: 600, cursor: "pointer" }}
              >
                Sign in
              </Hov>
            </>
          ) : open === null ? (
            /* Nothing while we are still asking — an offer that appears and
               then vanishes is worse than a beat of blank space. */
            <span style={{ opacity: 0 }}>&nbsp;</span>
          ) : open ? (
            <>
              No account yet?{" "}
              <Hov
                as="a"
                href="/signup"
                style={{ color: "#6a9dff", fontWeight: 600, cursor: "pointer" }}
              >
                Claim this console
              </Hov>
            </>
          ) : (
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <CheckGlyph size={11} stroke={t(0.4)} />
              This console already has an owner.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

const inputStyle = {
  width: "100%",
  height: 36,
  padding: "0 12px",
  borderRadius: 10,
  background: "rgba(0,0,0,0.32)",
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "rgba(255,255,255,0.09)",
  outline: "none",
  color: "#f0f0f4",
  fontSize: 13.5,
} as const;

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "block", marginBottom: 12 }}>
      <span
        style={{
          display: "block",
          marginBottom: 5,
          fontSize: 11.5,
          fontWeight: 600,
          color: t(0.6),
        }}
      >
        {label}
      </span>
      {children}
      {hint ? (
        <span
          style={{
            display: "block",
            marginTop: 5,
            fontSize: 11,
            color: t(0.38),
          }}
        >
          {hint}
        </span>
      ) : null}
    </label>
  );
}

void w;
