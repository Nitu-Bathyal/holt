"use client";

import Link from "next/link";
import { useState } from "react";
import { compact } from "@/lib/discover";
import { langColor, statPills, type CardRepo } from "@/lib/repo-card";
import { VerdictPill } from "../report/verdict-pill";
import { OddsBar } from "./odds-bar";
import { LangDot, RepoAvatar } from "./repo-avatar";

/**
 * A repo in a list, about a third of the old height: who, the verdict, the
 * labelled odds bar, two more numbers and one issue to start with. Everything else is in
 * the focus view (`focusHref`), which `onOpen` shows without a page load.
 */
export function RepoCard({ r, report, focusHref, onOpen, actions }: { r: CardRepo; report: string; focusHref: string; onOpen?: () => void; actions?: React.ReactNode }) {
  const [owner, name] = r.repo.split("/");
  const issue = r.issues[0];
  // A name too long for the card shows in full over itself while pointed at or focused.
  const [fullName, setFullName] = useState(false);
  const showFull = (e: React.SyntheticEvent<HTMLAnchorElement>) => setFullName(e.currentTarget.scrollWidth > e.currentTarget.clientWidth);
  // The first number ("3 of 8 merged") labels the bar; the others sit under it as plain text, not tags.
  const pills = statPills(r.stats);
  const merged = r.stats.attempts && r.stats.merged != null ? pills[0] : null;
  const rest = merged ? pills.slice(1) : pills;
  // A plain link without JS or with a modifier key; the in-page view otherwise.
  const open = onOpen && ((e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    onOpen();
  });
  return (
    <article className="app-card flex h-full flex-col border border-line-strong bg-panel p-4 shadow-soft hover:border-blue/60">
      <div className="flex items-start gap-3">
        <RepoAvatar repo={r.repo} />
        <div className="min-w-0 flex-1">
          <h2 className="relative text-[1rem] font-semibold leading-tight tracking-tight">
            <a
              href={focusHref}
              onClick={open}
              onMouseEnter={showFull}
              onFocus={showFull}
              onMouseLeave={() => setFullName(false)}
              onBlur={() => setFullName(false)}
              className="-my-3.5 block truncate py-3.5 hover:text-blue"
            >
              <span className="text-muted">{owner}/</span>
              {name}
            </a>
            {fullName && (
              <span aria-hidden="true" className="pointer-events-none absolute -inset-x-[9px] -top-[7px] z-20 border border-blue/60 bg-panel px-2 py-1.5 text-blue shadow-card [overflow-wrap:anywhere]">
                <span className="text-muted">{owner}/</span>
                <wbr />
                {name}
              </span>
            )}
          </h2>
          {r.description && <p className="mt-0.5 line-clamp-2 font-sans text-[0.88rem] leading-snug text-muted" title={r.description}>{r.description}</p>}
        </div>
        {actions && <div className="-mt-0.5 flex shrink-0 items-start gap-2">{actions}</div>}
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <VerdictPill headline={r.headline} tone={r.tone} className="shrink-0 px-1.5 py-0.5 text-[0.76rem]" />
        <span className="flex min-w-0 items-center gap-3 text-[0.8rem] text-faint">
          {r.language && r.languageLabel && (
            <span className="flex min-w-0 items-center gap-1.5" title={r.languageLabel}>
              <LangDot color={langColor(r.language)} />
              <span className="truncate">{r.languageLabel}</span>
            </span>
          )}
          {r.stars != null && <span className="shrink-0 whitespace-nowrap tabular-nums">★ {compact(r.stars)}<span className="sr-only"> stars</span></span>}
        </span>
      </div>
      <div className="mt-3.5 flex items-baseline justify-between gap-3 text-[0.78rem]">
        <span className="text-faint">Pull requests from outsiders</span>
        {merged ? <span className="shrink-0 font-semibold text-green tabular-nums">{merged}</span> : <span className="shrink-0 text-faint">none yet</span>}
      </div>
      <OddsBar stats={r.stats} className="mt-1.5 h-1.5" />
      {rest.length > 0 && (
        <p className="mt-2 flex flex-wrap gap-x-1.5 text-[0.78rem] text-muted">
          {rest.map((p, i) => (
            <span key={p}>{i > 0 && <span aria-hidden="true" className="mr-1.5 text-faint">·</span>}{p}</span>
          ))}
        </p>
      )}

      {issue ? (
        <p className="relative mt-3 border-t border-dashed border-line pt-2.5 font-sans text-[0.88rem] leading-snug">
          <span className="block font-sans text-[0.78rem] text-faint">An issue to start with</span>
          <a href={issue.url} target="_blank" rel="noopener noreferrer" data-umami-event="starter-issue-click" className="mt-0.5 line-clamp-2 font-semibold text-ink after:absolute after:inset-0 hover:text-blue">
            <span className="font-mono text-[0.85rem] font-normal text-blue">#{issue.number}</span> {issue.title}
            <span className="sr-only"> (opens GitHub)</span>
          </a>
          {issue.on_it && (
            <span className={`mt-0.5 block text-[0.8rem] ${issue.people || issue.open_prs ? "text-amber" : "text-muted"}`}>{issue.on_it}</span>
          )}
        </p>
      ) : r.reason ? (
        <p className="mt-3 line-clamp-2 border-t border-dashed border-line pt-2.5 font-sans text-[0.88rem] leading-snug text-muted">{r.reason}</p>
      ) : null}

      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 pt-3 text-[0.85rem]">
        <a
          href={focusHref}
          onClick={open}
          className="-my-3 py-3 text-green hover:underline"
          aria-label={`Quick look at ${r.repo}`}
        >
          quick look
        </a>
        <Link href={report} className="-my-3 py-3 text-muted hover:text-ink">full report →</Link>
      </div>
    </article>
  );
}
