"use client";

// The AI tab: this user's merge plan for the repo (API.md, Merge plan). It
// loads its own state, follows a plan being made, and offers to make one. The
// server checks and charges; the button is only a hint.
import Link from "next/link";
import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import { MergePlanView } from "@/components/merge-plan/merge-plan-view";
import { failedMessage, leftLabel, planOffer } from "@/lib/merge-plan-offer";
import type { ApiError, MergePlan, MergePlanState } from "@/lib/types";

type Run =
  | { phase: "idle" }
  | { phase: "running"; stage: string; progress: number }
  // `failed`: a plan was being made and failed (its use is given back), not a refused request.
  | { phase: "error"; error: ApiError; failed: boolean };

const LOST: ApiError = { code: "upstream", message: "We lost the connection while your plan was being made. It may still finish, so reload in a minute." };
const FAILED: ApiError = { code: "upstream", message: "Something broke on our side. Try again in a minute." };

export function MergePlanPanel({ repo }: { repo: string }) {
  const [s, setS] = useState<MergePlanState | null>(null);
  const [plan, setPlan] = useState<MergePlan | null>(null);
  const [run, setRun] = useState<Run>({ phase: "idle" });
  const es = useRef<EventSource | null>(null);

  // After a plan is made or fails: what is left of the allowance changed.
  const load = useCallback(async () => {
    const body: MergePlanState | null = await fetch(`/api/merge-plan/${repo}`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    if (body) setS(body);
  }, [repo]);

  const follow = useCallback((jobId: string) => {
    es.current?.close();
    setRun({ phase: "running", stage: "Getting in line", progress: 0.02 });
    const src = new EventSource(`/api/merge-plan-jobs/${encodeURIComponent(jobId)}/events`);
    es.current = src;
    src.addEventListener("stage", (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      setRun({ phase: "running", stage: d.stage, progress: d.progress ?? 0 });
    });
    src.addEventListener("done", (e) => {
      src.close();
      const p = JSON.parse((e as MessageEvent).data).plan as MergePlan;
      startTransition(() => {
        setPlan(p);
        setRun({ phase: "idle" });
      });
      void load();
    });
    src.addEventListener("error", (e) => {
      const data = (e as MessageEvent).data;
      src.close();
      let error = LOST;
      if (data) {
        try {
          error = JSON.parse(data).error ?? LOST;
        } catch {}
      }
      setRun({ phase: "error", error, failed: true });
      void load();
    });
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/merge-plan/${repo}`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((body: MergePlanState | null) => {
        if (cancelled || !body) return;
        setS(body);
        if (body.plan) setPlan(body.plan);
        if (body.job) follow(body.job.job_id);
      });
    return () => {
      cancelled = true;
      es.current?.close();
    };
  }, [repo, follow]);

  const make = useCallback(async () => {
    setRun({ phase: "running", stage: "Starting", progress: 0.01 });
    let res: Response;
    try {
      res = await fetch(`/api/merge-plan/${repo}`, { method: "POST" });
    } catch {
      setRun({ phase: "error", error: LOST, failed: false });
      return;
    }
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setRun({ phase: "error", error: body?.error ?? FAILED, failed: false });
      void load();
      return;
    }
    follow(body.job_id);
  }, [repo, follow, load]);

  if (!s) return <div className="h-64 animate-pulse border border-line-strong bg-panel" aria-busy="true" data-merge-plan-loading />;

  const offer = planOffer(s);
  const running = run.phase === "running";
  const failed = run.phase === "error" && run.failed;
  const actions = running ? (
    <Making stage={run.stage} progress={run.progress} />
  ) : offer.kind === "off" ? (
    !plan && <p className="mt-3 font-sans text-muted" data-merge-plan-off>Merge plans aren&apos;t available yet.</p>
  ) : offer.kind === "locked" ? (
    <p className="mt-5 font-sans text-muted" data-merge-plan-locked>
      {offer.message} <Link href="/pricing" className="text-link">See Pro</Link>
    </p>
  ) : (
    <div className="mt-6 flex flex-wrap items-center gap-3">
      <button type="button" onClick={make} className={plan ? "text-link text-[0.9rem]" : "btn-primary bg-blue"} data-merge-plan-make>
        {plan ? "make a new one" : failed ? "try again" : "make my merge plan"} <span aria-hidden="true">→</span>
      </button>
      {leftLabel(offer.left) && <span className="text-[0.82rem] text-faint">{leftLabel(offer.left)}</span>}
    </div>
  );
  const error = run.phase === "error" && (
    <p role="alert" className="mt-4 border border-orange/50 px-3 py-2 font-sans text-[0.9rem] text-orange" data-merge-plan-error>
      {run.failed ? failedMessage(run.error.message) : run.error.message}
    </p>
  );

  if (plan && !running) {
    return (
      <div data-merge-plan-panel>
        <MergePlanView plan={plan} />
        {(actions || error) && (
          <div className="mt-10 border-t border-line-strong pt-2">
            {actions}
            {error}
          </div>
        )}
      </div>
    );
  }

  return (
    <section aria-labelledby="merge-plan" className="border border-line-strong bg-panel p-5 shadow-card sm:p-8" data-merge-plan-panel>
      <p className="text-[0.8rem] uppercase tracking-[0.08em] text-blue">Merge plan ✦ · {s.repo}</p>
      <h1 id="merge-plan" className="mt-2 text-[1.6rem] font-semibold tracking-tight sm:text-[2rem]">
        {failed ? "Your merge plan couldn't be made" : "Your merge plan"}
      </h1>
      {error}
      {actions}
    </section>
  );
}

function Making({ stage, progress }: { stage: string; progress: number }) {
  return (
    <div className="mt-5" data-merge-plan-making>
      <p className="font-sans text-muted">{stage}…</p>
      <div className="mt-3 h-1 w-full max-w-md bg-line-strong" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
        <div className="h-full bg-blue transition-[width] duration-500" style={{ width: `${Math.max(2, Math.round(progress * 100))}%` }} />
      </div>
    </div>
  );
}
