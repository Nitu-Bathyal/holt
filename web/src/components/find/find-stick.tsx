"use client";
// Find a project's tabs and filter tray stay in place under the top bar while
// the results scroll, like the top bar's check box (globals.css, .find-band /
// .find-tray). Their heights change (more filters, a phone's rows), so they're
// measured here into --find-top and --find-tray-top. A tray too tall to leave
// room for results doesn't stick (data-find-tall), so all of it stays reachable.
import { useEffect } from "react";

/** The most of the screen the band and tray may hold before they scroll with the page. */
const MAX_SHARE = 0.55;

export function FindStick() {
  useEffect(() => {
    const root = document.documentElement;
    const header = document.querySelector<HTMLElement>(".site-header");
    const band = document.querySelector<HTMLElement>(".find-band");
    const tray = document.querySelector<HTMLElement>(".app-page .find-tray");
    const measure = () => {
      const h = header?.getBoundingClientRect().height ?? 0;
      const b = band?.getBoundingClientRect().height ?? 0;
      const t = tray?.getBoundingClientRect().height ?? 0;
      root.style.setProperty("--find-top", `${Math.round(h)}px`);
      root.style.setProperty("--find-tray-top", `${Math.round(h + b)}px`);
      root.toggleAttribute("data-find-tall", b + t > window.innerHeight * MAX_SHARE);
    };
    measure();
    const ro = new ResizeObserver(measure);
    for (const el of [header, band, tray]) if (el) ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
      root.style.removeProperty("--find-top");
      root.style.removeProperty("--find-tray-top");
      root.removeAttribute("data-find-tall");
    };
  }, []);
  return null;
}
