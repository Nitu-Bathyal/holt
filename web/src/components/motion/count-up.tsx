"use client";

// Numbers that count into place (the expressive design plan, patterns 4 and
// 11). <CountUpGroup> starts every <CountUp> inside it once it's on screen,
// and marks itself data-count="wait" | "go" | "done" so CSS can hold meters
// until then. Only for content that arrives on the client (a report that just
// finished): server HTML is never wound back. Each number keeps the width of
// its final value, so nothing shifts; screen readers and reduced motion get
// the final text.
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { countAt, countBetween, countFrom, countParts, parseSeen, settle } from "@/lib/count-up";
import { prefersReducedMotion } from "@/lib/motion";

type Phase = "wait" | "go" | "done";
const Group = createContext<Phase>("done");

export function CountUpGroup({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>(() => (typeof window === "undefined" || prefersReducedMotion() ? "done" : "wait"));

  useEffect(() => {
    const el = ref.current;
    if (!el || phase !== "wait") return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        setPhase("go");
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [phase]);

  return (
    <Group.Provider value={phase}>
      <div ref={ref} className={className} data-count={phase}>
        {children}
      </div>
    </Group.Provider>
  );
}

/** `text` counts up over 700ms, `delay` after its group comes on screen. */
export function CountUp({ text, delay = 0 }: { text: string; delay?: number }) {
  const phase = useContext(Group);
  const parts = useMemo(() => countParts(text), [text]);
  const counts = parts.some((p) => "n" in p);
  const [p, setP] = useState(0);

  useEffect(() => {
    if (phase !== "go" || !counts) return;
    let raf = 0;
    const t0 = performance.now() + delay;
    const tick = (t: number) => {
      const k = (t - t0) / 700;
      setP(settle(k));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase, counts, delay]);

  if (phase === "done" || !counts) return <>{text}</>;
  return (
    <>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {parts.map((part, i) =>
          "n" in part ? (
            <span key={i} className="inline-block text-right tabular-nums" style={{ minWidth: `${part.final.length}ch` }}>
              {countAt(part, p)}
            </span>
          ) : (
            <span key={i}>{part.text}</span>
          ),
        )}
      </span>
    </>
  );
}

const SEEN_KEY = "holt-seen";
// What each number started from on this page view, so React's dev double
// effects (and a re-render before the count ends) don't lose it.
const started = new Map<string, number | null>();

function startFor(id: string, value: number): number | null {
  const key = `${id}=${value}`;
  if (!started.has(key)) {
    let seen: Record<string, number> = {};
    try {
      seen = parseSeen(localStorage.getItem(SEEN_KEY));
      localStorage.setItem(SEEN_KEY, JSON.stringify({ ...seen, [id]: value }));
    } catch {
      // Storage blocked: every number just stays still.
      return null;
    }
    started.set(key, countFrom(seen[id], value));
  }
  return started.get(key)!;
}

const noop = () => () => {};

/**
 * A number that counts into place when it's new to this visitor (the expressive design plan,
 * pattern 11): from what they saw last time, or from 0 the first time. An
 * unchanged number stays still. Server HTML is never wound back: on a full
 * page load the number only gets remembered, and it counts when it arrives
 * with a client navigation or changes while the page is open. Reduced motion
 * and screen readers get the final value.
 */
export function NewCount({ id, value, className }: { id: string; value: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  // False while React hydrates the server's HTML, true when mounted on the client.
  const client = useSyncExternalStore(noop, () => true, () => false);
  const hydrated = useRef(!client);

  useLayoutEffect(() => {
    const el = ref.current;
    const key = `${id}=${value}`;
    const from = startFor(id, value);
    const still = hydrated.current || prefersReducedMotion();
    hydrated.current = false;
    if (!el || from === null || still) {
      started.delete(key);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const k = (t - t0) / 700;
      el.textContent = String(countBetween(from, value, k));
      if (k < 1) raf = requestAnimationFrame(tick);
      else started.delete(key);
    };
    el.textContent = String(from);
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      el.textContent = String(value);
    };
  }, [id, value]);

  return (
    <>
      <span className="sr-only">{value}</span>
      <span ref={ref} aria-hidden="true" className={`inline-block text-right tabular-nums ${className ?? ""}`} style={{ minWidth: `${String(value).length}ch` }}>
        {value}
      </span>
    </>
  );
}
