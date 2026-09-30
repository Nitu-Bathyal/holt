// In a report's header, under the repo name: what the project is (one line),
// how big and alive it is (one row, stars first) and, on a line of its own, the
// licence, start year, branch, website and GitHub link. Every topic is listed
// in the About section further down.
// Public data from GitHub (the server's `about`): every visitor sees it.
import { timeAgo } from "@/lib/format";
import { aboutNumbers, flags, readmeShown, siteLabel, type RepoAbout as About } from "@/lib/repo-about";

const TOPICS_IN_ROW = 3;

/** One colour per kind of fact in the details line, so each reads at a glance. */
const FACT_TONE: Record<string, string> = {
  licence: "text-green",
  since: "text-amber",
  branch: "text-orange",
};

function Icon({ d, className = "" }: { d: string; className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className={`size-3.5 shrink-0 fill-current ${className}`}>
      <path d={d} />
    </svg>
  );
}

// Octicon-style glyphs (16px grid).
const STAR = "M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.75.75 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z";
const FORK = "M5 5.372v.878c0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75v-.878a2.25 2.25 0 1 1 1.5 0v.878a2.25 2.25 0 0 1-2.25 2.25h-1.5v2.128a2.251 2.251 0 1 1-1.5 0V8.5h-1.5A2.25 2.25 0 0 1 3.5 6.25v-.878a2.25 2.25 0 1 1 1.5 0ZM5 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Zm6.75.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm-3 8.75a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Z";
const ISSUE = "M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z";
const CLOCK = "M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm7-3.25v2.992l2.028.812a.75.75 0 0 1-.557 1.392l-2.5-1A.751.751 0 0 1 7 8.25v-3.5a.75.75 0 0 1 1.5 0Z";

/** The name column of the report header: name (and, on wider screens, the
 * description beside it), then the numbers. */
export function RepoAbout({ about, repo }: { about: About; repo: string }) {
  const readme = readmeShown(about);
  const [stars, ...counts] = aboutNumbers(about);
  const marks = flags(about);
  const since = about.created_at ? new Date(about.created_at).getUTCFullYear() : null;
  const facts = [
    about.license && ["licence", about.license],
    since && ["since", String(since)],
    about.default_branch && ["branch", about.default_branch],
  ].filter(Boolean) as [string, string][];
  const line = about.description ?? readme;
  const [owner, name] = repo.split("/");
  return (
    <div className="relative min-w-0" data-repo-about>
      <p className="flex min-w-0 items-baseline gap-x-3">
        <span className="shrink-0 text-[1.05rem] font-semibold tracking-tight [overflow-wrap:anywhere] sm:text-[1.25rem]">
          <span className="text-muted">{owner}/</span>
          {name}
        </span>
        {line && (
          <span className="hidden min-w-0 truncate font-sans text-[0.9rem] text-muted sm:block" title={line}>
            {line}
          </span>
        )}
      </p>
      {line && (
        <p className="truncate font-sans text-[0.88rem] text-muted sm:hidden" title={line}>
          {line}
        </p>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.82rem] sm:gap-x-4 text-muted lg:flex-nowrap">
        {marks.map((f) =>
          f.repo ? (
            <a key={f.kind} href={`/${f.repo}`} className="shrink-0 whitespace-nowrap border border-line-strong px-1.5 text-[0.76rem] text-ink hover:text-blue">
              {f.text}
            </a>
          ) : (
            <span key={f.kind} className="shrink-0 border border-amber/60 px-1.5 text-[0.76rem] text-amber">
              {f.text}
            </span>
          ),
        )}
        {stars && (
          <span className="inline-flex shrink-0 items-center gap-1 text-[1rem] font-semibold text-ink" title={`${about.stars} ${stars.label} on GitHub`}>
            <Icon d={STAR} className="size-4 text-amber" />
            {stars.value}
            <span className="sr-only"> {stars.label}</span>
          </span>
        )}
        {counts.map((n) => (
          <span key={n.label} className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap">
            <Icon d={n.label.startsWith("fork") ? FORK : ISSUE} className="text-faint" />
            <span className="font-semibold text-ink">{n.value}</span>
            <span className="sr-only sm:not-sr-only">{n.label.replace("open ", "")}</span>
          </span>
        ))}
        {about.pushed_at && (
          <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap">
            <Icon d={CLOCK} className="text-faint" />
            <span className="sr-only sm:not-sr-only">pushed</span> <time dateTime={about.pushed_at} suppressHydrationWarning>{timeAgo(about.pushed_at)}</time>
          </span>
        )}
        {about.topics.length > 0 && (
          // One line of chips: any that don't fit wrap out of sight (the About section lists them all).
          <span className="hidden h-5 min-w-0 flex-1 flex-wrap gap-1.5 overflow-hidden lg:flex">
            {about.topics.slice(0, TOPICS_IN_ROW).map((t) => (
              <span key={t} className="whitespace-nowrap border border-blue/30 bg-blue/5 px-1.5 text-[0.76rem] leading-[1.15rem] text-blue">
                {t}
              </span>
            ))}
          </span>
        )}
      </div>
      <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-0.5 font-mono text-[0.8rem]" data-repo-details>
        {facts.map(([k, v]) => (
          <span key={k}>
            <span className="text-faint">{k}</span> <span className={FACT_TONE[k]}>{v}</span>
          </span>
        ))}
        {about.homepage && (
          <a href={about.homepage} target="_blank" rel="noopener noreferrer nofollow" className="max-w-full truncate text-blue/80 hover:text-blue">
            {siteLabel(about.homepage)} ↗
          </a>
        )}
        <a href={`https://github.com/${repo}`} target="_blank" rel="noopener noreferrer" className="text-blue/80 hover:text-blue">
          github.com/{repo} ↗
        </a>
      </p>
    </div>
  );
}
