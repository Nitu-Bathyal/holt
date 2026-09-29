"use client";

// Numbers that count into place (docs/design/EXPRESSIVE.md, patterns 4 and
// 11). <CountUpGroup> starts every <CountUp> inside it once it's on screen,
// and marks itself data-count="wait" | "go" | "done" so CSS can hold meters
// until then. Only for content that arrives on the client (a report that just
// finished): server HTML is never wound back. Each number keeps the width of
// its final value, so nothing shifts; screen readers and reduced motion get
// the final text.
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { countAt, countParts, settle } from "@/lib/count-up";
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
