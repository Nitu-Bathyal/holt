import type { Metadata } from "next";
import Link from "next/link";
import { ExampleCards, type ExampleCard } from "@/components/examples/example-cards";
import { Words } from "@/components/landing/words";
import { PageTransition } from "@/components/motion/page-transition";
import { getReport } from "@/lib/api";
import { EXAMPLE_PATH, EXAMPLE_REPORT } from "@/lib/example-report";
import { EXAMPLES, EXAMPLES_PATH } from "@/lib/examples";
import { HOME } from "@/lib/home";
import { currentUser } from "@/lib/session";

export const metadata: Metadata = {
  title: "Example reports",
  description: "Full Holt reports on real repos: one worth your time, one that isn't, one without enough evidence, and an AI report.",
  alternates: { canonical: EXAMPLES_PATH },
};

// The curated examples (lib/examples.ts), each with today's verdict from the
// cache, set in the landing's type and cards (docs/design/EXPRESSIVE.md).
// Reading the cache starts no checks.
export default async function ExamplesPage() {
  const [reports, user] = await Promise.all([Promise.all(EXAMPLES.map((e) => getReport(e.repo))), currentUser()]);
  const cards: ExampleCard[] = [
    ...EXAMPLES.map((e, i) => {
      const r = reports[i];
      return {
        href: `/${e.repo}`,
        repo: e.repo,
        headline: r.ok ? r.data.headline : undefined,
        tone: r.ok ? r.data.tone : undefined,
        why: e.why,
        action: "read the report",
      };
    }),
    {
      href: EXAMPLE_PATH,
      repo: EXAMPLE_REPORT.repo,
      why: "The same evidence, explained in plain English. Every sentence cites a GitHub thread.",
      action: "read the AI report",
      ai: true,
    },
  ];

  return (
    <PageTransition>
      <>
        <section className="pane border-b border-line">
          <div className="wrap landing-wide">
            <p className="ls-kicker fade-up" style={{ ["--d" as string]: ".05s" }}>
              <span className="text-blue">examples</span>
            </p>
            <h1 className="h2 ls-h2-wide mb-[clamp(1.5rem,5svh,3.5rem)]">
              <Words text="See what a report tells you." />
            </h1>
            <ExampleCards cards={cards} />
          </div>
        </section>

        <section className="bg-section-alt py-[clamp(3rem,12svh,7rem)]">
          <div className="wrap landing-wide">
            <h2 className="h2 mb-8">
              <Words text="Got a repo in mind?" />
            </h2>
            <Link href={user ? HOME : "/signin"} prefetch={false} className="bracket-link">
              [ check your repo → ]
            </Link>
          </div>
        </section>
      </>
    </PageTransition>
  );
}
