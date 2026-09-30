"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const GAP = 12;
const EDGE = 8;

/**
 * A wrapper that shows `tip` beside it while hovered or focused. The tip is
 * drawn outside the page's boxes (in the open dialog, or the body) at measured
 * coordinates, so no card, grid or scroll area can cut it off. It goes to the
 * right when there is room, else the left, else above (or below near the top).
 */
export function TipHost({ tip, label, className, style, children }: { tip: React.ReactNode; label: string; className?: string; style?: React.CSSProperties; children: React.ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  // Where the tip is drawn while open (the dialog it is in, else the body), chosen when it opens.
  const [open, setOpen] = useState<Element | null>(null);
  const show = () => setOpen(host.current?.closest("dialog") ?? document.body);

  useLayoutEffect(() => {
    const h = host.current;
    const b = box.current;
    if (!open || !h || !b) return;
    const r = h.getBoundingClientRect();
    const { offsetWidth: w, offsetHeight: hh } = b;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const clamp = (v: number, max: number) => Math.max(EDGE, Math.min(v, max));
    let left: number;
    let top: number;
    if (r.right + GAP + w <= vw - EDGE) {
      left = r.right + GAP;
      top = clamp(r.top + r.height / 2 - hh / 2, vh - hh - EDGE);
    } else if (r.left - GAP - w >= EDGE) {
      left = r.left - GAP - w;
      top = clamp(r.top + r.height / 2 - hh / 2, vh - hh - EDGE);
    } else {
      left = clamp(r.left, vw - w - EDGE);
      top = r.top - GAP - hh >= EDGE ? r.top - GAP - hh : Math.min(r.bottom + GAP, vh - hh - EDGE);
    }
    b.style.left = `${left}px`;
    b.style.top = `${top}px`;
    b.style.visibility = "visible";
  }, [open]);

  // It stays where it was measured, so anything that moves the page closes it.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <div
      ref={host}
      role="img"
      aria-label={label}
      tabIndex={0}
      onMouseEnter={show}
      onMouseLeave={() => setOpen(null)}
      onFocus={show}
      onBlur={() => setOpen(null)}
      className={className}
      style={style}
    >
      {children}
      {open &&
        createPortal(
          <div ref={box} aria-hidden="true" style={{ visibility: "hidden" }} className="pointer-events-none fixed left-0 top-0 z-[80] w-max max-w-[min(15rem,80vw)] border border-line-strong bg-panel px-2.5 py-2 text-left font-sans text-[0.74rem] leading-snug text-muted shadow-card">
            {tip}
          </div>,
          open,
        )}
    </div>
  );
}
