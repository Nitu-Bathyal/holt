"use client";
// The top bar's bell with its unread count, and the list under it (API.md,
// "PR watch (alerts)"). Opening the list doesn't clear the count: an alert is
// read when it's opened, or with "mark read". The count is asked again every
// few minutes and when the tab comes back.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { CatFace } from "@/components/cat-face";
import { ALERT_RULE, ALERTS_EVENT, alertLinks, alertView, badge, COUNT_EVERY_MS, COUNT_FRESH_MS, dayMonth, watchingLine } from "@/lib/alerts";
import { fetchCount, fetchList, markRead } from "@/lib/alerts-client";
import { timeAgo } from "@/lib/format";
import { ALERT_SETTINGS } from "@/lib/settings";
import type { AlertList } from "@/lib/types";
import { BellIcon } from "./bell-icon";
import { TURN_ON_FAILED, useTurnOn } from "./use-turn-on";

export function AlertBell({ initial }: { initial: AlertList }) {
  const router = useRouter();
  const [list, setList] = useState(initial);
  // The server rendered the shell again (a refresh): its list is the newer one.
  const [seen, setSeen] = useState(initial);
  if (initial !== seen) {
    setSeen(initial);
    setList(initial);
  }
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  const view = alertView(list.access, list.enabled);
  const live = view === "on";
  const unread = live ? list.unread : 0;

  // What the bell shows now, for the count check below.
  const shown = useRef(unread);
  useEffect(() => {
    shown.current = unread;
  }, [unread]);

  const reload = useCallback(async () => {
    const next = await fetchList();
    if (next) setList(next);
  }, []);

  const { turnOn, busy, failed } = useTurnOn(() => router.refresh());

  // Alerts were turned on or off somewhere else on the page.
  useEffect(() => {
    const changed = () => void reload();
    window.addEventListener(ALERTS_EVENT, changed);
    return () => window.removeEventListener(ALERTS_EVENT, changed);
  }, [reload]);

  // The unread count, while alerts are on and the tab is in front.
  useEffect(() => {
    if (!live) return;
    let asked = Date.now();
    let gone = false;
    const ask = async () => {
      asked = Date.now();
      const n = await fetchCount();
      if (!gone && n != null && n !== shown.current) void reload();
    };
    const back = () => {
      if (document.visibilityState === "visible" && Date.now() - asked > COUNT_FRESH_MS) void ask();
    };
    const timer = setInterval(() => document.visibilityState === "visible" && void ask(), COUNT_EVERY_MS);
    document.addEventListener("visibilitychange", back);
    window.addEventListener("focus", back);
    return () => {
      gone = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", back);
      window.removeEventListener("focus", back);
    };
  }, [live, reload]);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  if (view === "hidden") return null;

  function toggle() {
    if (!open) void reload();
    setOpen((o) => !o);
  }

  function read(id: number) {
    setList((l) => {
      if (!l.items.some((a) => a.id === id && !a.read_at)) return l;
      const at = new Date().toISOString();
      return { ...l, unread: Math.max(0, l.unread - 1), items: l.items.map((a) => (a.id === id ? { ...a, read_at: at } : a)) };
    });
    return markRead({ ids: [id] });
  }

  async function readOne(id: number) {
    await read(id);
    router.refresh(); // My PRs drops the row's "new"
  }

  async function readAll() {
    const at = new Date().toISOString();
    setList((l) => ({ ...l, unread: 0, items: l.items.map((a) => (a.read_at ? a : { ...a, read_at: at })) }));
    if (!(await markRead({ all: true }))) await reload();
    router.refresh();
  }

  const count = badge(unread);
  const close = () => setOpen(false);

  return (
    <div ref={box} className="alerts-bell relative">
      <button
        ref={button}
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={unread ? `Alerts, ${unread} unread` : "Alerts"}
        className={`relative grid size-11 place-items-center border transition-colors ${
          open ? "border-line-strong bg-panel text-ink" : "border-transparent text-muted hover:border-line hover:bg-panel hover:text-ink"
        }`}
      >
        <BellIcon />
        {count && (
          <span className="side-badge absolute -right-1 -top-1" data-tone="needs" aria-hidden="true">
            {count}
          </span>
        )}
      </button>

      {open && (
        <div id={panelId} role="region" aria-label="Alerts" className="alerts-panel" data-lenis-prevent>
          <div className="flex min-h-11 items-center justify-between gap-4 border-b border-line bg-panel-2 px-4">
            <h2 className="flex items-center gap-2 text-[0.76rem] uppercase tracking-[0.08em] text-faint">
              Alerts
              {unread > 0 && <span className="tabular-nums normal-case tracking-normal text-ink">{unread} new</span>}
            </h2>
            {unread > 0 && (
              <button type="button" onClick={readAll} className="min-h-11 text-[0.8rem] text-blue hover:underline">
                mark all read
              </button>
            )}
          </div>

          {view === "off" && (
            <div className="px-4 py-5">
              <div className="flex items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center border border-line-strong text-blue">
                  <BellIcon className="size-[18px]" />
                </span>
                <div className="min-w-0">
                  <p className="text-[0.95rem] font-semibold tracking-tight text-ink">Know when it&rsquo;s your turn.</p>
                  <p className="mt-1 font-sans text-[0.88rem] leading-snug text-muted">
                    Holt watches your open pull requests and lets you know when a maintainer replies, asks for changes, approves, or merges.
                  </p>
                </div>
              </div>
              <button type="button" onClick={turnOn} disabled={busy} className="btn-primary mt-4 min-h-10 w-full bg-blue text-[0.86rem]">
                {busy ? "turning on…" : "turn on alerts"}
              </button>
              {failed && <p role="status" className="mt-3 text-[0.82rem] text-orange">{TURN_ON_FAILED}</p>}
            </div>
          )}

          {view === "ended" && (
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line px-4 py-3">
              <p className="font-sans text-[0.9rem]">Your alerts ended on {dayMonth(list.access.until)}.</p>
              <Link href="/pricing" onClick={close} className="text-link text-[0.82rem]">see plans</Link>
            </div>
          )}

          {live && list.items.length === 0 && (
            <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
              <CatFace mood="ready" className="text-[1.1rem] text-faint" />
              <p className="font-sans text-[0.92rem] text-muted">You&rsquo;re all caught up.</p>
              <p className="font-sans text-[0.8rem] text-faint">New replies on your pull requests will show up here.</p>
            </div>
          )}

          {list.items.length > 0 && (
            <ul className={`alerts-list ${live ? "" : "opacity-60"}`}>
              {list.items.map((a) => {
                const isUnread = live && !a.read_at;
                const to = alertLinks(a);
                return (
                  <li key={a.id} className="alert-row" style={{ "--rule": ALERT_RULE[a.kind] } as React.CSSProperties}>
                    <span className="alert-dot" data-on={isUnread || undefined} aria-hidden="true" />
                    <div className="min-w-0">
                      <a
                        href={to.pr}
                        onClick={() => void read(a.id)}
                        className={`block font-sans text-[0.9rem] leading-snug hover:underline ${isUnread ? "text-ink" : "text-muted"}`}
                      >
                        {isUnread && <span className="sr-only">Unread: </span>}
                        {a.text}
                      </a>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[0.76rem] text-faint">
                        <time dateTime={a.created_at}>{timeAgo(a.created_at)}</time>
                        <Link
                          href={to.report}
                          onClick={() => {
                            void read(a.id);
                            close();
                          }}
                          className="inline-flex min-h-8 items-center hover:text-blue hover:underline"
                        >
                          report
                        </Link>
                        {isUnread && (
                          <button type="button" onClick={() => void readOne(a.id)} className="min-h-8 hover:text-blue hover:underline">
                            mark read
                          </button>
                        )}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {live && (
            <div className="flex min-h-11 items-center justify-between gap-4 border-t border-line bg-panel-2 px-4 text-[0.8rem]">
              <span className="text-faint">{watchingLine(list.watching, list.access)}</span>
              <Link href={ALERT_SETTINGS} onClick={close} className="inline-flex min-h-11 items-center text-blue hover:underline">settings</Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
