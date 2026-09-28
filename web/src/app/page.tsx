import type { Metadata } from "next";
import Link from "next/link";
import { CatFace } from "@/components/cat-face";
import { CopyButton } from "@/components/copy-button";
import { HacktoberfestPill } from "@/components/hacktoberfest-pill";
import { CatCompanion } from "@/components/motion/cat-companion";
import { ScrollMarquee } from "@/components/motion/scroll-marquee";
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

function Rail({ n, label, className = "" }: { n: string; label: string; className?: string }) {
  return (
    <aside className={`rail ${className}`} data-reveal>
      <strong>{n}</strong>
      <span>{label}</span>
    </aside>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="wrap grid grid-cols-1 gap-6 md:grid-cols-[148px_minmax(0,1fr)] md:gap-10">{children}</div>;
}

// Section 06's call to action. Signed-in people already have their free AI
// reports, so they get their history instead of a sign-in button.
async function AiReportsCta() {
  if (await currentUser()) {
    return (
      <Link href="/me/history" className="bracket-link">[ your reports → ]</Link>
    );
  }
  return (
    <>
      <Link href="/signin" className="bracket-link">[ sign in for {WELCOME_AI_CREDITS} free AI reports → ]</Link>
      <Link href={EXAMPLE_PATH} className="text-link inline-flex min-h-11 items-center text-[0.89rem]">[ read an example first ]</Link>
    </>
  );
}

export default async function Home() {
  const hf = hacktoberfest();
  // Signed out, the paste boxes go through sign-in (see lib/gate.ts).
  const signedIn = Boolean(await currentUser());
  return (
    <PageTransition>
      <>
        {/* 01 — start here */}
        <section data-hero data-cat-section="ready" className="pane relative overflow-hidden border-b border-line low:pt-5 short:pt-3">
          <div aria-hidden="true" className="hero-backdrop" />
          <CatCompanion />
          <Grid>
            <Rail n="01" label="start here" className="relative hidden pt-2 md:block" />
            <div className="relative z-10 max-w-[860px]">
              <div className="fade-up mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 low:mb-3 short:mb-2" style={{ ["--d" as string]: ".1s" }}>
                {hf && <HacktoberfestPill year={hf.year} short={hf.short} />}
                <p className="text-[0.85rem] text-muted">holt / free / for your first PR or your fiftieth</p>
              </div>
              <h1 className="display mb-5 text-[clamp(2rem,8.9vw,3.15rem)] low:mb-4 low:text-[2.75rem] short:mb-3 short:text-[2rem]">
                <span className="headline-line"><span>Will this repo</span></span>
                <span className="headline-line"><span className="text-orange"><span className="marker">actually merge</span></span></span>
                <span className="headline-line"><span className="text-orange">your PR?</span></span>
              </h1>
              <p className="prose-sans fade-up mb-6 max-w-[680px] text-[clamp(1rem,1.45vw,1.12rem)] low:mb-4 short:mb-4" style={{ ["--d" as string]: ".3s" }}>
                Paste a repo. Holt checks what happened to the outsiders who tried before you: did anyone reply, and
                did anything get merged?
              </p>
              <div className="fade-up max-w-[760px]" style={{ ["--d" as string]: ".38s" }}>
                <PasteBox signedIn={signedIn} />
              </div>
              <div className="fade-up mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 sm:mt-4 sm:gap-x-5" style={{ ["--d" as string]: ".42s" }}>
                <span className="font-sans text-[0.95rem] text-muted">No repo in mind?</span>
                <Link href="/find" className="bracket-link bracket-link--orange min-h-11 px-3 text-center text-[0.88rem] sm:min-h-12 sm:px-5 sm:text-[0.9rem]">
                  [ find a project&nbsp;→&nbsp;]
                </Link>
              </div>
              <p className="fade-up mt-4 font-sans text-[0.89rem] text-faint" style={{ ["--d" as string]: ".45s" }}>
                Already on GitHub? Swap <strong className="text-muted">hub</strong> for <strong className="text-muted">holt</strong>:{" "}
                <code className="font-mono">github.com</code> → <code className="font-mono text-muted">{SITE_HOST}</code>
              </p>
              <div className="fade-up mt-8 flex flex-wrap items-center gap-x-3 gap-y-2 low:mt-5" style={{ ["--d" as string]: ".5s" }}>
                <span className="award-badge">
                  <span>micro1 winner</span>
                  <span>Most useful real-world workflow</span>
                </span>
                <span className="text-[0.75rem] text-faint">Frontier Engineering Challenge</span>
              </div>
            </div>
          </Grid>
        </section>

        {/* After sign-in: the profile card, for people who haven't saved or skipped it. */}
        <Suspense fallback={null}>
          <ProfileOnboarding back="/" className="wrap py-8" />
        </Suspense>

        {/* 02 — see the answer */}
        <section data-cat-section="startled" className="pane">
          <Grid>
            <Rail n="02" label="see the answer" />
            <div>
              <h2 className="h2 mb-6 max-w-[770px]" data-reveal>The answer, with receipts.</h2>
              <p className="prose-sans mb-12 max-w-[740px] text-[1.05rem]" data-reveal>
                Every claim in a report links to the GitHub thread it came from. Check our work.
              </p>

              <SkeletonReveal fallback={<SampleReportSkeleton />}>
                <LiveSample />
              </SkeletonReveal>
            </div>
          </Grid>
        </section>

        {/* 03 — who it's for */}
        <section data-cat-section="thinking" className="pane border-t border-line bg-section-alt">
          <Grid>
            <Rail n="03" label="who it's for" />
            <div>
              <h2 className="h2 mb-10 max-w-[770px]" data-reveal>Don&apos;t write your PR into the void.</h2>
              <ul className="grid gap-px border border-line bg-line md:grid-cols-3">
                {[
                  { title: "Your first PR", body: "Skip the repos where outside PRs sit in silence. Start where someone answers." },
                  { title: "Your next project", body: "Spend your evenings where outside work gets merged, and see which folders it lands in." },
                  { title: "A fix you need upstream", body: "Hit a bug at work? Find out if they take outside patches before you tell your team it'll land by Friday." },
                ].map((a) => (
                  <li key={a.title} className="bg-panel p-6" data-reveal>
                    <p className="text-[1.1rem] font-semibold tracking-tight">{a.title}</p>
                    <p className="mt-2 font-sans text-[0.95rem] text-muted">{a.body}</p>
                  </li>
                ))}
              </ul>
              <div className="mt-10 flex flex-wrap items-center gap-x-4 gap-y-2" data-reveal>
                <span className="font-sans text-[0.95rem] text-muted">Starting from zero?</span>
                <Link href="/find" className="bracket-link">[ find a project in your language → ]</Link>
              </div>
            </div>
          </Grid>
        </section>

        {/* 04 — the URL trick */}
        <section data-cat-section="determined" className="pane border-t border-line">
          <Grid>
            <Rail n="04" label="the url trick" />
            <div>
              <h2 className="h2 mb-6 max-w-[770px]" data-reveal>Already on GitHub? Swap hub for holt.</h2>
              <p className="prose-sans mb-10 max-w-[740px] text-[1.05rem]" data-reveal>
                Change <code className="font-mono text-ink">github.com</code> to{" "}
                <code className="font-mono text-ink">{SITE_HOST}</code> in any repo link and hit enter. Works on your
                phone too.
              </p>
              <UrlTrick />
            </div>
          </Grid>
        </section>

        {/* 05 — what it checks */}
        <section data-cat-section="heartbroken" className="pane border-t border-line bg-section-alt">
          <Grid>
            <Rail n="05" label="what it checks" />
            <div>
              <h2 className="h2 mb-6 max-w-[770px]" data-reveal>Stars won&apos;t tell you who gets merged.</h2>
              <p className="prose-sans mb-12 max-w-[740px] text-[1.05rem]" data-reveal>
                So Holt skips them and reads what happened to the outsiders who tried.
              </p>
              <div className="border-t border-line-strong">
                {[
                  { id: "PR / 4821", quote: "Thanks for this! Merged. Could you also look at the sibling case?", verdict: "→ there's a way in", tone: "text-green", bar: "bg-green" },
                  { id: "PR / 917", quote: "We're rewriting this module internally, closing.", verdict: "→ don't spend the week", tone: "text-orange", bar: "bg-orange" },
                ].map((t) => (
                  <article key={t.id} className="relative grid grid-cols-1 gap-2 border-b border-line py-7 md:grid-cols-[110px_minmax(0,1fr)_200px] md:gap-6" data-reveal>
                    <span aria-hidden="true" className={`absolute -left-3 inset-y-0 w-0.5 md:-left-5 ${t.bar}`} />
                    <div className="text-[0.82rem] text-faint">{t.id}</div>
                    <blockquote className="m-0 font-sans text-[1.06rem] text-ink">“{t.quote}”</blockquote>
                    <div className={`text-[0.87rem] md:text-right ${t.tone}`}>{t.verdict}</div>
                  </article>
                ))}
              </div>
              <p className="mt-6 text-[0.82rem] text-faint" data-reveal>
                <span className="text-blue">evidence:</span> both say &ldquo;closed&rdquo; on GitHub. Only one is good news.
              </p>
              <div className="mt-10 flex flex-wrap items-center gap-x-4 gap-y-2" data-reveal>
                <span className="font-sans text-[0.95rem] text-muted">Rather browse a ranked list?</span>
                <Link href="/discover" className="bracket-link">[ discover repos → ]</Link>
              </div>
            </div>
          </Grid>
        </section>

        {/* 06 — three answers */}
        <section data-cat-section="celebrating" className="pane border-t border-line">
          <Grid>
            <Rail n="06" label="three answers" />
            <div>
              <h2 className="h2 mb-6 max-w-[770px]" data-reveal>Three possible answers. No hedging.</h2>
              <p className="prose-sans mb-12 max-w-[740px] text-[1.05rem]" data-reveal>
                The same written rules judge every repo. An AI can explain the evidence to you. It can&apos;t change the
                answer.{" "}
                <Link href="/how-it-works" className="text-link font-mono text-[0.9rem]">[ how it decides ]</Link>
              </p>
              <ul className="grid gap-px border border-line bg-line md:grid-cols-3">
                {[
                  { mood: "celebrating" as const, title: "Worth your time", tone: "text-green", body: "Outsiders get replies and get merged. Holt shows you where to start." },
                  { mood: "heartbroken" as const, title: "Not worth your time", tone: "text-orange", body: "Outside PRs mostly go unanswered or unmerged. Save your week." },
                  { mood: "thinking" as const, title: "Not enough evidence", tone: "text-amber", body: "Too few people have tried recently to say. Holt won't guess." },
                ].map((v) => (
                  <li key={v.title} className="bg-panel p-6" data-reveal>
                    <CatFace mood={v.mood} className="text-[1.4rem]" />
                    <p className={`mt-4 text-[1.2rem] font-semibold tracking-tight ${v.tone}`}>{v.title}</p>
                    <p className="mt-2 font-sans text-[0.95rem] text-muted">{v.body}</p>
                  </li>
                ))}
              </ul>
              <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3" data-reveal>
                <span className="w-full font-sans text-[0.95rem] text-muted">Want the evidence explained in plain English, with citations?</span>
                <Suspense fallback={null}>
                  <AiReportsCta />
                </Suspense>
              </div>
            </div>
          </Grid>
        </section>

        {/* 07 — open source */}
        <section data-cat-section="adoring" className="pane relative overflow-clip border-t border-line bg-panel">
          <ScrollMarquee text="OPEN / SOURCE / OPEN / SOURCE / OPEN / SOURCE / OPEN / SOURCE / OPEN / SOURCE /" />
          <div className="relative">
            <Grid>
              <Rail n="07" label="open source" />
              <div>
                <h2 className="h2 mb-6 max-w-[770px]" data-reveal>Open source. We merge outsiders too.</h2>
                <p className="prose-sans mb-8 max-w-[740px] text-[1.05rem]" data-reveal>
                  Fix a typo in the docs or rework the verdict rules. There&apos;s room at every level. Prefer the
                  terminal? Holt runs there too.
                </p>
                <div className="grid max-w-[760px] grid-cols-[auto_1fr_auto] items-center border border-line-strong bg-bg" data-reveal>
                  <span aria-hidden="true" className="pl-4 text-amber">$</span>
                  <code className="min-w-0 overflow-x-auto whitespace-nowrap px-2 py-4 text-[0.8rem] sm:px-3 sm:text-[0.9rem]">uv tool install holt-cli</code>
                  <CopyButton text="uv tool install holt-cli" className="self-stretch border-l border-line-strong px-3 text-[0.89rem] text-muted sm:px-4 transition-colors hover:bg-green hover:text-on-accent" />
                </div>
                <div className="mt-8 flex flex-wrap items-center gap-x-7 gap-y-4" data-reveal>
                  <a className="bracket-link" href={`${GITHUB_REPO_URL}/blob/main/CONTRIBUTING.md`}>[ start contributing → ]</a>
                  <a className="text-link inline-flex min-h-11 items-center text-[0.89rem]" href={GITHUB_REPO_URL}>[ star it on GitHub ]</a>
                  <span className="text-[0.82rem] text-faint">Apache-2.0</span>
                </div>
              </div>
            </Grid>
          </div>
        </section>
        {/* 08 — your turn: no scrolling to a dead end */}
        <section data-cat-section="ready" className="pane border-t border-line">
          <Grid>
            <Rail n="08" label="your turn" />
            <div>
              <h2 className="h2 mb-6 max-w-[770px]" data-reveal>Got a repo in mind?</h2>
              <p className="prose-sans mb-8 max-w-[740px] text-[1.05rem]" data-reveal>
                Paste it. You&apos;ll know before you write a line of code.
              </p>
              <div className="max-w-[760px]" data-reveal>
                <PasteBox id="repo-input-end" label="Repo to check" examples={false} signedIn={signedIn} />
              </div>
              <p className="mt-5 font-sans text-[0.95rem] text-muted" data-reveal>
                No repo yet?{" "}
                <Link href="/find" className="text-link font-mono text-[0.9rem]">[ find a project ]</Link>
              </p>
            </div>
          </Grid>
        </section>
      </>
    </PageTransition>
  );
}
