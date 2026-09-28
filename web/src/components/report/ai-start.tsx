"use client";

// The AI tab's first step: say what the AI report is, then run the usual AI analysis.
// The model is server configuration, so there is nothing to choose here.
import Link from "next/link";
import { useState } from "react";
import { EXAMPLE_PATH } from "@/lib/example-report";
import { creditsNote } from "@/lib/format";
import type { Credits, Mode } from "@/lib/types";
import { AnalysisRunner } from "./analysis-runner";

/** What the AI report adds, in the order it appears. Only what it actually delivers. */
const WHAT_YOU_GET = [
  "A short written explanation of the verdict: the bottom line, what the evidence shows, and what couldn't be worked out.",
  "Up to about a dozen pull requests from outside contributors, each with a quote from the thread and a link to it. Every quote is checked against the thread and comes from the project's team.",
  "What kind of project this is, and whether its contributing guide is a real way in for a newcomer.",
];

export function AiStart({ repo, days, signedIn, credits }: { repo: string; days: number; signedIn: boolean; credits: Credits | null }) {
  const [started, setStarted] = useState(false);
  // Only a hint for the button: the server checks and spends the credit.
  const blocked = credits != null && (!credits.ai_available || credits.balance <= 0);

  if (started) return <AnalysisRunner repo={repo} mode={"ai" as Mode} days={days} signedIn={signedIn} />;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setStarted(true);
      }}
      className="border border-line-strong bg-panel p-5 shadow-card sm:p-8"
      data-ai-start
    >
      <p className="text-[0.72rem] uppercase tracking-[0.08em] text-blue">AI report · {repo}</p>
      <h1 className="mt-2 text-[1.6rem] font-semibold tracking-tight sm:text-[2rem]">Get the AI-written report</h1>
      <p className="mt-2 max-w-2xl font-sans text-muted">
        An AI reads the pull-request conversations and explains the verdict in plain English. The verdict itself comes
        from fixed rules, and the AI can&apos;t choose it.
      </p>
      <ul className="mt-4 max-w-2xl space-y-2 font-sans text-[0.95rem] text-ink" data-ai-includes>
        {WHAT_YOU_GET.map((line) => (
          <li key={line} className="flex gap-3">
            <span aria-hidden="true" className="text-blue">✦</span>
            <span>{line}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 font-sans text-[0.9rem] text-muted" data-ai-example-link>
        Want to see one first?{" "}
        <Link href={EXAMPLE_PATH} className="text-link">Read an example AI report</Link>. It&apos;s free and doesn&apos;t use a credit.
      </p>
      {credits && (
        <p className={`mt-5 max-w-2xl border px-3 py-2 font-sans text-[0.9rem] ${blocked ? "border-orange/50 text-orange" : "border-green/50 text-green"}`} data-credits>
          {creditsNote(credits)}
          {blocked && credits.ai_available && credits.can_claim && (
            <>
              {" "}
              <Link href="/settings" className="text-link">claim it</Link>
            </>
          )}
        </p>
      )}

      <div className="mt-6">
        <button type="submit" className="btn-primary bg-blue disabled:cursor-not-allowed disabled:opacity-50" disabled={blocked} data-ai-start-button>
          write my AI report <span aria-hidden="true">→</span>
        </button>
      </div>
    </form>
  );
}
