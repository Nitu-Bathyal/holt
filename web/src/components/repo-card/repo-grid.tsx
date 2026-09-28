"use client";

import { useSearchParams } from "next/navigation";
import { createContext, Suspense, use, useEffect, useRef, useState } from "react";
import type { PullGroup } from "@/lib/home";
import { neighbours, type CardRepo } from "@/lib/repo-card";
import { savedSet, withSaved } from "@/lib/saved";
import { PullStack } from "../home/pull-stack";
import { RepoTile, Shelf, type Tile } from "../home/shelf";
import { SaveButton } from "../save-button";
import { RepoCard } from "./repo-card";
import { RepoFocus } from "./repo-focus";

type Common = {
  /** The report link's `days`, when the list was searched with another window than the default week. */
  days?: number;
  /** A slot per repo (by `owner/name`) for extra buttons, on the card and in the focus view. */
  actions?: Partial<Record<string, React.ReactNode>>;
  /** Where a topic in the focus view links to (a board URL; `topic=` is added). */
  topicBase?: string;
  /**
   * The repos this person saved (`savedNames`), fetched once for the page: a
   * save button then goes on every card and in the focus view. Null when
   * signed out (the button offers sign-in); leave it out for no save buttons.
   */
  saved?: string[] | null;
  /** Unsaved cards fade instead of staying as they were (the saved list). */
  fadeUnsaved?: boolean;
};

/** A themed row on the signed-in home: repo cards, a repo's pull requests, or tiles for a repo Holt has no card for. */
export type RepoRow = { title: string; more?: { href: string; label: string }; note?: string; items: (CardRepo | Tile | PullGroup)[] };

type Card = (r: CardRepo, list: number, i: number) => React.ReactNode;

// Saves and unsaves made in this tab. A list that mounts again (new search
// results, a page visited earlier) starts from what the server said then, so
// these win over it.
const changed = new Map<string, boolean>();

const PARAM = "focus";
const reportHref = (repo: string, days?: number) => `/${repo}${days && days !== 7 ? `?days=${days}` : ""}`;
const isCard = (x: RepoRow["items"][number]): x is CardRepo => "stats" in x;
const isPulls = (x: RepoRow["items"][number]): x is PullGroup => "pulls" in x;

function withFocus(repo: string | null): string {
  const u = new URL(window.location.href);
  if (repo) u.searchParams.set(PARAM, repo);
  else u.searchParams.delete(PARAM);
  return `${u.pathname}${u.search}${u.hash}`;
}

/** A grid of compact repo cards; `?focus=owner/name` opens one in a focus view (back closes it). */
export function RepoGrid({ repos, ...common }: Common & { repos: CardRepo[] }) {
  return (
    <FocusList
      {...common}
      lists={[repos]}
      layout={(card) => (
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {repos.map((r, i) => (
            <li key={r.repo} className="reveal min-w-0" style={{ ["--i" as string]: i }}>
              {card(r, 0, i)}
            </li>
          ))}
        </ol>
      )}
    />
  );
}

/** Themed rows that scroll sideways, with one focus view for all of them (prev and next stay in the row). */
export function RepoRows({ rows, ...common }: Common & { rows: RepoRow[] }) {
  const shown = rows.filter((r) => r.items.length > 0);
  return (
    <FocusList
      {...common}
      lists={shown.map((r) => r.items.filter(isCard))}
      layout={(card, save) => (
        <div className="space-y-8">
          {shown.map((row, n) => (
            <Shelf key={row.title} title={row.title} more={row.more} note={row.note}>
              {row.items.map((x, i) =>
                isCard(x) ? (
                  <li key={x.repo} className="w-[17.5rem] shrink-0 snap-start sm:w-[19rem]">
                    {card(x, n, i)}
                  </li>
                ) : isPulls(x) ? (
                  <PullStack key={x.repo} g={x} />
                ) : (
                  <RepoTile key={x.key} t={x} actions={save(x.repo)} />
                ),
              )}
            </Shelf>
          ))}
        </div>
      )}
    />
  );
}

