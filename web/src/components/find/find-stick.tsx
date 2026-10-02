"use client";
// Find a project's filter bar stays in place under the top bar while the
// results scroll, like the top bar's check box (globals.css, .find-tray; the
// tabs stick instead on a tab with no filters). The top bar's height changes
// with the screen, so it's measured here into --find-top.
import { useEffect } from "react";

export function FindStick() {
  useEffect(() => {
    const root = document.documentElement;
    const header = document.querySelector<HTMLElement>(".site-header");
    if (!header) return;
    const measure = () => root.style.setProperty("--find-top", `${Math.round(header.getBoundingClientRect().height)}px`);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(header);
    return () => {
      ro.disconnect();
      root.style.removeProperty("--find-top");
    };
  }, []);
  return null;
}
