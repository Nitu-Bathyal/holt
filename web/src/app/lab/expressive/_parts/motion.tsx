"use client";

// PROTOTYPE (/lab/expressive): the motion switch and the two hooks every
// pattern here shares. "reduced" is the visitor's system setting, or the lab
// bar's override, so the reduced-motion fallback can be checked on staging.
import { createContext, useContext, useEffect, useRef, useState } from "react";

const Reduced = createContext(false);

export function useReduced() {
  return useContext(Reduced);
}

export function MotionRoot({ children }: { children: React.ReactNode }) {
  const [system, setSystem] = useState(false);
  const [override, setOverride] = useState<"full" | "reduce" | null>(null);

  useEffect(() => {
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setSystem(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const reduced = override ? override === "reduce" : system;
  return (
    <Reduced.Provider value={reduced}>
      <div data-lab-expressive data-motion={reduced ? "reduce" : "full"}>
        {children}
        <LabBar reduced={reduced} system={system} set={setOverride} />
      </div>
    </Reduced.Provider>
  );
}

/**
 * True once the element has been on screen (or at once under reduced motion).
 * `below`: whether it started below the fold, so a pattern can skip its intro
 * for anything the visitor could already see at load.
 */
export function useSeen<T extends HTMLElement>(margin = "0px 0px -15% 0px") {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  const [below, setBelow] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setBelow(el.getBoundingClientRect().top > innerHeight * 0.85);
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin: margin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [margin]);
  return { ref, seen, below };
}

/** True while the element is on screen: loops pause when it isn't. */
export function useOnScreen<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setOn(e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return { ref, on };
}

function LabBar({ reduced, system, set }: { reduced: boolean; system: boolean; set: (v: "full" | "reduce" | null) => void }) {
  return (
    <div className="xp-labbar" role="group" aria-label="Prototype controls">
      <span>motion</span>
      <button type="button" aria-pressed={!reduced} onClick={() => set(system ? "full" : null)}>
        full
      </button>
      <button type="button" aria-pressed={reduced} onClick={() => set(system ? null : "reduce")}>
        reduced
      </button>
    </div>
  );
}
