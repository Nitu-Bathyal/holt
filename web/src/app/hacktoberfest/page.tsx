import type { Metadata } from "next";
import Link from "next/link";
import { CatFace } from "@/components/cat-face";
import { ErrorPanel } from "@/components/error-panel";
import { FindResults } from "@/components/find/find-results";
import { FindRunner } from "@/components/find/find-runner";
import { ShareBar } from "@/components/report/share-bar";
import { ProfileOnboarding } from "@/components/profile-onboarding";
import { getProfile } from "@/lib/api";
import { cachedFind } from "@/lib/find-cached";
import { days as daysOf, describe, personalise } from "@/lib/profile";
import { caller, currentUser } from "@/lib/session";
import { hacktoberfest, hacktoberfestOver, SITE_URL } from "@/lib/site";
import { PageTransition } from "@/components/motion/page-transition";

const YEAR = 2026;

export const metadata: Metadata = {
  title: { absolute: `Hacktoberfest ${YEAR}: contributions that actually land | Holt` },
  description:
    "Open-source projects that reply to and merge outside contributors, with specific issues by language, and five tips so your pull request gets reviewed.",
  alternates: { canonical: "/hacktoberfest" },
  openGraph: {
    title: `Hacktoberfest ${YEAR}: contributions that actually land`,
    description: "Projects that merge outside work, with issues to start on, by language. Free, from Holt.",
    url: "/hacktoberfest",
  },
};

const LANGS = [
  { id: "all", label: "All languages", langs: [] },
  { id: "python", label: "Python", langs: ["python"] },
  { id: "js", label: "JS / TS", langs: ["javascript", "typescript"] },
  { id: "go", label: "Go", langs: ["go"] },
  { id: "rust", label: "Rust", langs: ["rust"] },
  { id: "java", label: "Java", langs: ["java"] },
  { id: "cpp", label: "C / C++", langs: ["c", "c++"] },
  { id: "ruby", label: "Ruby", langs: ["ruby"] },
  { id: "php", label: "PHP", langs: ["php"] },
] as const;

const STEPS = [
  ["Pick a project that merges outside work", "Start from the list above, or paste any repo into Holt. Skip the ones where outside pull requests sit unanswered."],
  ["Take one real issue", "Choose something you understand, ask the maintainers if you can take it, and agree on the approach first."],
  ["See it through to merged", "Answer review, make the changes, and keep going until it lands. One merged fix beats ten ignored pull requests."],
] as const;

const TIPS = [
  ["Ask before you start.", "Comment on the issue and ask if you can take it. Maintainers ignore surprise pull requests far more often than ones they agreed to."],
  ["Read CONTRIBUTING first.", "Follow the project's setup, style and commit rules. It's the fastest way to look like someone worth reviewing."],
  ["Keep it small and focused.", "One issue, one pull request. Link the issue, say what you changed and how you tested it."],
  ["Own every line.", "Send only changes you understand and have tested. Typo-only edits and unreviewed AI-written code get closed as spam. Holt shows you real issues instead."],
  ["Reply to review, then be patient.", "Answer feedback within a day or two. Busy maintainers may take a week; one polite nudge after that is fine."],
] as const;

