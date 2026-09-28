import Link from "next/link";
import { discover } from "@/lib/api";
import { boardHref, boardIntro, boardTitle, emptyText, SORTS } from "@/lib/discover";
import type { DiscoverSort } from "@/lib/types";
import { CatFace } from "../cat-face";
import { ErrorPanel } from "../error-panel";
import { PageTransition } from "../motion/page-transition";
import { PageHead } from "../page-head";
import { Board } from "./board";

/** /discover and /discover/<language>: one board, its sort switch and language chips. */
export async function DiscoverView({ sort, language, topic }: { sort: DiscoverSort; language: string | null; topic: string | null }) {
  const result = await discover(sort, language, topic);
  const here = boardHref({ sort, language, topic });
  const data = result.ok ? result.data : null;

  return (
    <PageTransition>
      <>
        <PageHead>
          <p className="rail mb-4 flex gap-2"><strong className="m-0">discover</strong><span>repos Holt has checked</span></p>
          <h1 className="display max-w-4xl text-[clamp(1.9rem,5.5vw,3.2rem)]">{boardTitle(sort, language)}</h1>
          <p className="prose-sans mt-5 max-w-2xl text-[1.02rem]">{boardIntro(sort, data?.trending_min ?? 5)}</p>

          <nav aria-label="Order" className="mt-8">
            <ul className="inline-grid w-full grid-cols-3 border border-line-strong bg-panel sm:w-auto">
              {SORTS.map((s) => (
                <li key={s.id} className="border-l border-line-strong first:border-l-0">
                  <Link
                    href={boardHref({ sort: s.id, language, topic })}
                    scroll={false}
                    aria-current={s.id === sort ? "page" : undefined}
                    className={`flex min-h-11 items-center justify-center px-3 text-center text-[0.78rem] leading-tight transition-colors sm:px-5 sm:text-[0.84rem] ${s.id === sort ? "bg-ink text-bg" : "text-muted hover:text-ink"}`}
                  >
                    {s.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          {data && data.languages.length > 0 && (
            <nav aria-label="Language" className="-mx-4 mt-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:overflow-visible sm:px-0">
              <ul className="flex w-max gap-2 sm:w-auto sm:flex-wrap">
                <li>
                  <Link href={boardHref({ sort, topic })} scroll={false} aria-current={!language ? "page" : undefined}
                    className={`chip min-h-11 whitespace-nowrap px-4 text-[0.82rem] transition-colors ${!language ? "border-blue bg-blue text-on-accent" : "hover:border-blue hover:text-ink"}`}>
                    All languages
                  </Link>
                </li>
                {data.languages.map((l) => {
                  const on = l.name.toLowerCase() === language?.toLowerCase();
                  return (
                    <li key={l.name}>
                      <Link href={boardHref({ sort, language: l.name, topic })} scroll={false} aria-current={on ? "page" : undefined}
                        className={`chip min-h-11 whitespace-nowrap px-4 text-[0.82rem] transition-colors ${on ? "border-blue bg-blue text-on-accent" : "hover:border-blue hover:text-ink"}`}>
                        {l.name}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>
          )}
          {topic && (
            <p className="mt-4 text-[0.82rem] text-muted">
              Only repos tagged <strong className="font-semibold text-ink">{topic}</strong>.{" "}
              <Link href={boardHref({ sort, language })} className="text-link">Show all topics</Link>
            </p>
          )}
        </PageHead>

        <div className="wrap py-10 sm:py-12">
          <section aria-label={boardTitle(sort, language)}>
            {!result.ok ? (
              <ErrorPanel error={result.error} retryHref={here} />
            ) : data!.repos.length ? (
              <Board repos={data!.repos} sort={sort} />
            ) : (
              <div className="border border-dashed border-line-strong p-8 text-center">
                <CatFace mood="thinking" className="text-[1.6rem]" />
                <p className="mt-4 text-[1.05rem] font-semibold">{emptyText(sort, language, topic, data!.trending_min)}</p>
                <p className="mt-2 font-sans text-muted">Check a repo you have in mind; it shows up here once Holt has a verdict.</p>
                <Link href="/" className="bracket-link mt-6">[ check a repo ]</Link>
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
