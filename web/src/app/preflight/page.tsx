import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ErrorPanel } from "@/components/error-panel";
import { PageTransition } from "@/components/motion/page-transition";
import { PreflightView } from "@/components/preflight/preflight-view";
import { AppPageHeader } from "@/components/shell/app-page";
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
      <div className="app-page">
        <AppPageHeader title="Check your PR against what this repo merges." lead="A year of its merged PRs, point by point, with the evidence." mood="determined" />
        <div className="max-w-3xl">
          {r.ok ? (
            <PreflightView key={JSON.stringify(q)} initial={r.data} query={q} signedIn={Boolean(user)} badQuery={bad} />
          ) : (
            <ErrorPanel error={r.error} />
          )}
        </div>
      </div>
    </PageTransition>
  );
}
