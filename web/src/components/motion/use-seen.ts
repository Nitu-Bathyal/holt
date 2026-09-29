"use client";

// The hooks the expressive patterns share (docs/design/EXPRESSIVE.md).
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { onMotionChange, prefersReducedMotion } from "@/lib/motion";

/**
 * Motion should stay still: the site's setting, else the device's
 * (lib/motion.ts). Updates when either changes. False on the server: its HTML
 * is the finished state either way.
 */
export function useReducedMotion() {
  return useSyncExternalStore(onMotionChange, prefersReducedMotion, () => false);
}

/**
 * `seen`: the element has been on screen. `below`: it started below the fold,
 * so a pattern may wind itself back and play when it's reached. Anything the
 * visitor could already see at load is left as the server drew it.
 */
export function useSeen<T extends HTMLElement>(margin = "0px 0px -15% 0px") {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  const [below, setBelow] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const start = el.getBoundingClientRect().top > innerHeight * 0.85;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        setSeen(true);
      },
      { rootMargin: margin },
    );
    // Measured once, at mount; the observer's first callback comes after it.
    queueMicrotask(() => setBelow(start));
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
