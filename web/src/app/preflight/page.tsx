import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ErrorPanel } from "@/components/error-panel";
import { PageTransition } from "@/components/motion/page-transition";
import { PageHead } from "@/components/page-head";
import { PreflightView } from "@/components/preflight/preflight-view";
import { preflightState } from "@/lib/api";
import { caller, currentUser } from "@/lib/session";

export const metadata: Metadata = {
  title: "PR pre-flight",
  description: "Paste your PR and see how it stacks up against what that repo merges: checks, tests, size, the template and linked issues.",
  alternates: { canonical: "/preflight" },
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim().slice(0, 500) || null;

export default async function PreflightPage({ searchParams }: PageProps<"/preflight">) {
  const [sp, user] = await Promise.all([searchParams, currentUser()]);
  const q = { pr: one(sp.pr), repo: one(sp.repo), branch: one(sp.branch), base: one(sp.base) };
  // `?repo=` alone (from a report page) only fills in the form.
  const complete = Boolean(q.pr || (q.repo && q.branch));
  const who = await caller(user);
  let r = await preflightState(complete ? q : {}, who);
  let bad = null;
  if (!r.ok && r.status === 400 && complete) {
    bad = r.error;
    r = await preflightState({}, who);
  }
  // Hidden entirely when this server runs without paid features.
  if (r.ok && !r.data.available) notFound();

  return (
    <PageTransition>
      <>
        <PageHead narrow>
          <p className="rail mb-4 flex gap-2">
            <strong className="m-0">pr pre-flight</strong>
            <span>before a maintainer sees it</span>
          </p>
          <h1 className="display max-w-3xl text-[clamp(2rem,6vw,3.2rem)]">
            Check your PR <span className="text-blue">against what gets merged.</span>
          </h1>
          <p className="prose-sans mt-5 max-w-2xl text-[1rem]">
            Paste your PR. Holt holds it up against a year of PRs this repo merged, point by point, with the evidence.
            It never comments on GitHub or touches your code.
          </p>
        </PageHead>
        <div className="wrap max-w-3xl py-8 sm:py-12">
          {r.ok ? (
            <PreflightView key={JSON.stringify(q)} initial={r.data} query={q} signedIn={Boolean(user)} badQuery={bad} />
          ) : (
            <ErrorPanel error={r.error} />
          )}
        </div>
      </>
    </PageTransition>
  );
}
