// The way between a repo's report and its AI report: one small button in the
// report header, beside Save. On the report it offers the AI report; on the AI
// report it leads back. The report page and the example AI report both draw it.
import Link from "next/link";
import { LinkHint } from "../motion/link-hint";

const BASE = "relative inline-flex min-h-11 shrink-0 items-center gap-1.5 border px-3 text-[0.82rem] font-medium transition-colors sm:min-h-9";

/** `mode` is the page being shown; the button goes to the other one. No prefetch: for most visitors the AI report is sign-in. */
export function ReportModeLink({ mode, rulesHref, aiHref, hint = false }: { mode: "rules" | "ai"; rulesHref: string; aiHref: string; hint?: boolean }) {
  return mode === "rules" ? (
    <Link href={aiHref} prefetch={false} className={`${BASE} border-blue/60 text-blue hover:bg-blue hover:text-on-accent`} data-report-mode="ai">
      AI report <span aria-hidden="true">✦</span>
      {hint && <LinkHint />}
    </Link>
  ) : (
    <Link href={rulesHref} prefetch={false} className={`${BASE} border-line-strong text-muted hover:border-ink hover:text-ink`} data-report-mode="rules">
      <span aria-hidden="true">←</span> Report
      {hint && <LinkHint />}
    </Link>
  );
}
