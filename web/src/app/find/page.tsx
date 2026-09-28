import type { Metadata } from "next";
import { ErrorPanel } from "@/components/error-panel";
import { PageHead } from "@/components/page-head";
import { FindResults } from "@/components/find/find-results";
import { FindRunner } from "@/components/find/find-runner";
import { ProfileOnboarding } from "@/components/profile-onboarding";
import { getProfile } from "@/lib/api";
import { cachedFind } from "@/lib/find-cached";
import { CONTRIBUTIONS, contributions, days as daysOf, describe, LANGS, LEVELS, level as levelOf, personalise, TIME, topics as topicsOf } from "@/lib/profile";
import { hacktoberfest } from "@/lib/site";
import { caller, currentUser } from "@/lib/session";
import { PageTransition } from "@/components/motion/page-transition";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Find a project",
  description: "Pick your languages and how much time you have. Holt finds projects that reply to and merge outside contributors, with specific issues to start on.",
  alternates: { canonical: "/find" },
};

const list = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? v.split(",") : []).map((s) => s.trim()).filter(Boolean);

export default async function FindPage({ searchParams }: PageProps<"/find">) {
  const [sp, user] = await Promise.all([searchParams, currentUser()]);
  const profileR = user ? await getProfile(user.id) : null;
  const profile = profileR?.ok ? profileR.data.profile : null;
  const urlLangs = list(sp.lang).map((l) => l.toLowerCase());
  const searched = sp.go === "1" || urlLangs.length > 0;
  // A search in the URL wins; otherwise the form starts from the profile.
  const from = searched || !profile ? null : profile;
  const langs = from ? from.languages : urlLangs;
  const days = from ? daysOf(from.days) : daysOf(sp.days);
  const topics = from ? from.topics : topicsOf(list(sp.topics).join(","));
  // Without a level in the URL nothing is filtered: every starter issue shows.
  const level = from ? from.level : levelOf(sp.level);
  const types = from ? from.contributions : contributions(list(sp.type));
  const hfDefault = Boolean(hacktoberfest());
  const hf = sp.hacktoberfest != null ? sp.hacktoberfest === "1" : searched ? false : hfDefault;
  const more = Boolean(topics.length || types.length || level === "newcomer");

  const who = await caller(user);
  const result = searched
    ? await cachedFind({ languages: langs, topics, days, hacktoberfest: hf, limit: 12 }, who)
    : null;
  const fit = { level, contributions: types };

  return (
    <PageTransition>
      <>
      <PageHead>
        <p className="rail mb-4 flex gap-2"><strong className="m-0">find</strong><span>a project to contribute to</span></p>
        <h1 className="display max-w-3xl text-[clamp(2rem,6vw,3.4rem)]">
          Tell us what you know. <span className="text-orange">We&apos;ll find where you&apos;re welcome.</span>
        </h1>
        <p className="prose-sans mt-5 max-w-2xl text-[1.05rem]">
          Every project below replies to outside contributors and merges their work. Each comes with open issues you could take today, for a first pull request or your fiftieth.
        </p>

        {sp.profile === "saved" && (
          <p role="status" className="mt-8 border border-green/50 bg-green/10 px-4 py-3 font-sans text-[0.9rem] text-green">
            Profile saved. This search uses it; change it any time in <Link href="/settings#profile" className="underline">settings</Link>.
          </p>
        )}
        <ProfileOnboarding back="/find" className="mt-8" />
        {from && (
          <p className="mt-8 font-sans text-[0.88rem] text-muted">
            Filled in from your profile: {describe(from)}. <Link href="/settings#profile" className="text-link">edit</Link>
          </p>
        )}

        <form action="/find" method="get" className="mt-10 space-y-8 border border-line-strong bg-panel p-5 shadow-soft sm:p-8">
          <input type="hidden" name="go" value="1" />
          <fieldset>
            <legend className="mb-3 text-[0.78rem] uppercase tracking-[0.08em] text-faint">Languages you can read</legend>
            <div className="flex flex-wrap gap-2">
              {LANGS.map((l) => (
                <label key={l} className="chip min-h-11 cursor-pointer select-none px-4 text-[0.85rem] transition-colors hover:border-blue has-[:checked]:border-blue has-[:checked]:bg-blue has-[:checked]:text-on-accent has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-blue">
                  <input type="checkbox" name="lang" value={l.toLowerCase()} defaultChecked={langs.includes(l.toLowerCase())} className="sr-only" />
                  {l}
                </label>
              ))}
            </div>
            <p className="mt-2 font-sans text-[0.82rem] text-faint">Pick none to see everything.</p>
          </fieldset>

          <fieldset>
            <legend className="mb-3 text-[0.78rem] uppercase tracking-[0.08em] text-faint">Time you have</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {TIME.map((t) => (
                <label key={t.days} className="flex min-h-12 cursor-pointer items-center justify-center border border-line-strong px-3 text-[0.88rem] transition-colors hover:border-blue has-[:checked]:border-green has-[:checked]:bg-green/10 has-[:checked]:text-green has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-blue">
                  <input type="radio" name="days" value={t.days} defaultChecked={days === t.days} className="sr-only" />
                  {t.label}
                </label>
              ))}
            </div>
          </fieldset>

          <details open={more} className="group border-t border-line pt-6">
            <summary className="cursor-pointer text-[0.85rem] text-muted hover:text-ink">
              More options <span className="text-faint">(experience, what to work on, topics)</span>
            </summary>
            <div className="mt-6 space-y-8">
              <fieldset>
                <legend className="mb-3 text-[0.78rem] uppercase tracking-[0.08em] text-faint">Your experience</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {LEVELS.map((l) => (
                    <label key={l.id} className="flex min-h-12 cursor-pointer flex-col items-start justify-center gap-1 border border-line-strong px-3 py-3 text-[0.88rem] transition-colors hover:border-blue has-[:checked]:border-green has-[:checked]:bg-green/10 has-[:checked]:text-green has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-blue">
                      <input type="radio" name="level" value={l.id} defaultChecked={level === l.id} className="sr-only" />
                      <span className="font-semibold">{l.label}</span>
                      <span className="font-sans text-[0.8rem] text-muted">{l.hint}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend className="mb-3 text-[0.78rem] uppercase tracking-[0.08em] text-faint">What you&apos;d like to work on</legend>
                <div className="flex flex-wrap gap-2">
                  {CONTRIBUTIONS.map((c) => (
                    <label key={c.id} className="chip min-h-11 cursor-pointer select-none px-4 text-[0.85rem] transition-colors hover:border-blue has-[:checked]:border-blue has-[:checked]:bg-blue has-[:checked]:text-on-accent has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-blue">
                      <input type="checkbox" name="type" value={c.id} defaultChecked={types.includes(c.id)} className="sr-only" />
                      {c.label}
                    </label>
                  ))}
                </div>
                <p className="mt-2 font-sans text-[0.82rem] text-faint">Issues like these come first.</p>
              </fieldset>
              <label className="block">
                <span className="mb-3 block text-[0.78rem] uppercase tracking-[0.08em] text-faint">Topics</span>
                <input type="text" name="topics" defaultValue={topics.join(", ")} placeholder="e.g. web, cli, machine-learning" maxLength={300} className="min-h-11 w-full border border-line-strong bg-bg px-3 font-sans text-[0.95rem] outline-none focus-visible:border-blue" />
                <span className="mt-2 block font-sans text-[0.82rem] text-faint">GitHub topics, separated by commas. They narrow the search a lot.</span>
              </label>
            </div>
          </details>

          <label className="flex cursor-pointer items-center gap-3 text-[0.9rem]">
            <input type="checkbox" name="hacktoberfest" value="1" defaultChecked={hf} className="peer sr-only" />
            <span aria-hidden="true" className="relative h-6 w-11 shrink-0 rounded-full border border-line-strong bg-panel-2 transition-colors after:absolute after:left-0.5 after:top-0.5 after:size-4.5 after:rounded-full after:bg-faint after:transition-transform peer-checked:border-hf peer-checked:bg-hf-bg peer-checked:after:translate-x-5 peer-checked:after:bg-hf peer-focus-visible:outline-2 peer-focus-visible:outline-blue" />
            <span>
              Only Hacktoberfest projects{" "}
              <span className="ml-1 rounded-full border border-hf-line bg-hf-bg px-2 py-0.5 align-middle text-[0.66rem] uppercase tracking-[0.06em] text-hf">October</span>
              <span className="block font-sans text-[0.8rem] text-faint">Projects that tagged themselves for Hacktoberfest this October.</span>
            </span>
          </label>

          <button type="submit" data-umami-event="find-run" className="btn-primary w-full sm:w-auto">
            find projects <span aria-hidden="true">→</span>
          </button>
        </form>
      </PageHead>

        {result && (
          <div className="wrap py-10 sm:py-12">
          <section aria-label="Results">
            {!result.ok ? (
              <ErrorPanel error={result.error} retryHref="/find" />
            ) : result.data.status === "queued" ? (
              <FindRunner jobId={result.data.job_id} days={days} fit={fit} />
            ) : (
              ((shown) => (
                <>
                  <p className="mb-5 text-[0.8rem] text-faint">
                    {shown.length} welcoming project{shown.length === 1 ? "" : "s"}, best starter issues first
                  </p>
                  <FindResults results={shown} days={days} />
                </>
              ))(personalise(result.data.results, fit))
            )}
          </section>
          </div>
        )}
      </>
    </PageTransition>
  );
}
