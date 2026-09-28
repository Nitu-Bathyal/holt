"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";
import { neighbours, type CardRepo } from "@/lib/repo-card";
import { RepoCard } from "./repo-card";
import { RepoFocus } from "./repo-focus";

type Props = {
  repos: CardRepo[];
  /** The report link's `days`, when the list was searched with another window than the default week. */
  days?: number;
  /** A slot per repo (by `owner/name`) for buttons such as Save, on the card and in the focus view. */
  actions?: Partial<Record<string, React.ReactNode>>;
  /** Where a topic in the focus view links to (a board URL; `topic=` is added). */
  topicBase?: string;
};

const PARAM = "focus";
const reportHref = (repo: string, days?: number) => `/${repo}${days && days !== 7 ? `?days=${days}` : ""}`;

function withFocus(repo: string | null): string {
  const u = new URL(window.location.href);
  if (repo) u.searchParams.set(PARAM, repo);
  else u.searchParams.delete(PARAM);
  return `${u.pathname}${u.search}${u.hash}`;
}

/** A grid of compact repo cards; `?focus=owner/name` opens one in a focus view (back closes it). */
export function RepoGrid(props: Props) {
  return (
    <Suspense fallback={<Cards {...props} />}>
      <Focusable {...props} />
    </Suspense>
  );
}

function Cards({ repos, days, actions, onOpen }: Props & { onOpen?: (repo: string) => void }) {
  return (
    <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {repos.map((r, i) => (
        <li key={r.repo} className="reveal min-w-0" style={{ ["--i" as string]: i }}>
          <RepoCard r={r} report={reportHref(r.repo, days)} focusHref={`?${PARAM}=${encodeURIComponent(r.repo)}`} onOpen={onOpen && (() => onOpen(r.repo))} actions={actions?.[r.repo]} />
        </li>
      ))}
    </ol>
  );
}

function Focusable(props: Props) {
  const { repos, days, actions, topicBase } = props;
  const focus = useSearchParams().get(PARAM);
  const nb = neighbours(repos.map((r) => r.repo), focus);
  const current = nb ? repos[nb.index] : null;
  const dialog = useRef<HTMLDialogElement>(null);
  const pushed = useRef(false);
  const touch = useRef<{ x: number; y: number } | null>(null);

  const open = (repo: string) => {
    pushed.current = true;
    window.history.pushState(null, "", withFocus(repo));
  };
  const go = (repo: string | null) => repo && window.history.replaceState(null, "", withFocus(repo));
  const close = () => {
    if (pushed.current) {
      pushed.current = false;
      window.history.back();
    } else {
      window.history.replaceState(null, "", withFocus(null));
    }
  };

  // The URL is the source of truth: back and forward open and close the view.
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (current && !d.open) d.showModal();
    if (!current && d.open) d.close();
    document.documentElement.style.overflow = current ? "hidden" : "";
    return () => {
      document.documentElement.style.overflow = "";
    };
  }, [current]);
  // Moving to another repo starts at its top.
  useEffect(() => {
    dialog.current?.querySelector("[data-scroll]")?.scrollTo({ top: 0 });
  }, [current?.repo]);

  return (
    <>
      <Cards {...props} onOpen={open} />
      <dialog
        ref={dialog}
        aria-labelledby="focus-title"
        onClose={() => {
          if (new URLSearchParams(window.location.search).has(PARAM)) close();
        }}
        onClick={(e) => e.target === e.currentTarget && close()}
        onKeyDown={(e) => {
          if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
          if (e.key === "ArrowLeft" && nb?.prev) go(nb.prev);
          if (e.key === "ArrowRight" && nb?.next) go(nb.next);
        }}
        onTouchStart={(e) => {
          touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        }}
        onTouchEnd={(e) => {
          const t = touch.current;
          touch.current = null;
          if (!t || !nb) return;
          const dx = e.changedTouches[0].clientX - t.x;
          const dy = e.changedTouches[0].clientY - t.y;
          if (Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy)) go(dx < 0 ? nb.next : nb.prev);
        }}
        className="bg-bg text-ink backdrop:bg-black/60 backdrop:backdrop-blur-[2px] max-sm:m-0 max-sm:h-dvh max-sm:max-h-none max-sm:w-full max-sm:max-w-none sm:m-auto sm:max-h-[90vh] sm:w-[min(48rem,calc(100%-3rem))] sm:border sm:border-line-strong sm:shadow-soft"
      >
        {current && nb && (
          <div className="flex h-full flex-col sm:h-auto sm:max-h-[90vh]">
            <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5 text-[0.78rem] text-muted sm:px-6">
              <span className="tabular-nums">{nb.index + 1} of {repos.length}</span>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => go(nb.prev)} disabled={!nb.prev} aria-label="Previous repo" className="grid size-10 place-items-center hover:text-ink disabled:opacity-30">←</button>
                <button type="button" onClick={() => go(nb.next)} disabled={!nb.next} aria-label="Next repo" className="grid size-10 place-items-center hover:text-ink disabled:opacity-30">→</button>
                <button type="button" onClick={close} aria-label="Close" className="ml-2 grid size-10 place-items-center text-[1.1rem] hover:text-ink">✕</button>
              </div>
            </div>
            <div data-scroll className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:flex-initial sm:p-6">
              <RepoFocus key={current.repo} r={current} report={reportHref(current.repo, days)} actions={actions?.[current.repo]} topicBase={topicBase} />
            </div>
            <p className="hidden border-t border-line px-6 py-2 text-[0.72rem] text-faint sm:block">← → to move between repos · Esc to close</p>
          </div>
        )}
      </dialog>
    </>
  );
}
