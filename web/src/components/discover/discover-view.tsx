import Link from "next/link";
import { discover } from "@/lib/api";
import { boardHref, boardIntro, boardTitle, emptyText, SORTS } from "@/lib/discover";
import { fromDiscover, langColor } from "@/lib/repo-card";
import type { DiscoverSort } from "@/lib/types";
import { CatFace } from "../cat-face";
import { ErrorPanel } from "../error-panel";
import { PageTransition } from "../motion/page-transition";
import { PageHead } from "../page-head";
import { LangDot } from "../repo-card/repo-avatar";
import { RepoGrid } from "../repo-card/repo-grid";

/** /discover and /discover/<language>: one board as a grid of cards, with its order and language chips on top. */
export async function DiscoverView({ sort, language, topic }: { sort: DiscoverSort; language: string | null; topic: string | null }) {
  const result = await discover(sort, language, topic);
  const here = boardHref({ sort, language, topic });
  const data = result.ok ? result.data : null;

  return (
    <PageTransition>
      <>
        <PageHead compact>
          <h1 className="text-[clamp(1.45rem,3.4vw,2.1rem)] font-semibold leading-tight tracking-tight">{boardTitle(sort, language)}</h1>
          <p className="mt-2 hidden max-w-2xl font-sans text-[0.95rem] text-muted sm:block">{boardIntro(sort, data?.trending_min ?? 5)}</p>
        </PageHead>

        <div className="wrap py-5 sm:py-6">
          <div className="border border-line-strong bg-panel shadow-soft">
            <nav aria-label="Order" className="p-3 sm:p-4 sm:pb-3">
              <ul className="grid grid-cols-3 sm:inline-grid">
                {SORTS.map((s, i) => (
                  <li key={s.id} className={i ? "-ml-px" : ""}>
                    <Link
                      href={boardHref({ sort: s.id, language, topic })}
                      scroll={false}
                      aria-current={s.id === sort ? "page" : undefined}
                      className={`relative flex min-h-10 items-center justify-center border px-2 text-center text-[0.76rem] leading-tight transition-colors sm:px-4 sm:text-[0.82rem] ${s.id === sort ? "z-10 border-green bg-green/10 text-green" : "border-line-strong text-muted hover:border-blue hover:text-ink"}`}
                    >
                      {s.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
            {data && data.languages.length > 0 && (
              <nav aria-label="Language" className="border-t border-line">
                <ul className="flex gap-2 overflow-x-auto p-3 [scrollbar-width:none] sm:flex-wrap sm:overflow-visible sm:p-4">
                  <li className="shrink-0">
                    <Link href={boardHref({ sort, topic })} scroll={false} aria-current={!language ? "page" : undefined}
                      className={`inline-flex min-h-10 items-center whitespace-nowrap border px-3.5 text-[0.82rem] transition-colors ${!language ? "border-blue bg-blue text-on-accent" : "border-line-strong text-muted hover:border-blue hover:text-ink"}`}>
                      Any language
                    </Link>
                  </li>
                  {data.languages.map((l) => {
                    const on = l.name.toLowerCase() === language?.toLowerCase();
                    return (
                      <li key={l.name} className="shrink-0">
                        <Link href={boardHref({ sort, language: l.name, topic })} scroll={false} aria-current={on ? "page" : undefined}
                          className={`inline-flex min-h-10 items-center gap-2 whitespace-nowrap border px-3.5 text-[0.82rem] transition-colors ${on ? "border-blue bg-blue text-on-accent" : "border-line-strong text-muted hover:border-blue hover:text-ink"}`}>
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
              <RepoGrid repos={data!.repos.map(fromDiscover)} topicBase={boardHref({ sort, language })} />
            ) : (
              <div className="border border-dashed border-line-strong p-8 text-center">
                <CatFace mood="thinking" className="text-[1.6rem]" />
                <p className="mt-4 text-[1.05rem] font-semibold">{emptyText(sort, language, topic, data!.trending_min)}</p>
                <p className="mt-2 font-sans text-muted">Widen the board, or check a repo you have in mind: it shows up here once Holt has a verdict.</p>
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                  {topic && <Link href={boardHref({ sort, language })} className="btn-ghost">Show all topics</Link>}
                  {language && <Link href={boardHref({ sort, topic })} className="btn-ghost">Any language</Link>}
                  {sort !== "welcoming" && <Link href={boardHref({ language, topic })} className="btn-ghost">Most welcoming</Link>}
                  <Link href="/" className="btn-ghost">Check a repo</Link>
                </div>
              </div>
            )}
          </section>
          <p className="mt-8 max-w-2xl font-sans text-[0.85rem] text-faint">
            Every verdict here comes from Holt&apos;s fixed rules applied to each repo&apos;s recent pull requests, never from AI.
            It ranks projects, never people. Want one of your own? <Link href="/find" className="text-link">Find a project with starter issues</Link>.
          </p>
        </div>
      </>
    </PageTransition>
  );
}
