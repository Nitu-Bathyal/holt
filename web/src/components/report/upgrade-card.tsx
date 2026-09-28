import Link from "next/link";
import { EXAMPLE_PATH } from "@/lib/example-report";
import { WELCOME_AI_CREDITS } from "@/lib/site";

export function UpgradeCard({ repo, signedIn }: { repo: string; signedIn: boolean }) {
  const aiHref = `/${repo}?mode=ai`;
  const href = signedIn ? aiHref : `/signin?callbackUrl=${encodeURIComponent(aiHref)}`;
  return (
    <div className="relative overflow-hidden border border-blue/50 bg-blue/[0.06] p-5 sm:p-6">
      <p className="text-[0.72rem] uppercase tracking-[0.08em] text-blue">AI report</p>
      <h3 className="mt-1 text-[1.15rem] font-semibold tracking-tight">Want the verdict explained in writing?</h3>
      <p className="mt-2 font-sans text-[0.92rem] text-muted">
        An AI reads the pull-request conversations and explains this verdict in plain English, with quotes from
        outside contributors&apos; threads, each checked and linked. It can&apos;t change the verdict.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Link href={href} prefetch={false} className="btn-primary bg-blue">
          upgrade to AI report <span aria-hidden="true">→</span>
        </Link>
        <span className="text-[0.75rem] text-faint">
          {signedIn ? "uses 1 of your free AI reports" : `sign in for ${WELCOME_AI_CREDITS} free AI reports`}
        </span>
      </div>
      <p className="mt-3 font-sans text-[0.85rem] text-muted">
        Not sure yet? <Link href={EXAMPLE_PATH} className="text-link">Read an example AI report</Link>, free.
      </p>
    </div>
  );
}
