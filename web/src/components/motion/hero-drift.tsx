"use client";

// The hero answers the pointer, gently (docs/design/EXPRESSIVE.md): the
// headline, the paste box and the badges drift a few px toward it, eased, at
// different depths (globals.css, [data-hero] rules on --drift-x/--drift-y).
// Uses the CSS `translate` property, so it composes with the entrance
// animations' `transform`. Mouse only; nothing on touch or under reduced
// motion. Nothing moves until the pointer does, so first paint is untouched.
import { useEffect, useRef } from "react";

export function HeroDrift() {
  const probe = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const hero = probe.current?.closest<HTMLElement>("[data-hero]");
    if (!hero || !matchMedia("(pointer: fine)").matches || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let tx = 0, ty = 0, x = 0, y = 0, raf = 0;
    const step = () => {
      x += (tx - x) * 0.08;
      y += (ty - y) * 0.08;
      hero.style.setProperty("--drift-x", x.toFixed(3));
      hero.style.setProperty("--drift-y", y.toFixed(3));
      raf = Math.abs(tx - x) + Math.abs(ty - y) > 0.002 ? requestAnimationFrame(step) : 0;
    };
    const kick = () => {
      if (!raf) raf = requestAnimationFrame(step);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const r = hero.getBoundingClientRect();
      tx = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
      ty = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1));
      kick();
    };
    const onLeave = () => {
      tx = 0;
      ty = 0;
      kick();
    };
    hero.addEventListener("pointermove", onMove);
    hero.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(raf);
      hero.removeEventListener("pointermove", onMove);
      hero.removeEventListener("pointerleave", onLeave);
      hero.style.removeProperty("--drift-x");
      hero.style.removeProperty("--drift-y");
    };
  }, []);

  return <span ref={probe} hidden />;
}
