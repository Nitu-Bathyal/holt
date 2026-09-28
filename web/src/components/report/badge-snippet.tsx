import Link from "next/link";
import { badgeSnippets } from "@/lib/badge";
import { SITE_URL } from "@/lib/site";
import { CopyButton } from "../copy-button";

/** On a report: the README badge for a passing repo, or where to see what would earn one. */
export function BadgeSnippet({ repo, offered }: { repo: string; offered: boolean }) {
  const more = `/badge?repo=${repo}`;
  if (!offered) {
    return (
      <p className="text-[0.92rem] text-muted">
        Maintainer? <Link href={more} className="text-link">See what earns a Holt badge</Link>
      </p>
    );
  }
  const { markdown } = badgeSnippets(SITE_URL, repo);
  return (
    <details className="group text-[0.92rem]">
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 text-muted hover:text-ink [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="inline-block transition-transform group-open:rotate-90">›</span>
        Maintainer? Add a badge to your README
      </summary>
      <div className="mt-2 rounded-2xl border border-line bg-panel p-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/badge/${repo}.svg`} alt="Holt badge preview" height={20} className="h-5 w-auto" loading="lazy" />
        <div className="mt-3 grid grid-cols-[1fr_auto] overflow-hidden rounded-xl border border-line bg-bg">
          <code className="min-w-0 overflow-x-auto whitespace-nowrap px-3 py-2.5 text-[0.8rem] text-muted">{markdown}</code>
          <CopyButton text={markdown} label="copy" className="border-l border-line px-3 text-[0.85rem] text-muted transition-colors hover:text-ink" />
        </div>
        <p className="mt-2 text-[0.86rem] text-faint">
          It updates when the report does. <Link href={more} className="text-link">HTML and more</Link>
        </p>
      </div>
    </details>
  );
}
