"use client";
// Folds the desktop rail to icons and back: the button at the start of the top
// bar, on the rail's edge, and "[" from anywhere. The state
// lives on <html data-rail> (CSS draws both rails from it) and in a cookie, so
// the server paints the right one first (lib/shell.ts).
//
// The page reflows once: the rail's width changes at once, and the column
// beside it (top bar and page) slides from where it was to where it now sits,
// in step with the rail's panel.
import { useCallback, useEffect, useState } from "react";
import { cssTimeMs, prefersReducedMotion } from "@/lib/motion";
import { isRailKey, RAIL_KEY, railCookie } from "@/lib/shell";
import { Icon } from "./icons";

const DESKTOP = "(min-width: 1024px)";

function setRail(collapsed: boolean) {
  const root = document.documentElement;
  const col = document.getElementById("app-column");
  const before = col?.getBoundingClientRect().left ?? 0;
  col?.getAnimations().forEach((a) => a.cancel());
  if (collapsed) root.dataset.rail = "collapsed";
  else delete root.dataset.rail;
  document.cookie = railCookie(collapsed);
  if (!col || prefersReducedMotion()) return;
  const dx = before - col.getBoundingClientRect().left;
  if (!dx) return;
  const css = getComputedStyle(root);
  col.animate([{ transform: `translateX(${dx}px)` }, { transform: "none" }], {
    duration: cssTimeMs(css.getPropertyValue("--dur-slow"), 240),
    easing: css.getPropertyValue("--ease-move").trim() || "ease",
  });
}

export function RailToggle({ initial }: { initial: boolean }) {
  const [collapsed, setCollapsed] = useState(initial);
  const toggle = useCallback(() => {
    const next = document.documentElement.dataset.rail !== "collapsed";
    setRail(next);
    setCollapsed(next);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !matchMedia(DESKTOP).matches) return;
      const typing = !!(e.target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable]");
      if (!isRailKey(e, typing)) return;
      e.preventDefault();
      toggle();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [toggle]);

  const label = collapsed ? "Expand sidebar" : "Collapse sidebar";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      aria-expanded={!collapsed}
      aria-controls="app-rail"
      aria-keyshortcuts={RAIL_KEY}
      className="rail-toggle hidden size-11 shrink-0 place-items-center text-muted transition-colors hover:text-ink lg:grid"
    >
      <Icon name={collapsed ? "rail-closed" : "rail-open"} className="size-5" />
      <span className="tip tip-below" aria-hidden="true">
        {label} <kbd>{RAIL_KEY}</kbd>
      </span>
    </button>
  );
}
