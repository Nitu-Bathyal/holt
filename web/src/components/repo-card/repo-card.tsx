import Link from "next/link";
import { compact } from "@/lib/discover";
import { langColor, statPills, type CardRepo } from "@/lib/repo-card";
import { VerdictPill } from "../report/verdict-pill";
import { OddsBar } from "./odds-bar";
import { LangDot, RepoAvatar } from "./repo-avatar";

/**
 * A repo in a list, about a third of the old height: who, the verdict, the
 * odds bar, three numbers and one issue to start with. Everything else is in
 * the focus view (`focusHref`), which `onOpen` shows without a page load.
 */
export function RepoCard({ r, report, focusHref, onOpen, actions }: { r: CardRepo; report: string; focusHref: string; onOpen?: () => void; actions?: React.ReactNode }) {
  const [owner, name] = r.repo.split("/");
  const issue = r.issues[0];
  // A plain link without JS or with a modifier key; the in-page view otherwise.
  const open = onOpen && ((e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    onOpen();
  });
  return (
    <article className="flex h-full flex-col border border-line-strong bg-panel p-4 shadow-soft transition-colors hover:border-blue/60">
      <div className="flex items-start gap-3">
        <RepoAvatar repo={r.repo} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[1rem] font-semibold leading-tight tracking-tight">
            <a
              href={focusHref}
              onClick={open}
              className="hover:text-blue"
            >
              <span className="text-muted">{owner}/</span>
              {name}
            </a>
          </h2>
          {r.description && <p className="mt-0.5 truncate font-sans text-[0.875rem] text-muted">{r.description}</p>}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <VerdictPill headline={r.headline} tone={r.tone} className="shrink-0 px-1.5 py-0.5 text-[0.8125rem]" />
        <span className="flex min-w-0 items-center gap-1.5 truncate text-[0.8125rem] text-faint">
          {r.language && (
            <>
              <LangDot color={langColor(r.language)} />
              {r.language}
            </>
          )}
          {r.stars != null && <span className="ml-2">★ {compact(r.stars)}<span className="sr-only"> stars</span></span>}
        </span>
      </div>
      <OddsBar stats={r.stats} className="mt-3 h-1.5" />
      <ul className="mt-2.5 flex flex-wrap gap-1.5 text-[0.8125rem]">
        {statPills(r.stats).map((p, i) => (
          <li key={p} className={`border px-1.5 py-0.5 ${i === 0 ? "border-green/40 text-green" : "border-line text-muted"}`}>{p}</li>
        ))}
      </ul>

      {issue ? (
        <p className="mt-3 border-t border-dashed border-line pt-2.5 font-sans text-[0.875rem] leading-snug">
          <span className="font-mono text-[0.8125rem] text-faint">start with </span>
          <a href={issue.url} target="_blank" rel="noopener noreferrer" data-umami-event="starter-issue-click" className="line-clamp-1 font-semibold text-ink hover:text-blue">
            <span className="font-mono text-[0.875rem] font-normal text-blue">#{issue.number}</span> {issue.title}
            <span className="sr-only"> (opens GitHub)</span>
          </a>
        </p>
      ) : r.reason ? (
        <p className="mt-3 line-clamp-2 border-t border-dashed border-line pt-2.5 font-sans text-[0.875rem] leading-snug text-muted">{r.reason}</p>
      ) : null}

      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 pt-3 text-[0.875rem]">
        <a
          href={focusHref}
          onClick={open}
          className="text-green hover:underline"
          aria-label={`More about ${r.repo}`}
        >
          More
        </a>
        <Link href={report} className="text-muted hover:text-ink">report →</Link>
        {actions && <span className="ml-auto">{actions}</span>}
      </div>
    </article>
  );
}
