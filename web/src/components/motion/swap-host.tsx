"use client";

// "Swap hub for holt", acted out (docs/design/EXPRESSIVE.md, pattern 2): the
// letters of "hub" in github.com flip over to "holt" like a split-flap board,
// and back, only while the line is on screen. Click to flip it yourself. The
// server HTML shows the answer (this site's host). Reduced motion: before and
// after, side by side. A host that isn't *githolt.com (local dev) is shown
// plainly, since the flip would name a host that isn't this one.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { SITE_HOST } from "@/lib/site";

const REDUCE = "(prefers-reduced-motion: reduce)";
const onReduceChange = (cb: () => void) => {
  const mq = matchMedia(REDUCE);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};

const FROM = ["h", "u", "b", ""];
const TO = ["h", "o", "l", "t"];

export function SwapHost() {
  const m = /^(.*)githolt(\.com)$/.exec(SITE_HOST);
  const ref = useRef<HTMLButtonElement>(null);
  const [on, setOn] = useState(false);
  const still = useSyncExternalStore(onReduceChange, () => matchMedia(REDUCE).matches, () => false);
  // true = "holt", as in the server HTML.
  const [swapped, setSwapped] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setOn(e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, [still]);

  useEffect(() => {
    if (still || !on) return;
    // holt (3.2s) → hub (1.6s) → holt …
    const t = window.setTimeout(() => setSwapped((s) => !s), swapped ? 3200 : 1600);
    return () => window.clearTimeout(t);
  }, [still, on, swapped]);

  if (!m) {
    return (
      <>
        <code className="font-mono">github.com</code> → <code className="font-mono text-muted">{SITE_HOST}</code>
      </>
    );
  }
  const [, sub, tld] = m;
  if (still) {
    return (
      <code className="font-mono">
        <span>
          git<span className="text-orange line-through decoration-2">hub</span>.com
        </span>{" "}
        →{" "}
        <span className="text-muted">
          {sub}git<span className="swap-on">holt</span>
          {tld}
        </span>
      </code>
    );
  }
  return (
    <button
      ref={ref}
      type="button"
      onClick={() => setSwapped((s) => !s)}
      className="swap font-mono"
      data-swapped={swapped}
      aria-label={`github.com becomes ${SITE_HOST}. Press to flip it.`}
    >
      <span aria-hidden="true">
        {/* "staging." only belongs to the holt side: it fades out for "hub". */}
        <span className="swap-sub">{sub}</span>git
        <span className="swap-flaps">
          {TO.map((to, i) => (
            <span key={i} className="swap-flap" style={{ ["--i" as string]: i }}>
              <span className="swap-from">{FROM[i] || " "}</span>
              <span className="swap-to">{to}</span>
            </span>
          ))}
        </span>
        <span className="swap-tail">{tld}</span>
      </span>
    </button>
  );
}
