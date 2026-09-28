import type { Metadata } from "next";
import Link from "next/link";
import { CatFace } from "@/components/cat-face";
import { HacktoberfestPill } from "@/components/hacktoberfest-pill";
import { CatCompanion } from "@/components/motion/cat-companion";
import { PasteBox } from "@/components/paste-box";
import { UrlTrick } from "@/components/url-trick";
import { LiveSample } from "@/components/sample-report";
import { SampleReportSkeleton } from "@/components/sample-report-skeleton";
import { SkeletonReveal } from "@/components/motion/reveal";
import { EXAMPLE_PATH } from "@/lib/example-report";
import { currentUser } from "@/lib/session";
import { GITHUB_REPO_URL, SITE_HOST, WELCOME_AI_CREDITS, hacktoberfest } from "@/lib/site";
import { PageTransition } from "@/components/motion/page-transition";
import { ProfileOnboarding } from "@/components/profile-onboarding";
import { Suspense } from "react";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

/** One calm column per section. */
function Column({ children }: { children: React.ReactNode }) {
  return <div className="wrap">{children}</div>;
}

// Section 06's call to action. Signed-in people already have their free AI
// reports, so they get their history instead of a sign-in button.
async function AiReportsCta() {
  if (await currentUser()) {
    return (
      <Link href="/me/history" className="bracket-link">Your reports →</Link>
    );
  }
  return (
    <>
      <Link href="/signin" className="bracket-link">Sign in for {WELCOME_AI_CREDITS} free AI reports →</Link>
      <Link href={EXAMPLE_PATH} className="text-link inline-flex min-h-11 items-center text-[0.875rem]">Read an example first</Link>
    </>
  );
}

