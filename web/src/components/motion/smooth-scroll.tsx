"use client";

// Smooth wheel scrolling for the whole site: one Lenis instance, driven by
// GSAP's ticker, with ScrollTrigger updated on every Lenis scroll so the
// landing page's scroll reveals and the cat stay in sync (docs/design/MOTION.md §5).
//
// What made the old landing-only Lenis feel laggy, and what this does instead:
// - It loaded once the page was idle, so scrolling changed feel a couple of
//   seconds into the visit. This starts as soon as the page hydrates.
// - It eased each wheel notch over 1.15s and 10% shorter. This uses a quick
//   lerp and full-length notches.
// - It only ran on one page. This runs on every page, so the feel is the same
//   everywhere.
//
// Off under reduced motion (lib/motion.ts) and on touch-only devices (they keep native
// scrolling; loading GSAP there would buy nothing). Nested scroll areas scroll
// on their own (allowNestedScroll, plus data-lenis-prevent on the focus dialog
// and the menus), and a modal stops Lenis while it's open (pauseSmoothScroll).
import type Lenis from "lenis";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { prefersReducedMotion } from "@/lib/motion";
import { useReducedMotion } from "./use-seen";

let lenis: Lenis | null = null;
let paused = false;

/** Stop smooth scrolling while a modal is open; start it again when it closes. */
export function pauseSmoothScroll(on: boolean) {
  paused = on;
  if (on) lenis?.stop();
  else lenis?.start();
}

/** Back to the top of the page: a Lenis glide where it runs, otherwise native (instant under reduced motion). */
export function scrollToTop() {
  if (lenis) return lenis.scrollTo(0);
  window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
}

export function SmoothScroll() {
  const pathname = usePathname();
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced || !matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    (async () => {
      const [{ gsap }, { ScrollTrigger }, { default: Lenis }] = await Promise.all([
        import("gsap"),
        import("gsap/ScrollTrigger"),
        import("lenis"),
      ]);
      if (cancelled) return;
      gsap.registerPlugin(ScrollTrigger);
      const l = new Lenis({
        lerp: 0.15,
        wheelMultiplier: 1,
        syncTouch: false,
        anchors: true,
        allowNestedScroll: true,
        stopInertiaOnNavigate: true,
      });
      const off = l.on("scroll", ScrollTrigger.update);
      const raf = (time: number) => l.raf(time * 1000);
      gsap.ticker.add(raf);
      gsap.ticker.lagSmoothing(0);
      lenis = l;
      if (paused) l.stop();
      cleanup = () => {
        off();
        gsap.ticker.remove(raf);
        l.destroy();
        if (lenis === l) lenis = null;
      };
    })();
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [reduced]);

  // A new page never shows mid-scroll: drop whatever glide was running and
  // take the position the router just set (the top, or where it was for a
  // scroll={false} link such as the discover tabs). Hash links scroll to their
  // target through Lenis (anchors: true).
  useEffect(() => {
    lenis?.scrollTo(window.scrollY, { immediate: true, force: true });
  }, [pathname]);

  return null;
}
