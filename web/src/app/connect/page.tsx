import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { oauthProviders } from "@/auth";
import { STATS_NOTICE } from "@/components/connect-github-card";
import { PageHead } from "@/components/page-head";
import { PageTransition } from "@/components/motion/page-transition";
import { githubConnection } from "@/lib/api";
import { linkedGitHubId } from "@/lib/github-account";
import { currentUser } from "@/lib/session";
import { connect } from "./actions";

export const metadata: Metadata = { title: "Connect GitHub", robots: { index: false } };

const ERRORS: Record<string, string> = {
  adult: "Connecting GitHub is for people 18 or older. Tick the box to go on. Reports stay open to everyone.",
  taken: "That GitHub account is already connected to another Holt account. Sign in with that one instead.",
  link: "GitHub didn't confirm your account. Try again.",
  unavailable: "Connecting GitHub isn't set up on this server.",
  save: "That didn't connect. Try again in a minute.",
};

export default async function ConnectPage({ searchParams }: PageProps<"/connect">) {
  const user = await currentUser();
  if (!user) redirect("/signin?callbackUrl=/connect");
  const [sp, conn, githubId] = await Promise.all([searchParams, githubConnection(user.id), linkedGitHubId(user.id)]);
  if (conn.ok && conn.data.connected) redirect("/settings#github");
  const error = typeof sp.error === "string" ? ERRORS[sp.error] : undefined;
  const viaGitHub = !githubId;
  const canLink = oauthProviders.some((p) => p.id === "github");

  return (
    <PageTransition>
      <>
      <PageHead narrow>
        <p className="rail mb-4 flex gap-2"><strong className="m-0">connect</strong><span>free</span></p>
        <h1 className="display text-[clamp(2rem,6vw,3rem)]">Connect GitHub</h1>
        <p className="prose-sans mt-4 max-w-2xl text-[1rem]">
          See your public PRs, with Holt&apos;s verdict on each repo. Get picks based on where your PRs got merged. Free,
          and you can undo it any time.
        </p>
      </PageHead>
      <div className="wrap max-w-3xl pb-14 pt-2 sm:pb-16">
        {error && <p role="alert" className="mt-6 border border-orange/50 bg-orange/10 px-4 py-3 font-sans text-[0.9rem] text-orange">{error}</p>}

        <form action={connect} className="mt-8 border border-line-strong bg-panel p-5 shadow-soft sm:p-8">
          <ul className="prose-sans list-disc space-y-1.5 pl-5 text-[0.95rem]">
            <li>Holt reads only <strong>public</strong> data about your account, with its own access. It can&apos;t touch your repos and never posts, comments or opens anything as you.</li>
            {viaGitHub && <li>GitHub asks you once to confirm which account is yours. Holt gets what GitHub sign-in gets: your public profile and email.</li>}
            <li>Disconnect any time in settings. That deletes the connection and the list of repos you viewed here.</li>
          </ul>

          <p className="mt-6 border-l-2 border-blue pl-4 text-[0.95rem] font-semibold">{STATS_NOTICE}</p>

          <fieldset className="mt-6 space-y-3">
            <legend className="sr-only">Your choices</legend>
            <label className="flex min-h-11 cursor-pointer items-start gap-3 text-[0.95rem]">
              <input type="checkbox" name="stats_opt_out" className="mt-1 size-4 accent-blue" />
              <span>
                <strong>Don&apos;t include me in statistics</strong>
                <span className="block text-[0.85rem] text-muted">Your contributions stay out of every repo&apos;s numbers. You can change this later in settings.</span>
              </span>
            </label>
            <label className="flex min-h-11 cursor-pointer items-start gap-3 text-[0.95rem]">
              <input type="checkbox" name="adult" required className="mt-1 size-4 accent-blue" />
              <span><strong>I&apos;m 18 or older</strong></span>
            </label>
          </fieldset>

          <div className="mt-7 flex flex-wrap items-center gap-4">
            <button type="submit" className="btn-primary" disabled={viaGitHub && !canLink}>
              {viaGitHub ? "continue to GitHub" : "connect my GitHub account"}
            </button>
            <Link href="/settings" className="text-[0.85rem] text-muted hover:text-ink">not now</Link>
          </div>
          {viaGitHub && !canLink && <p className="mt-3 font-sans text-[0.85rem] text-faint">{ERRORS.unavailable}</p>}
          <p className="mt-6 font-sans text-[0.8rem] text-faint">
            Details: <Link href="/privacy#connect-github" className="text-link">what Holt keeps when you connect GitHub</Link>.
          </p>
        </form>
      </div>
      </>
    </PageTransition>
  );
}