export default async function HacktoberfestPage({ searchParams }: PageProps<"/hacktoberfest">) {
  const [sp, user] = await Promise.all([searchParams, currentUser()]);
  const profileR = user ? await getProfile(user.id) : null;
  const profile = profileR?.ok ? profileR.data.profile : null;
  // With no tab picked, a profile picks the first tab that has one of its languages.
  const tab = LANGS.find((l) => l.id === sp.lang)
    ?? (profile && LANGS.find((l) => l.langs.some((x: string) => profile.languages.includes(x))))
    ?? LANGS[0];
  const days = profile ? daysOf(profile.days) : 7;
  const hf = hacktoberfest();
  const ended = hacktoberfestOver(YEAR);
  const result = await cachedFind({ languages: [...tab.langs], topics: [], days, hacktoberfest: true, limit: 12 }, await caller(user));
  const here = `/hacktoberfest${tab.id === "all" ? "" : `?lang=${tab.id}`}`;
  const fit = profile ? { level: profile.level, contributions: profile.contributions } : null;

  return (
    <PageTransition>
      <>
        {/* Campaign header: a limited-time event page, not part of the core site. */}
        <section className="relative overflow-hidden border-b border-hf-line bg-hf-bg">
          <div
            aria-hidden="true"
            className="absolute inset-0 opacity-[0.08]"
            style={{ backgroundImage: "repeating-linear-gradient(135deg, var(--hf) 0 2px, transparent 2px 14px)" }}
          />
          <div className="wrap relative py-10 sm:py-14">
            <div className="mb-6 flex flex-wrap items-center gap-2 text-[0.72rem] uppercase tracking-[0.08em]">
              <span className="rounded-full bg-hf px-3 py-1 font-semibold text-bg">limited-time event</span>
              <span className="rounded-full border border-hf-line px-3 py-1 text-hf">Hacktoberfest {YEAR} · 1–31 October</span>
              {hf && (
                <span className="inline-flex items-center gap-2 rounded-full border border-hf-line px-3 py-1 text-hf">
                  <span aria-hidden="true" className="size-1.5 rounded-full bg-orange motion-safe:animate-pulse" />
                  {hf.short}
                </span>
              )}
            </div>
            {ended && (
              <p role="status" className="mb-6 max-w-2xl border border-hf-line bg-panel px-4 py-3 font-sans text-[0.92rem] text-muted">
                Hacktoberfest {YEAR} has ended. The projects below still merge outside work, and{" "}
                <Link href="/find" className="text-link">/find</Link> works all year.
              </p>
            )}
            <h1 className="display max-w-4xl text-[clamp(2rem,6.5vw,3.6rem)]">
              This October, make contributions <span className="text-hf">that actually land.</span>
            </h1>
            <p className="prose-sans mt-5 max-w-2xl text-[1.05rem]">
              Hacktoberfest no longer counts pull requests, so aim for work that gets merged. Every project below is
              tagged for Hacktoberfest and merges outside contributors&apos; work, with open issues you could pick up today.
            </p>
            <p className="mt-3 text-[0.78rem] text-faint">This page is for October. Outside Hacktoberfest, use <Link href="/find" className="text-link">find a project</Link>.</p>
            <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
              <a href="#tips" className="bracket-link bracket-link--hf px-3 text-center text-[0.76rem] sm:px-4 sm:text-[0.82rem]">[ 5 tips so your PR gets reviewed ]</a>
              <ShareBar url={`${SITE_URL}/hacktoberfest`} text={`Contributing this October? These repos actually merge outsiders' pull requests:`} />
            </div>
          </div>
        </section>

        <div className="wrap py-10 sm:py-12">
          <ProfileOnboarding back="/hacktoberfest" className="mb-8" />
          {sp.profile === "saved" && (
            <p role="status" className="mb-6 border border-green/50 bg-green/10 px-4 py-3 font-sans text-[0.9rem] text-green">Profile saved. The projects below use it.</p>
          )}
          {profile && (
            <p className="mb-6 font-sans text-[0.88rem] text-muted">
              Using your profile: {describe(profile)}. <Link href="/settings/profile" className="text-link">edit</Link>
            </p>
          )}
          <nav aria-label="Language">
            <ul className="flex flex-wrap gap-2">
              {LANGS.map((l) => (
                <li key={l.id}>
                  <Link
                    href={l.id === "all" ? (profile ? "/hacktoberfest?lang=all" : "/hacktoberfest") : `/hacktoberfest?lang=${l.id}`}
                    scroll={false}
                    aria-current={l.id === tab.id ? "page" : undefined}
                    className={`chip min-h-11 whitespace-nowrap px-4 text-[0.85rem] transition-colors ${l.id === tab.id ? "border-hf bg-hf text-bg" : "hover:border-hf hover:text-ink"}`}
                  >
                    {l.label}
                    {l.id !== "all" && <span className="sr-only"> projects</span>}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <section aria-label={`Welcoming Hacktoberfest projects: ${tab.label}`} className="mt-8">
            {!result.ok ? (
              <ErrorPanel error={result.error} retryHref={here} />
            ) : result.data.status === "queued" ? (
              <FindRunner key={tab.id} jobId={result.data.job_id} days={days} retryHref={here} fit={fit} />
            ) : (
              <FindResults results={personalise(result.data.results, fit)} days={days} />
            )}
          </section>
        </div>

        <section aria-labelledby="how" className="border-t border-line bg-panel py-14 sm:py-20">
          <div className="wrap grid grid-cols-1 gap-12 lg:grid-cols-2">
            <div>
              <h2 id="how" className="h2">How to make October count</h2>
              <ol className="mt-8 space-y-6">
                {STEPS.map(([title, body], i) => (
                  <li key={title} className="grid grid-cols-[2.5rem_1fr] gap-3">
                    <span className="text-[1.4rem] font-semibold text-orange">{String(i + 1).padStart(2, "0")}</span>
                    <div>
                      <p className="font-semibold">{title}</p>
                      <p className="mt-1 font-sans text-muted">{body}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <p className="mt-6 font-sans text-[0.9rem] text-faint">
                Holt isn&apos;t affiliated with Hacktoberfest. For this year&apos;s events, see{" "}
                <a className="text-link" href="https://hacktoberfest.com" target="_blank" rel="noopener noreferrer">hacktoberfest.com ↗</a>.
              </p>
            </div>
            <div id="tips" className="scroll-mt-24">
              <h2 className="h2">How not to get your PR ignored</h2>
              <ol className="mt-8 space-y-5">
                {TIPS.map(([title, body]) => (
                  <li key={title} className="flex gap-3">
                    <span aria-hidden="true" className="text-green">→</span>
                    <p className="font-sans text-muted">
                      <strong className="font-semibold text-ink">{title}</strong> {body}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        <section className="py-14 text-center">
          <div className="wrap max-w-2xl">
            <CatFace mood="adoring" className="text-[1.8rem]" />
            <p className="mt-4 text-[1.3rem] font-semibold tracking-tight">Already have a repo in mind?</p>
            <p className="mt-2 font-sans text-muted">Check whether it merges outside work before you spend your October on it.</p>
            <Link href="/" className="bracket-link mt-6">[ check any repo → ]</Link>
          </div>
        </section>
      </>
    </PageTransition>
  );
}
