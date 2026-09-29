"use client";
// "Check a repo" is an action, not a page: it puts the cursor in a repo box
// and flashes the box so you see where it went. The box is the one on this
// page ([data-check-target]: the top bar's, or /me's paste box). With none in
// sight (a phone, or a page without one) it goes to /me#check, and /me does
// the same on arrival.
import { useEffect } from "react";
import { prefersReducedMotion } from "@/lib/motion";
import { CHECK_HREF } from "@/lib/shell";

function visibleTarget(): HTMLElement | null {
  const all = [...document.querySelectorAll<HTMLElement>("[data-check-target]")];
  // The page's own box first (it's bigger), then the top bar's.
  all.sort((a, b) => Number(a.dataset.checkTarget === "bar") - Number(b.dataset.checkTarget === "bar"));
  return all.find((el) => el.getClientRects().length > 0) ?? null;
}

/** Focus the repo box on this page and flash it. False when there's none in sight. */
export function focusCheck(): boolean {
  const box = visibleTarget();
  const input = box?.querySelector<HTMLInputElement>("input");
  if (!box || !input) return false;
  box.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  input.focus({ preventScroll: true });
  box.classList.remove("check-flash");
  void box.offsetWidth; // restart the animation on a second click
  box.classList.add("check-flash");
  return true;
}

/** Catches clicks on "Check a repo" links anywhere in the shell. */
export function CheckLinks() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]");
      if (a?.getAttribute("href") !== CHECK_HREF) return;
      if (focusCheck()) {
        e.preventDefault();
        const menu = a.closest("[popover]") as HTMLElement | null;
        if (menu?.matches(":popover-open")) menu.hidePopover();
      }
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);
  return null;
}

/** On /me: arriving at #check focuses the paste box. */
export function FocusOnHash() {
  useEffect(() => {
    if (window.location.hash !== "#check") return;
    // After the page transition has painted.
    const t = window.setTimeout(focusCheck, 120);
    return () => window.clearTimeout(t);
  }, []);
  return null;
}
