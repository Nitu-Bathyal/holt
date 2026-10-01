// The report's sidebar cards: the project's numbers as label/value rows, the
// languages, the topics, and where to read the rules and ask for help. GitHub's
// own facts (the server's `about`, API.md); nothing here feeds the verdict, and
// a fact GitHub didn't give is left out, not guessed.
import { Calendar, CircleDot, Clock, GitBranch, GitFork, GitPullRequest, Scale, Star, Tag, Users } from "lucide-react";
import { shortDate, timeAgo } from "@/lib/format";
import { compactCount, docLinks, share, type RepoAbout } from "@/lib/repo-about";
import { langColor } from "@/lib/repo-card";
import { Tip } from "../ui/tip";

const TOPICS_SHOWN = 12;

const ICON = { star: Star, fork: GitFork, people: Users, issue: CircleDot, pr: GitPullRequest, clock: Clock, calendar: Calendar, scale: Scale, branch: GitBranch, tag: Tag } as const;

type Row = { icon: keyof typeof ICON; label: string; value?: string; since?: string; href?: string };

/** What each row means, for a first-time contributor. Shown on hover or focus. */
const HELP: Record<string, string> = {
  Stars: "People who bookmarked the repo on GitHub. A rough sign of how well known it is.",
  Forks: "Copies of the repo that people made, usually to propose changes.",
  Contributors: "People who have had code accepted here.",
  "Open issues": "Problems and requests still waiting to be handled.",
  "Open PRs": "Proposed changes waiting for a maintainer to review them.",
  "Last push": "When code was last added. Recent is a good sign.",
  Created: "When the repository was made.",
  Licence: "What you are allowed to do with the code.",
  "Default branch": "The main line of code that changes are merged into.",
  "Latest release": "The newest published version.",
};

function Icon({ name }: { name: keyof typeof ICON }) {
  const I = ICON[name];
  return <I aria-hidden="true" strokeWidth={1.5} className="size-4 shrink-0 text-faint" />;
}

function Card({ title, children, ...rest }: { title: string; children: React.ReactNode } & React.HTMLAttributes<HTMLElement>) {
  return (
    <section {...rest} className="border border-line-strong bg-panel p-4">
      <h2 className="mb-3 text-[0.76rem] uppercase tracking-[0.08em] text-faint">{title}</h2>
      {children}
    </section>
  );
}

function rows(a: RepoAbout): Row[] {
  const count = (icon: keyof typeof ICON, label: string, n: number | null | undefined): Row | null => (n == null ? null : { icon, label, value: compactCount(n) });
  return [
    count("star", "Stars", a.stars),
    count("fork", "Forks", a.forks),
    count("people", "Contributors", a.contributors),
    count("issue", "Open issues", a.open_issues),
    count("pr", "Open PRs", a.open_pull_requests),
    a.created_at ? { icon: "calendar", label: "Created", value: shortDate(a.created_at) } : null,
    a.license ? { icon: "scale", label: "Licence", value: a.license } : null,
    a.default_branch ? { icon: "branch", label: "Default branch", value: a.default_branch } : null,
  ].filter((r): r is Row => r !== null && r.value !== "");
}

/** All the sidebar cards for one project. Renders nothing if GitHub gave us nothing. */
/**
 * The rules, where to ask, the last push and the latest release are under
 * "Contributing here" (project-section.tsx), so they aren't repeated here.
 * `afterStats` goes right under Statistics: the merge plan card, high enough
 * to be seen. `noPeople` leaves out Top contributors (a report with nothing to start on).
 * `links` adds "Docs and links" under the languages: everything to read before starting, in one place.
 */
