"use client";

// The AI tab's first step: choose a model, then run the usual AI analysis.
import Link from "next/link";
import { useState } from "react";
import { availability, initialModel, MODELS, type ModelAccess } from "@/lib/models";
import { shortDate } from "@/lib/format";
import type { Credits, Mode } from "@/lib/types";
import { AnalysisRunner } from "./analysis-runner";

const ACCESS_NOTE: Record<ModelAccess["kind"], string> = {
  free: "Pro models need a plan.",
  plan: "Every model is included in your plan.",
};

/** "N free AI reports left", and what to do when there are none. */
function creditsNote(c: Credits): string {
  if (!c.ai_available) return "AI reports aren't switched on yet. Your free ones will be waiting when they are.";
  const left = `${c.balance} free AI report${c.balance === 1 ? "" : "s"} left.`;
  if (c.balance > 0) return `${left} Writing this one uses 1; a report that fails doesn't count.`;
  if (c.can_claim) return `${left} You can claim 1 more in your settings now.`;
  return `${left} You can claim 1 more${c.next_claim_at ? ` on ${shortDate(c.next_claim_at)}` : " each week"}.`;
}

export function AiStart({ repo, days, signedIn, access, credits, requested }: { repo: string; days: number; signedIn: boolean; access: ModelAccess; credits: Credits | null; requested?: string }) {
  const [model, setModel] = useState(() => initialModel(access, requested));
  const [started, setStarted] = useState(false);
  // Only a hint for the button: the server checks and spends the credit.
  const blocked = credits != null && (!credits.ai_available || credits.balance <= 0);

  if (started) return <AnalysisRunner repo={repo} mode={"ai" as Mode} days={days} signedIn={signedIn} model={model} />;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setStarted(true);
      }}
      className="border border-line-strong bg-panel p-5 shadow-card sm:p-8"
      data-model-picker
    >
      <p className="text-[0.72rem] uppercase tracking-[0.08em] text-blue">AI report · {repo}</p>
      <h1 className="mt-2 text-[1.6rem] font-semibold tracking-tight sm:text-[2rem]">Pick a model to write it</h1>
      <p className="mt-2 max-w-2xl font-sans text-muted">
        The verdict comes from the same fixed rules whichever you choose. The model only changes how the evidence is
        explained. {ACCESS_NOTE[access.kind]}
      </p>
      {credits && (
        <p className={`mt-3 max-w-2xl border px-3 py-2 font-sans text-[0.9rem] ${blocked ? "border-orange/50 text-orange" : "border-green/50 text-green"}`} data-credits>
          {creditsNote(credits)}
          {blocked && credits.ai_available && credits.can_claim && (
            <>
              {" "}
              <Link href="/settings" className="text-link">claim it</Link>
            </>
          )}
        </p>
      )}

      <fieldset className="mt-6">
        <legend className="sr-only">Model</legend>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {MODELS.map((m) => {
            const a = availability(m, access);
            const locked = !a.ok;
            const checked = model === m.id;
            return (
              <label
                key={m.id}
                className={`relative flex flex-col border p-4 transition-colors ${
                  locked
                    ? "cursor-not-allowed border-dashed border-line-strong opacity-75"
                    : "cursor-pointer border-line-strong bg-bg hover:border-blue has-[:checked]:border-blue has-[:checked]:bg-blue/10 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-blue"
                }`}
              >
                <input
                  type="radio"
                  name="model"
                  value={m.id}
                  checked={checked}
                  disabled={locked}
                  onChange={() => setModel(m.id)}
                  className="sr-only"
                />
                <span className="flex items-start justify-between gap-2">
                  <span>
                    <span className="block font-semibold text-ink">{m.label}</span>
                    <span className="block text-[0.72rem] text-faint">{m.vendor}</span>
                  </span>
                  <span
                    className={`shrink-0 rounded-full border px-2 py-0.5 text-[0.66rem] uppercase tracking-[0.06em] ${
                      m.tier === "free" ? "border-green/50 text-green" : "border-blue/50 text-blue"
                    }`}
                  >
                    {m.tier}
                  </span>
                </span>
                <span className="mt-2 flex-1 font-sans text-[0.88rem] text-muted">{m.goodAt}</span>
                <span className="mt-3 flex items-center justify-between gap-2 text-[0.72rem]">
                  <span className="text-faint">{m.credits == null ? "credits: TBD" : `${m.credits} credits`}</span>
                  {locked ? (
                    <span className="inline-flex items-center gap-1 text-blue">
                      <svg className="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                        <rect x="5" y="11" width="14" height="10" rx="2" />
                        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                      </svg>
                      upgrade to use
                    </span>
                  ) : checked ? (
                    <span className="text-blue">✓ selected</span>
                  ) : null}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
        <button type="submit" className="btn-primary bg-blue disabled:cursor-not-allowed disabled:opacity-50" disabled={blocked}>
          write my AI report <span aria-hidden="true">→</span>
        </button>
        {access.kind === "free" && (
          <span className="font-sans text-[0.85rem] text-muted">
            Want the pro models? <Link href="/pricing#compare" className="text-link">see plans</Link>.
          </span>
        )}
      </div>
    </form>
  );
}
