import Link from "next/link";
import type { ApiError } from "@/lib/types";
import { CatFace } from "./cat-face";
import { errorHeading } from "@/lib/error-heading";

export function ErrorPanel({ error, repo, onRetry, retryHref }: { error: ApiError; repo?: string; onRetry?: () => void; retryHref?: string }) {
  const account = error.code === "quota_exceeded" || error.code === "ai_unavailable";
  return (
    <div role="alert" className="border border-line-strong bg-panel p-6 shadow-soft sm:p-8">
      <CatFace mood={account ? "determined" : "startled"} className="text-[1.75rem]" />
      <h2 className="mt-4 text-[1.375rem] font-semibold tracking-tight">{errorHeading(error)}</h2>
      <p className="mt-2 max-w-xl font-sans text-muted">
        {error.message}
        {error.code === "rate_limited" && error.retry_after ? ` Try again in about ${Math.ceil(error.retry_after / 60)} minute${error.retry_after > 60 ? "s" : ""}.` : ""}
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        {account && (
          <>
            {repo && <Link href={`/${repo}`} className="btn-primary">back to the free report</Link>}
            {error.code === "quota_exceeded" && <Link href="/settings/ai-reports" className="btn-ghost">claim a free AI report</Link>}
          </>
        )}
        {(error.code === "unauthorized" || error.code === "needs_key") && (
          <Link href={`/signin${repo ? `?callbackUrl=${encodeURIComponent(`/${repo}?mode=ai`)}` : ""}`} className="btn-primary">sign in</Link>
        )}
        {(error.code === "upstream" || error.code === "internal" || error.code === "rate_limited") &&
          (onRetry ? (
            <button type="button" onClick={onRetry} className="btn-primary">try again</button>
          ) : (
            <a href={retryHref ?? (repo ? `/${repo}` : "/")} className="btn-primary">try again</a>
          ))}
        {(error.code === "not_found" || error.code === "invalid_repo") && (
          <Link href="/" className="btn-primary">check a different repo</Link>
        )}
      </div>
    </div>
  );
}
