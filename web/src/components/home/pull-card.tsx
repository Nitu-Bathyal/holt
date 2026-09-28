// One repo's pull requests on the home, in the repo-card family: a stack
// when there's more than one, opening to list each PR.
import Link from "next/link";
import { RepoAvatar } from "@/components/repo-card/repo-avatar";
import { VerdictPill } from "@/components/report/verdict-pill";
import { STATE_LABEL } from "@/lib/contributions";
import { timeAgo } from "@/lib/format";
import { pullCountLine, type PullGroup } from "@/lib/home";

const STATE_STYLE = {
  merged: "text-green",
  open: "text-blue",
  closed: "text-muted",
} as const;

export function PullCard({ g }: { g: PullGroup }) {
  const [owner, name] = g.repo.split("/");
  const verdict = g.pulls.find((p) => p.verdict)?.verdict ?? null;
  const stacked = g.pulls.length > 1;
  return (
    <article
      className={`flex h-full flex-col border border-line-strong bg-panel p-4 shadow-soft ${
        stacked ? "[box-shadow:4px_4px_0_-1px_var(--panel),4px_4px_0_0_var(--line-strong)]" : ""
      }`}
    >
      <div className="flex items-start gap-3">
        <RepoAvatar repo={g.repo} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[1rem] font-semibold leading-tight tracking-tight">
            <Link href={`/${g.repo}`} className="hover:text-blue">
              <span className="text-muted">{owner}/</span>
              {name}
            </Link>
          </h3>
          <p className={`mt-0.5 text-[0.82rem] ${g.open ? "text-blue" : "text-faint"}`}>{pullCountLine(g)}</p>
        </div>
      </div>
      {verdict && <VerdictPill headline={verdict.headline} tone={verdict.tone} className="mt-3 self-start px-1.5 py-0.5 text-[0.76rem]" />}
      <details className="group mt-3 border-t border-line pt-2 text-[0.84rem]" open={g.pulls.length === 1 || undefined}>
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-muted hover:text-ink sm:min-h-8">
          {g.pulls.length === 1 ? "the pull request" : `all ${g.pulls.length}`}
          <span aria-hidden="true" className="transition-transform group-open:rotate-180">▾</span>
        </summary>
        <ul className="mt-1 space-y-2">
          {g.pulls.map((p) => (
            <li key={p.url} className="min-w-0">
              <a href={p.url} className="block truncate font-sans text-ink hover:underline">{p.title}</a>
              <span className="text-[0.78rem] text-faint">
                #{p.number} · <span className={STATE_STYLE[p.state]}>{STATE_LABEL[p.state]}</span> · opened {timeAgo(p.created_at)}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </article>
  );
}
