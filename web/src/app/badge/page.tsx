import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BadgeLive } from "@/components/badge/badge-live";
import { BadgeResult } from "@/components/badge/badge-result";
import { PageTransition } from "@/components/motion/page-transition";
import { PageHead } from "@/components/page-head";
import { getReport } from "@/lib/api";
import { parseRepoInput } from "@/lib/repo";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Get a badge",
  description: "Maintainers: show newcomers your repo replies to and merges their PRs, with a Holt badge in your README.",
  alternates: { canonical: "/badge" },
};

export default async function BadgePage({ searchParams }: PageProps<"/badge">) {
  const sp = await searchParams;
  const raw = typeof sp.repo === "string" ? sp.repo : "";
  const ref = raw ? parseRepoInput(raw) : null;
  const name = ref && `${ref.owner}/${ref.repo}`;
  // Keep the URL tidy and shareable: whatever was pasted becomes owner/repo.
  if (name && raw !== name) redirect(`/badge?repo=${name}`);
  const report = name ? await getReport(name) : null;
  if (report?.ok && name && report.data.repo !== name) redirect(`/badge?repo=${report.data.repo}`);

  return (
    <PageTransition>
      <>
        <PageHead narrow>
          <p className="rail mb-4 flex gap-2"><strong className="m-0">badge</strong><span>for maintainers</span></p>
          <h1 className="display max-w-3xl text-[clamp(2rem,6vw,3.4rem)]">Show newcomers they&apos;re welcome.</h1>
          <p className="prose-sans mt-5 max-w-2xl text-[1.05rem]">
            Paste your repo. If outsiders get replies and get merged, you get a README badge that says so.
          </p>
          <p className="mt-3 inline-flex overflow-hidden rounded-[3px] text-[0.75rem] leading-5 text-white" style={{ fontFamily: "Verdana,Geneva,DejaVu Sans,sans-serif" }}>
            <span className="bg-[#555] px-1.5">Holt</span>
            <span className="bg-[#1a7f37] px-1.5">merges outsiders · replies in ~6h</span>
          </p>
          <form action="/badge" method="get" className="mt-8 grid max-w-2xl grid-cols-[1fr_auto] border border-line-strong bg-panel shadow-soft focus-within:border-blue">
            <label htmlFor="repo" className="sr-only">Your repo</label>
            <input
              id="repo"
              name="repo"
              defaultValue={name ?? raw}
              placeholder="owner/name or GitHub URL"
              required
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              className="h-14 min-w-0 bg-transparent px-4 text-ink outline-none placeholder:text-faint"
            />
            <button type="submit" className="btn-primary m-1.5">check</button>
          </form>
          {raw && !name && (
            <p role="alert" className="mt-3 font-sans text-[0.9rem] text-orange">
              That doesn&apos;t look like a repo. Try <span className="font-mono">owner/name</span>.
            </p>
          )}
        </PageHead>

        <div className="wrap max-w-3xl py-10 sm:py-12">
          {!name ? (
            <div className="space-y-4 font-sans text-[0.95rem] text-muted">
              <p>
                Holt checks your recent PRs the way a newcomer would: do outsiders get a reply, and does their work get merged?
                You only get a badge when the answer is yes.
              </p>
              <p>
                It never shows red. If things change, it turns grey and says &ldquo;see report&rdquo;.{" "}
                <Link href="/how-it-works" className="text-link">The rules</Link> are the same for every repo.
              </p>
            </div>
          ) : report?.ok ? (
            <BadgeResult report={report.data} site={SITE_URL} />
          ) : report?.error.code === "not_found" ? (
            <BadgeLive key={name} repo={name} site={SITE_URL} />
          ) : (
            <p role="alert" className="panel p-5 font-sans text-[0.92rem] text-orange">{report?.error.message}</p>
          )}
        </div>
      </>
    </PageTransition>
  );
}
