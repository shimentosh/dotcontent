"use client";

import type { Source } from "@/lib/sources-client";
import { frameUrl } from "@/lib/sources-client";
import { font, spring, t, w } from "@/lib/theme";
import { Hov } from "@/components/ui/Hov";
import { Button } from "@/components/ui";
import { CheckIcon } from "@/components/ui/Icons";

/**
 * Which moments of the video the model is going to look at.
 *
 * Lifted out of the researcher screen, which was doing three jobs in one file:
 * fetching a video, choosing frames, and reading an answer. This is the middle
 * one, and it is the only part with real interaction in it.
 *
 * It owns no state. The picked list, the timestamp box and the cutting all
 * belong to the screen — a picker that held its own selection would have to be
 * told to forget it every time a new video arrived, which is exactly the sort
 * of thing that gets missed.
 */

const kicker = {
  fontFamily: font.mono,
  fontSize: 9.5,
  letterSpacing: "0.14em",
  color: t(0.38),
} as const;

/** m:ss — how a person says a moment in a reel. */
export const clock = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};

export function FramePicker({
  source,
  picked,
  setPicked,
  chosen,
  at,
  setAt,
  onCut,
}: {
  source: Source;
  /** The files ticked, by name. */
  picked: string[];
  setPicked: (next: string[] | ((list: string[]) => string[])) => void;
  /** What will actually be sent — every frame when nothing is ticked. */
  chosen: string[];
  /** The "another moment" box, held by the screen so a cut can clear it. */
  at: string;
  setAt: (value: string) => void;
  onCut: () => void;
}) {
  const frames = source.frames;

  const toggle = (file: string) =>
    setPicked((list) =>
      list.includes(file) ? list.filter((f) => f !== file) : [...list, file],
    );

  return (
    <>
      <p style={{ margin: "0 0 14px", fontSize: 12.5, color: t(0.5) }}>
        Pick the moments worth reading — the address bar, the result on
        screen. Every picked frame is sent as a picture, so the right four
        beat all eight.
      </p>

      {/*
        The strip, and the toolbar that acts on it.

        The count comes first, because "how many am I sending" is the
        question the price of this run turns on. All and None sit beside it
        rather than under the grid: picking eight things one at a time is
        the work this screen exists to save.
      */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 10,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{ ...kicker, color: chosen.length ? "#6a9dff" : t(0.38) }}
        >
          {chosen.length} OF {frames.length} PICKED
        </span>

        <Button
          size="sm"
          variant="quiet"
          onClick={() => setPicked(frames.map((f) => f.file))}
          disabled={!frames.length || picked.length === frames.length}
        >
          All
        </Button>
        <Button
          size="sm"
          variant="quiet"
          onClick={() => setPicked([])}
          disabled={!picked.length}
        >
          None
        </Button>

        {/*
          Adding a moment belongs here, not under the grid: it is the same
          job as picking one — deciding what gets looked at — and it was
          two rows away from the thing it adds to.
        */}
        <span
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: 6,
            height: 32,
            padding: "0 4px 0 10px",
            borderRadius: 10,
            background: w(0.05),
            border: "1px solid " + w(0.08),
          }}
        >
          <span style={{ ...kicker, color: t(0.35) }}>AT</span>
          <input
            value={at}
            onChange={(e) => setAt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onCut();
            }}
            placeholder="1:12"
            aria-label="Cut a frame at this time"
            style={{
              width: 54,
              height: 24,
              border: "none",
              outline: "none",
              background: "transparent",
              fontFamily: font.mono,
              fontSize: 12,
              color: "#f0f0f4",
            }}
          />
          <Button
            size="sm"
            variant="accent"
            onClick={onCut}
            disabled={!at.trim()}
          >
            Cut frame
          </Button>
        </span>
      </div>

      {/*
        The video as a line, with a node per frame.

        Eight thumbnails say what was captured; they do not say WHEN, and
        "the bit where the address bar is up" is a question about time. The
        track is the video, each node sits where it was taken, and clicking
        one picks it — the same act as clicking its thumbnail, approached
        from the other side.
      */}
      {frames.length && source.duration ? (
        <div style={{ position: "relative", height: 24, margin: "2px 5px 14px" }}>
          <span
            aria-hidden
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: 10,
              height: 3,
              borderRadius: 2,
              background: w(0.09),
            }}
          />
          {frames.map((frame) => {
            const on = picked.includes(frame.file);
            const left = Math.min(
              100,
              Math.max(0, (frame.at / (source.duration || 1)) * 100),
            );
            return (
              <Hov
                key={"tick-" + frame.file}
                as="span"
                role="button"
                aria-label={(on ? "Skip" : "Pick") + " the frame at " + clock(frame.at)}
                title={clock(frame.at)}
                onClick={() => toggle(frame.file)}
                style={{
                  position: "absolute",
                  left: left + "%",
                  top: on ? 5 : 7,
                  width: on ? 13 : 9,
                  height: on ? 13 : 9,
                  marginLeft: on ? -6.5 : -4.5,
                  borderRadius: "50%",
                  cursor: "pointer",
                  background: on ? "#0057fc" : w(0.22),
                  boxShadow: on ? "0 0 10px rgba(0,87,252,0.55)" : "none",
                  transition: "all 180ms " + spring,
                }}
                hover={{ background: on ? "#3b7bff" : w(0.4) }}
              />
            );
          })}
        </div>
      ) : null}

      {frames.length ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(148px, 1fr))",
            gap: 10,
            marginBottom: 14,
          }}
        >
          {frames.map((frame) => {
            const on = picked.includes(frame.file);
            return (
              <Hov
                key={frame.file}
                role="button"
                aria-pressed={on}
                aria-label={(on ? "Skip" : "Pick") + " the frame at " + clock(frame.at)}
                onClick={() => toggle(frame.file)}
                style={{
                  position: "relative",
                  aspectRatio: "16 / 10",
                  borderRadius: 13,
                  overflow: "hidden",
                  cursor: "pointer",
                  background: "#0b0d12",
                  border: "1px solid " + (on ? "transparent" : w(0.08)),
                  /*
                   * A ring rather than a fat border: a 2px border on a
                   * 148px card reflows the picture inside it every time one
                   * is picked, and the whole grid twitches under the cursor.
                   */
                  boxShadow: on
                    ? "0 0 0 2px #0057fc, 0 10px 24px -12px rgba(0,87,252,0.8)"
                    : "0 1px 2px rgba(0,0,0,0.35)",
                  transition:
                    "transform 180ms " + spring + ", box-shadow 180ms " + spring,
                }}
                hover={{ transform: "translateY(-2px)" }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={frameUrl(source.id, frame.file)}
                  alt={"Frame at " + clock(frame.at)}
                  style={{
                    display: "block",
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    /*
                     * Picked reads as lit, skipped as set aside. Visible
                     * across eight cards at a glance, which a tick in the
                     * corner is not.
                     */
                    filter: on ? "none" : "grayscale(0.5) brightness(0.72)",
                    transition: "filter 180ms ease",
                  }}
                />

                <span
                  aria-hidden
                  style={{
                    position: "absolute",
                    inset: 0,
                    background:
                      "linear-gradient(to top, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.16) 38%, transparent 62%)",
                  }}
                />

                <span
                  style={{
                    position: "absolute",
                    left: 9,
                    bottom: 8,
                    fontFamily: font.mono,
                    fontSize: 10.5,
                    letterSpacing: "0.04em",
                    color: on ? "#dce8ff" : t(0.62),
                  }}
                >
                  {clock(frame.at)}
                </span>

                <span
                  aria-hidden
                  style={{
                    position: "absolute",
                    right: 8,
                    top: 8,
                    width: 20,
                    height: 20,
                    display: "grid",
                    placeItems: "center",
                    borderRadius: "50%",
                    background: on ? "#0057fc" : "rgba(8,10,14,0.55)",
                    border:
                      "1.5px solid " +
                      (on ? "#0057fc" : "rgba(255,255,255,0.45)"),
                    backdropFilter: "blur(4px)",
                    transition: "background 180ms " + spring,
                  }}
                >
                  {on ? <CheckIcon size={10} stroke="#fff" /> : null}
                </span>
              </Hov>
            );
          })}
        </div>
      ) : (
        <p style={{ margin: "0 0 12px", fontSize: 12.5, color: "#c99a3f" }}>
          No frames were cut — the video itself was not downloaded, or the
          machine that fetched it has ffmpeg switched off. That switch is per
          machine now, on Settings → Machines. It can still read the
          transcript.
        </p>
      )}

    </>
  );
}