export default function Home() {
  const hf = hacktoberfest();
  return (
    <PageTransition>
      <>
        {/* Start here: one question, one box. */}
        <section data-hero data-cat-section="ready" className="pane relative overflow-hidden">
          <CatCompanion />
          <Column>
            <div className="relative z-10 max-w-[760px]">
              {hf && (
                <div className="fade-up mb-6" style={{ ["--d" as string]: ".1s" }}>
                  <HacktoberfestPill year={hf.year} short={hf.short} />
                </div>
              )}
              <h1 className="display mb-5 text-[clamp(2.25rem,7vw,3.5rem)] short:text-[2.25rem]">
                <span className="headline-line"><span>Will this repo</span></span>
                <span className="headline-line"><span className="text-orange">actually merge your PR?</span></span>
              </h1>
              <p className="fade-up mb-8 max-w-[560px] text-[1.125rem] leading-relaxed text-muted" style={{ ["--d" as string]: ".3s" }}>
                Paste a repo. Holt checks whether people outside the project get replies and get merged.
              </p>
              <div className="fade-up max-w-[680px]" style={{ ["--d" as string]: ".38s" }}>
                <PasteBox />
              </div>
              <p className="fade-up mt-5 text-[1rem] text-muted" style={{ ["--d" as string]: ".42s" }}>
                No repo in mind?{" "}
                <Link href="/find" prefetch className="text-link">Find a project</Link>
              </p>
            </div>
          </Column>
        </section>

        {/* After sign-in: the profile card, for people who haven't saved or skipped it. */}
        <Suspense fallback={null}>
          <ProfileOnboarding back="/" className="wrap py-8" />
        </Suspense>

        {/* See the answer */}
        <section data-cat-section="startled" className="pane">
          <Column>
            <h2 className="h2 mb-4 max-w-[680px]" data-reveal>The answer, with receipts.</h2>
            <p className="mb-12 max-w-[560px] text-[1.125rem] text-muted" data-reveal>
              Every claim links to the GitHub thread it came from.
            </p>
            <SkeletonReveal fallback={<SampleReportSkeleton />}>
              <LiveSample />
            </SkeletonReveal>
          </Column>
        </section>

        {/* Who it's for */}
        <section data-cat-section="thinking" className="pane bg-section-alt">
          <Column>
            <h2 className="h2 mb-12 max-w-[680px]" data-reveal>Don&apos;t write your PR into the void.</h2>
            <ul className="grid gap-10 md:grid-cols-3 md:gap-12">
              {[
                { title: "Your first PR", body: "Start where someone answers." },
                { title: "Your next project", body: "See where outside work gets merged." },
                { title: "A fix you need upstream", body: "Know if they take outside patches before you promise a date." },
              ].map((a) => (
                <li key={a.title} data-reveal>
                  <p className="font-serif text-[1.375rem] font-semibold">{a.title}</p>
                  <p className="mt-2 text-[1.125rem] leading-relaxed text-muted">{a.body}</p>
                </li>
              ))}
            </ul>
          </Column>
        </section>

        {/* The URL trick */}
        <section data-cat-section="determined" className="pane">
          <Column>
            <h2 className="h2 mb-4 max-w-[680px]" data-reveal>Already on GitHub? Swap hub for holt.</h2>
            <p className="mb-10 max-w-[560px] text-[1.125rem] text-muted" data-reveal>
              Change <code className="text-ink">github.com</code> to <code className="text-ink">{SITE_HOST}</code> in any repo link.
            </p>
            <UrlTrick />
          </Column>
        </section>

        {/* Three answers */}
        <section data-cat-section="celebrating" className="pane bg-section-alt">
          <Column>
            <h2 className="h2 mb-4 max-w-[680px]" data-reveal>Three possible answers.</h2>
            <p className="mb-12 max-w-[560px] text-[1.125rem] text-muted" data-reveal>
              The same written rules judge every repo. <Link href="/how-it-works" className="text-link">How it decides</Link>
            </p>
            <ul className="grid gap-10 md:grid-cols-3 md:gap-12">
              {[
                { mood: "celebrating" as const, title: "Worth your time", tone: "text-green", body: "Outsiders get replies and get merged." },
                { mood: "heartbroken" as const, title: "Not worth your time", tone: "text-orange", body: "Outside PRs mostly go unanswered." },
                { mood: "thinking" as const, title: "Not enough evidence", tone: "text-amber", body: "Too few people tried recently to say." },
              ].map((v) => (
                <li key={v.title} data-reveal>
                  <CatFace mood={v.mood} className="text-[1.375rem]" />
                  <p className={`mt-4 font-serif text-[1.375rem] font-semibold ${v.tone}`}>{v.title}</p>
                  <p className="mt-2 text-[1.125rem] leading-relaxed text-muted">{v.body}</p>
                </li>
              ))}
            </ul>
            <div className="mt-12 flex flex-wrap items-center gap-x-6 gap-y-3" data-reveal>
              <Suspense fallback={null}>
                <AiReportsCta />
              </Suspense>
            </div>
          </Column>
        </section>

        {/* Open source */}
        <section data-cat-section="adoring" className="pane">
          <Column>
            <h2 className="h2 mb-4 max-w-[680px]" data-reveal>Open source. We merge outsiders too.</h2>
            <p className="mb-10 max-w-[560px] text-[1.125rem] text-muted" data-reveal>
              From a docs typo to the verdict rules, there&apos;s room at every level.
            </p>
            <div className="flex flex-wrap items-center gap-x-7 gap-y-4" data-reveal>
              <a className="bracket-link" href={`${GITHUB_REPO_URL}/blob/main/CONTRIBUTING.md`}>Start contributing →</a>
              <a className="text-link inline-flex min-h-11 items-center" href={GITHUB_REPO_URL}>Star it on GitHub</a>
            </div>
            <p className="mt-12 text-[0.875rem] text-faint" data-reveal>
              Winner, most useful real-world workflow · micro1 Frontier Engineering Challenge
            </p>
          </Column>
        </section>

        {/* Your turn: no scrolling to a dead end */}
        <section data-cat-section="ready" className="pane bg-section-alt">
          <Column>
            <h2 className="h2 mb-8 max-w-[680px]" data-reveal>Got a repo in mind?</h2>
            <div className="max-w-[680px]" data-reveal>
              <PasteBox id="repo-input-end" label="Repo to check" examples={false} />
            </div>
          </Column>
        </section>
      </>
    </PageTransition>
  );
}
