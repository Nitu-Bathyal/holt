"use client";
// PROTOTYPE: the top bar's bell with its unread count, and the dropdown
// under it. Opening it doesn't clear the count: a row is read when it's
// opened, or with "mark all read".
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { CatFace } from "@/components/cat-face";
import { BellIcon } from "./bell-icon";
import { ALERT_RULE, ago, alertLine, type Access, type AlertItem } from "./types";

export function AlertBell({ access, items, until, watching, settingsHref, onTurnOn, defaultOpen = false }: {
  access: Access;
  items: AlertItem[];
  /** "14 Oct": when alerts stop, or stopped. */
  until: string;
  watching: number;
  settingsHref: string;
  onTurnOn: () => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [read, setRead] = useState<Set<number>>(() => new Set(items.filter((a) => a.read).map((a) => a.id)));
  const box = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const shown = access === "on" || access === "ended" ? items : [];
  const unread = access === "on" ? shown.filter((a) => !read.has(a.id)).length : 0;
  const markRead = (id: number) => setRead((r) => new Set(r).add(id));

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={panelId}
        className="relative grid size-11 place-items-center text-muted transition-colors hover:text-ink"
        aria-label={unread ? `Alerts, ${unread} unread` : "Alerts"}
      >
        <BellIcon />
        {unread > 0 && (
          <span className="side-badge absolute right-0.5 top-1" data-tone="needs" aria-hidden="true">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div id={panelId} role="region" aria-label="Alerts" className="alerts-panel">
          <div className="flex items-baseline justify-between gap-4 border-b border-line px-4 py-3">
            <h2 className="text-[0.95rem] font-semibold tracking-tight">Alerts</h2>
            {unread > 0 && (
              <button type="button" onClick={() => setRead(new Set(shown.map((a) => a.id)))} className="text-link tap text-[0.8rem]">
                mark all read
              </button>
            )}
          </div>

          {access === "off" && (
            <div className="px-4 py-5">
              <p className="font-sans text-[0.95rem]">Know when it&rsquo;s your turn.</p>
              <button type="button" onClick={onTurnOn} className="btn-primary mt-4 min-h-11 px-4 text-[0.84rem]">turn on alerts →</button>
            </div>
          )}

          {access === "empty" && (
            <div className="flex items-center gap-3 px-4 py-6">
              <CatFace mood="ready" className="text-[0.95rem]" />
              <p className="font-sans text-[0.95rem] text-muted">Nothing yet.</p>
            </div>
          )}

          {access === "ended" && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-panel-2/60 px-4 py-3">
              <p className="font-sans text-[0.9rem]">Alerts ended on {until}.</p>
              <Link href="/pricing" className="btn-primary min-h-10 px-4 text-[0.82rem]">get Pro →</Link>
            </div>
          )}

          {shown.length > 0 && (
            <ul className={`max-h-[min(26rem,60vh)] overflow-y-auto ${access === "ended" ? "opacity-60" : ""}`}>
              {shown.map((a) => {
                const isUnread = access === "on" && !read.has(a.id);
                return (
                  <li key={a.id} className="alert-row" style={{ "--rule": ALERT_RULE[a.kind] } as React.CSSProperties}>
                    <span className="alert-dot" data-on={isUnread || undefined} aria-hidden="true" />
                    <div className="min-w-0">
                      <a
                        href={`https://github.com/${a.repo}/pull/${a.number}`}
                        onClick={() => markRead(a.id)}
                        className={`block font-sans text-[0.9rem] leading-snug hover:underline ${isUnread ? "text-ink" : "text-muted"}`}
                      >
                        {isUnread && <span className="sr-only">Unread: </span>}
                        {alertLine(a)}
                      </a>
                      <p className="mt-1 text-[0.76rem] text-faint">
                        {ago(a.hoursAgo)} ·{" "}
                        <Link href={`/${a.repo}`} className="relative z-10 hover:text-blue hover:underline">report</Link>
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {(access === "on" || access === "empty") && (
            <div className="flex items-baseline justify-between gap-4 border-t border-line px-4 py-2.5 text-[0.8rem]">
              <span className="text-faint">Watching {watching} PR{watching === 1 ? "" : "s"} · until {until}</span>
              <Link href={settingsHref} className="text-link tap">settings</Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
