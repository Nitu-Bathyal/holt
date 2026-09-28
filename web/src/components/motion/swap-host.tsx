"use client";

// "Swap hub for holt", acted out (docs/design/EXPRESSIVE.md, pattern 2): the
// letters of "hub" in github.com flip over to "holt" like a split-flap board,
// and back, only while the line is on screen. Click to flip it yourself. The
// server HTML shows the answer (this site's host). Reduced motion: before and
// after, side by side. A host that isn't *githolt.com (local dev) is shown
// plainly, since the flip would name a host that isn't this one.
// `big`: the URL-trick section's version, a whole address at display size.
import Link from "next/link";
import { useEffect, useState } from "react";
import { SITE_HOST } from "@/lib/site";
import { useOnScreen, useReducedMotion } from "./use-seen";

const FROM = ["h", "u", "b", ""];
const TO = ["h", "o", "l", "t"];

export function SwapHost({ path = "", big = false }: { path?: string; big?: boolean }) {
  const m = /^(.*)githolt(\.com)$/.exec(SITE_HOST);
  const { ref, on } = useOnScreen<HTMLSpanElement>();
  const still = useReducedMotion();
  // true = "holt", as in the server HTML.
  const [swapped, setSwapped] = useState(true);

  useEffect(() => {
    if (still || !on) return;
    // holt (3.2s) → hub (1.6s) → holt …
    const t = window.setTimeout(() => setSwapped((s) => !s), swapped ? 3200 : 1600);
    return () => window.clearTimeout(t);
  }, [still, on, swapped]);

  const size = big ? "swap--big" : "";
  const tail = path && <span className="text-muted">{path}</span>;
  const tryIt = big && path && (
    <span className="mt-6 block">
      <Link href={path} prefetch={false} className="bracket-link">
        [ try it on {path.slice(1)} → ]
      </Link>
    </span>
  );

  if (!m) {
    return (
      <>
        <code className={`font-mono ${size}`}>github.com{path}</code> → <code className={`font-mono text-muted ${size}`}>{SITE_HOST}{path}</code>
      </>
    );
  }
  const [, sub, tld] = m;
  if (still) {
    return (
      <span className={big ? "block" : ""}>
        <code className={`font-mono ${size} ${big ? "block space-y-1" : ""}`}>
          <span className={big ? "block text-faint" : ""}>
            git<span className="text-orange line-through decoration-2">hub</span>.com{path}
          </span>
          {big ? null : " → "}
          <span className={big ? "block" : "text-muted"}>
            {sub}git<span className="swap-on">holt</span>
            {tld}
            {tail}
          </span>
        </code>
        {tryIt}
      </span>
    );
  }
  return (
    <span ref={ref} className={big ? "block" : ""}>
      <button
        type="button"
        onClick={() => setSwapped((s) => !s)}
        className={`swap font-mono text-left ${size}`}
        data-swapped={swapped}
        aria-label={`github.com${path} becomes ${SITE_HOST}${path}. Press to flip it.`}
      >
        <span aria-hidden="true">
          {/* "staging." only belongs to the holt side: it fades out for "hub". */}
          <span className="swap-sub">{sub}</span>git
          <span className="swap-flaps">
            {TO.map((to, i) => (
              <span key={i} className="swap-flap" style={{ ["--i" as string]: i }}>
                <span className="swap-from">{FROM[i] || " "}</span>
                <span className="swap-to">{to}</span>
              </span>
            ))}
          </span>
          <span className="swap-tail">
            {tld}
            {tail}
          </span>
        </span>
      </button>
      {tryIt}
    </span>
  );
}
