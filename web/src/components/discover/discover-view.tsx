import Link from "next/link";
import { discover, savedNames } from "@/lib/api";
import { boardHref, boardTitle, emptyText, SORTS, widenBoard } from "@/lib/discover";
import { fromDiscover, langColor } from "@/lib/repo-card";
import { currentUser } from "@/lib/session";
import type { DiscoverSort } from "@/lib/types";
import { ErrorPanel } from "../error-panel";
import { EmptyState } from "../shell/app-page";
import { PageTransition } from "../motion/page-transition";
import { FindFrame } from "../find/find-frame";
import { LangDot } from "../repo-card/repo-avatar";
import { RepoGrid } from "../repo-card/repo-grid";

/** /discover and /discover/<language>: Find a project's browse tab, one board as a grid of cards with its order and language chips on top. */
export async function DiscoverView({ sort, language, topic }: { sort: DiscoverSort; language: string | null; topic: string | null }) {
  const user = await currentUser();
  const [result, saved] = await Promise.all([discover(sort, language, topic), savedNames(user?.id)]);
  const here = boardHref({ sort, language, topic });
  const data = result.ok ? result.data : null;

  return (
    <PageTransition>
      <FindFrame tab="browse" title={boardTitle(sort, language)} signedIn={Boolean(user)}>
        <div className="find-tray">
          <nav aria-label="Order" className="py-3 sm:pb-3 sm:pt-4">
            <ul className="grid grid-cols-3 sm:inline-grid">
              {SORTS.map((s, i) => (
                <li key={s.id} className={i ? "-ml-px" : ""}>
                  <Link
                    href={boardHref({ sort: s.id, language, topic })}
                    scroll={false}
                    aria-current={s.id === sort ? "page" : undefined}
                    className={`relative flex min-h-11 items-center sm:min-h-9 justify-center border px-2 text-center text-[0.8rem] leading-tight transition-colors sm:px-4 sm:text-[0.82rem] ${s.id === sort ? "z-10 border-green bg-green font-semibold text-on-accent" : "border-line-strong text-muted hover:border-blue hover:text-ink"}`}
                  >
                    {s.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          {data && data.languages.length > 0 && (
            <nav aria-label="Language" className="border-t border-line">
              <ul className="flex gap-2 overflow-x-auto py-3 [scrollbar-width:none] sm:flex-wrap sm:overflow-visible sm:py-4">
                <li className="shrink-0">
                  <Link href={boardHref({ sort, topic })} scroll={false} aria-current={!language ? "page" : undefined}
                    className={`inline-flex min-h-11 items-center sm:min-h-9 whitespace-nowrap border px-3.5 text-[0.82rem] transition-colors ${!language ? "border-blue bg-blue text-on-accent" : "border-line-strong text-muted hover:border-blue hover:text-ink"}`}>
                    Any language
                  </Link>
                </li>
                {data.languages.map((l) => {
                  const on = l.name.toLowerCase() === language?.toLowerCase();
                  return (
                    <li key={l.name} className="shrink-0">
                      <Link href={boardHref({ sort, language: l.name, topic })} scroll={false} aria-current={on ? "page" : undefined}
                        className={`inline-flex min-h-11 items-center sm:min-h-9 gap-2 whitespace-nowrap border px-3.5 text-[0.82rem] transition-colors ${on ? "border-blue bg-blue text-on-accent" : "border-line-strong text-muted hover:border-blue hover:text-ink"}`}>
                        <LangDot color={langColor(l.name)} />
                        {l.name}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>
          )}
        </div>
        <div className="mb-4 mt-5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[0.8rem] text-faint">
          {data && data.repos.length > 0 && <p>{data.repos.length} repo{data.repos.length === 1 ? "" : "s"}, {sort === "welcoming" ? "most welcoming first" : sort === "stars" ? "biggest first" : "most checked first"}</p>}
          {topic && (
            <p>
              Only repos tagged <strong className="font-semibold text-ink">{topic}</strong>.{" "}
              <Link href={boardHref({ sort, language })} className="text-link">Show all topics</Link>
            </p>
          )}
        </div>
        <section aria-label={boardTitle(sort, language)}>
          {!result.ok ? (
            <ErrorPanel error={result.error} retryHref={here} />
          ) : data!.repos.length ? (
            <RepoGrid repos={data!.repos.map(fromDiscover)} topicBase={boardHref({ sort, language })} saved={saved} />
          ) : (
            <EmptyState title={emptyText(sort, language, topic, data!.trending_min)}>
              {widenBoard({ sort, language, topic }).map((w, i) => (
                <Link key={w.href} href={w.href} className={i ? "text-link text-[0.9rem]" : "btn-primary"}>{i ? w.label : `${w.label} →`}</Link>
              ))}
            </EmptyState>
          )}
        </section>
      </FindFrame>
    </PageTransition>
  );
}
