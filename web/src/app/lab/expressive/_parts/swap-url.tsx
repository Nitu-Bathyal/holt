"use client";

// PROTOTYPE, pattern 2: "swap hub for holt", acted out. The letters of "hub"
// flip over to "holt" like a split-flap board, then back, while it's on
// screen. The final state is in the HTML, so it reads without JS; reduced
// motion shows the before and after side by side.
import Link from "next/link";
import { useEffect, useState } from "react";
import { useOnScreen, useReduced } from "./motion";

const FROM = ["h", "u", "b", ""];
const TO = ["h", "o", "l", "t"];

export function SwapUrl({ path = "/pallets/flask", compact = false }: { path?: string; compact?: boolean }) {
  const size = compact ? "text-[1em]" : "text-[clamp(1.1rem,3.4vw,2rem)] font-semibold tracking-[-0.03em]";
  const reduced = useReduced();
  const { ref, on } = useOnScreen<HTMLSpanElement>();
  // true = "holt". Starts on "holt": the server HTML shows the answer.
  const [swapped, setSwapped] = useState(true);

  useEffect(() => {
    if (reduced || !on) return;
    // hub (1.6s) → holt (3.2s) → hub … only while visible.
    const t = window.setTimeout(() => setSwapped((s) => !s), swapped ? 3200 : 1600);
    return () => window.clearTimeout(t);
  }, [reduced, on, swapped]);

  if (reduced) {
    // Compact sits inside a sentence, so no block elements.
    const Line = compact ? "span" : "p";
    const Wrap = compact ? "span" : "div";
    return (
      <Wrap className={compact ? "" : `block space-y-2 ${size}`}>
        <Line className="text-faint">
          git<span className="text-orange line-through decoration-2">hub</span>.com{path}
        </Line>
        {compact && " → "}
        <Line>
          git<span className="xp-swap-on">holt</span>.com
          <span className="text-muted">{path}</span>
        </Line>
      </Wrap>
    );
  }

  return (
    <span ref={ref} className={compact ? "" : "block"}>
      <button
        type="button"
        onClick={() => setSwapped((s) => !s)}
        className={`xp-swap text-left ${size}`}
        data-swapped={swapped}
        aria-label={`github.com${path} becomes githolt.com${path}. Press to flip it.`}
      >
        <span aria-hidden="true">
          <span className="text-faint">git</span>
          <span className="xp-flaps">
            {TO.map((to, i) => (
              <span key={i} className="xp-flap" style={{ ["--i" as string]: i }}>
                <span className="xp-flap-from">{FROM[i] || " "}</span>
                <span className="xp-flap-to">{to}</span>
              </span>
            ))}
          </span>
          {/* Slides left over the empty 4th flap while it reads "hub". */}
          <span className="xp-swap-tail">
            <span className="text-faint">.com</span>
            <span className="text-ink">{path}</span>
          </span>
        </span>
      </button>
      {!compact && <span className="mt-5 block">
        <Link href={`/https://github.com${path}`} prefetch={false} className="bracket-link">
          [ try it on {path.slice(1)} → ]
        </Link>
      </span>}
    </span>
  );
}