export function ProjectSidebar({ about, repo, afterStats, noPeople, links }: { about: RepoAbout; repo: string; afterStats?: React.ReactNode; noPeople?: boolean; links?: boolean }) {
  const stats = rows(about);
  const langs = about.languages;
  const topics = about.topics.slice(0, TOPICS_SHOWN);
  const people = noPeople ? [] : (about.top_contributors ?? []);
  const docs = links ? docLinks(about, repo) : [];
  if (!stats.length && !langs.length && !topics.length && !people.length && !docs.length && !afterStats) return null;

  return (
    <div className="space-y-4" data-project>
      {stats.length > 0 && (
        <Card title="Statistics" data-project-facts>
          <dl className="space-y-1.5 text-[0.82rem]">
            {stats.map((r) => (
              <Tip key={r.label} text={HELP[r.label] ?? r.label} className="flex min-h-6 cursor-default items-center gap-2 outline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue">
                <Icon name={r.icon} />
                <dt className="text-muted">{r.label}</dt>
                <dd className="ml-auto min-w-0 truncate text-right tabular-nums text-ink">
                  {r.href ? (
                    <a href={r.href} target="_blank" rel="noopener noreferrer" className="hover:text-blue">
                      {r.value}
                      <span className="sr-only"> (opens GitHub)</span>
                    </a>
                  ) : (
                    r.value
                  )}
                  {r.since && (
                    <time dateTime={r.since} suppressHydrationWarning>
                      {timeAgo(r.since)}
                    </time>
                  )}
                </dd>
              </Tip>
            ))}
          </dl>
        </Card>
      )}

      {afterStats}

      {langs.length > 0 && (
        <Card title="What you'd need to know" data-project-languages>
          {/* One rounded bar cut into each language's share, then a key with a dot and its share. */}
          <div role="img" aria-label={langs.map((l) => `${l.name} ${share(l.share)}`).join(", ")} className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-line/60">
            {langs.map((l) => (
              <span key={l.name} className="min-w-1.5" style={{ flexGrow: Math.max(l.share, 0.02), flexBasis: 0, background: langColor(l.name) ?? "var(--color-faint, #8b8b8b)" }} />
            ))}
          </div>
          <ul className="mt-3 flex flex-wrap gap-1.5 font-sans text-[0.78rem]">
            {langs.map((l) => (
              <li key={l.name} className="inline-flex items-center gap-1.5 border border-line-strong bg-panel-2/60 px-2 py-0.5">
                <span aria-hidden="true" className="size-2 rounded-full" style={{ background: langColor(l.name) ?? "var(--color-faint, #8b8b8b)" }} />
                <span className="font-medium text-ink">{l.name}</span>
                <span className="tabular-nums text-faint">{share(l.share)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {docs.length > 0 && (
        <Card title="Docs and links" data-project-links>
          <ul className="space-y-1.5 text-[0.82rem]">
            {docs.map((l) => (
              <li key={l.url}>
                <a href={l.url} target="_blank" rel="noopener noreferrer nofollow" title={l.note} className="flex min-h-8 items-center justify-between gap-2 text-ink hover:text-blue">
                  <span className="min-w-0 truncate">{l.label}</span>
                  <span aria-hidden="true" className="text-faint">↗</span>
                  <span className="sr-only"> ({l.note}; opens in a new tab)</span>
                </a>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {topics.length > 0 && (
        <Card title="Topics">
          <ul aria-label="Topics" className="flex flex-wrap gap-1.5 text-[0.78rem]">
            {topics.map((t) => (
              <li key={t} className="border border-blue/30 bg-blue/5 px-2 py-0.5 text-blue">
                {t}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {people.length > 0 && (
        <Card title="Top contributors" data-project-people>
          {/* GitHub's own list and order (most commits first): Holt doesn't rank people. */}
          <ul className="space-y-1.5 text-[0.82rem]">
            {people.map((p) => (
              <li key={p.login}>
                <a href={p.url} target="_blank" rel="noopener noreferrer nofollow" className="group flex min-h-8 items-center gap-2.5">
                  {p.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`${p.avatar_url}${p.avatar_url.includes("?") ? "&" : "?"}s=48`} alt="" width={24} height={24} loading="lazy" decoding="async" className="size-6 shrink-0 border border-line-strong bg-panel-2" />
                  ) : (
                    <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center border border-line-strong bg-panel-2 text-[0.72rem] uppercase text-faint">
                      {(p.name || p.login)[0]}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate">
                    <span className="text-ink group-hover:text-blue">{p.name || p.login}</span>
                    {p.name && <span className="ml-1.5 text-faint">{p.login}</span>}
                  </span>
                  {p.contributions != null && (
                    <span className="shrink-0 tabular-nums text-faint">
                      {compactCount(p.contributions)}
                      <span className="sr-only"> commits</span>
                    </span>
                  )}
                  <span className="sr-only"> (GitHub profile, opens in a new tab)</span>
                </a>
              </li>
            ))}
          </ul>
          {about.contributors != null && about.contributors > people.length && (
            <a href={`https://github.com/${repo}/graphs/contributors`} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-[0.78rem] text-muted hover:text-blue">
              all {compactCount(about.contributors)} on GitHub <span aria-hidden="true">↗</span>
            </a>
          )}
        </Card>
      )}
    </div>
  );
}