type ListProps = Common & { lists: CardRepo[][]; layout: (card: Card, save: (repo: string) => React.ReactNode) => React.ReactNode };

/** Owns which repos are saved, so every button for a repo agrees, and lays the cards out around one focus view. */
function FocusList(props: ListProps) {
  const { saved, actions, fadeUnsaved } = props;
  const [set, setSet] = useState(() => [...changed].reduce((s, [repo, v]) => withSaved(s, repo, v), savedSet(saved ?? [])));
  const isSaved = (repo: string) => set.has(repo.toLowerCase());

  const save = (repo: string, compact = true) =>
    saved === undefined ? null : (
      <SaveButton repo={repo} saved={saved === null ? null : isSaved(repo)} onChange={(v) => {
        changed.set(repo.toLowerCase(), v);
        setSet((s) => withSaved(s, repo, v));
      }} compact={compact} />
    );
  const actionsFor = (repo: string, compact: boolean) => {
    const extra = actions?.[repo];
    const button = save(repo, compact);
    return extra && button ? <>{extra}{button}</> : extra ?? button;
  };
  const card: Card = (r, list) => (
    <ListCard r={r} list={list} report={reportHref(r.repo, props.days)} actions={actionsFor(r.repo, true)} faded={Boolean(fadeUnsaved && saved && !isSaved(r.repo))} />
  );
  const tileSave = (repo: string) => save(repo);

  return (
    <Suspense fallback={props.layout(card, tileSave)}>
      <Focusable {...props} card={card} save={tileSave} actionsFor={actionsFor} />
    </Suspense>
  );
}

// Opens a card in the focus view; absent until the address can be read (then cards are plain links).
const OpenFocus = createContext<((repo: string, list: number) => void) | null>(null);

function ListCard({ r, list, report, actions, faded }: { r: CardRepo; list: number; report: string; actions: React.ReactNode; faded: boolean }) {
  const open = use(OpenFocus);
  return (
    <div className={`h-full transition-opacity duration-300 ${faded ? "opacity-55 focus-within:opacity-100 hover:opacity-100" : ""}`}>
      <RepoCard r={r} report={report} focusHref={`?${PARAM}=${encodeURIComponent(r.repo)}`} onOpen={open ? () => open(r.repo, list) : undefined} actions={actions} />
    </div>
  );
}

function Focusable({ lists, layout, days, topicBase, card, save, actionsFor }: ListProps & {
  card: Card;
  save: (repo: string) => React.ReactNode;
  actionsFor: (repo: string, compact: boolean) => React.ReactNode;
}) {
  const focus = useSearchParams().get(PARAM);
  // The list the card was opened from (a repo can be in two rows); else the first that has it.
  const [from, setFrom] = useState<number | null>(null);
  const has = (list: CardRepo[] | undefined) => !!focus && !!list?.some((r) => r.repo.toLowerCase() === focus.toLowerCase());
  const repos = (from !== null && has(lists[from]) ? lists[from] : lists.find(has)) ?? [];
  const nb = neighbours(repos.map((r) => r.repo), focus);
  const current = nb ? repos[nb.index] : null;
  const dialog = useRef<HTMLDialogElement>(null);
  const pushed = useRef(false);
  const touch = useRef<{ x: number; y: number } | null>(null);

  const open = (repo: string, list: number) => {
    setFrom(list);
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
      <OpenFocus value={open}>{layout(card, save)}</OpenFocus>
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
              <RepoFocus key={current.repo} r={current} report={reportHref(current.repo, days)} actions={actionsFor(current.repo, false)} topicBase={topicBase} />
            </div>
            <p className="hidden border-t border-line px-6 py-2 text-[0.72rem] text-faint sm:block">← → to move between repos · Esc to close</p>
          </div>
        )}
      </dialog>
    </>
  );
}
