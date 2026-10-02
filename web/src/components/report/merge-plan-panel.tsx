"use client";

// The merge plan page: this user's merge plan for the repo (API.md, Merge plan). It
// loads its own state, follows a plan being made, and offers to make one. The
// server checks and charges; the button is only a hint.
import Link from "next/link";
import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import { MergePlanView } from "@/components/merge-plan/merge-plan-view";
import { PlanProgress } from "@/components/merge-plan/plan-progress";
import { ComingSoon } from "@/components/coming-soon";
import { failedMessage, leftLabel, planOffer, planTag } from "@/lib/merge-plan-offer";
import { EXAMPLE_PATH } from "@/lib/example-report";
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
    <PlanProgress repo={repo} stage={run.stage} progress={run.progress} />
  ) : offer.kind === "off" ? (
    !plan && (
      <div className="mt-3 max-w-3xl font-sans" data-merge-plan-off>
        <p className="text-[1rem] leading-snug text-muted sm:text-[1.05rem]">
          Holt reads this repo&apos;s pull request threads and gives you a step-by-step plan for your first pull request: what gets merged, what gets
          closed and who reviews.
        </p>
        <Link href={EXAMPLE_PATH} className="text-link tap mt-4 inline-block text-[0.92rem]">
          see an example plan →
        </Link>
      </div>
    )
  ) : offer.kind === "locked" ? (
    <p className="mt-3 max-w-3xl font-sans text-[1rem] leading-snug text-muted sm:text-[1.05rem]" data-merge-plan-locked>
      {offer.message} <Link href="/pricing" className="text-link">See Pro</Link>
    </p>
  ) : (
    plan ? (
      // Under a plan already made: a quiet way to make it again.
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <button type="button" onClick={make} className="text-link tap text-[0.9rem]" data-merge-plan-make>
          make a new one <span aria-hidden="true">→</span>
        </button>
        {leftLabel(offer.left) && <span className="text-[0.82rem] text-faint">{leftLabel(offer.left)}</span>}
      </div>
    ) : (
      <div className="mt-3 max-w-3xl">
        {!failed && (
          <p className="font-sans text-[1rem] leading-snug text-muted sm:text-[1.05rem]">
            Holt reads this repo&apos;s pull request threads and gives you a step-by-step plan for your first pull request: what gets merged, what gets
            closed and who reviews.
          </p>
        )}
        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-3">
          <button type="button" onClick={make} className="btn-primary min-h-11 bg-blue px-5" data-merge-plan-make>
            {failed ? "try again" : "make my merge plan"} <span aria-hidden="true">→</span>
          </button>
          {leftLabel(offer.left) && (
            <span className="inline-flex min-h-8 items-center border border-line-strong px-2.5 text-[0.78rem] text-muted">
              <span className="mr-1 tabular-nums text-ink">{offer.left}</span> left
            </span>
          )}
          <Link href={EXAMPLE_PATH} className="text-link tap text-[0.88rem]">
            see an example
          </Link>
        </div>
        <p className="mt-3 text-[0.78rem] text-faint">A plan that fails doesn&apos;t count.</p>
      </div>
    )
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
    // Set like the report's verdict block (and the plan's own, merge-plan-view.tsx): a bar down the side, the label, the heading.
    <section aria-labelledby="merge-plan" className={`border-l-4 pl-4 sm:pl-6 ${failed ? "border-orange" : s.available ? "border-blue" : "border-line-strong"}`} data-merge-plan-panel>
      <p className="flex items-center gap-2 text-[0.76rem] uppercase tracking-[0.08em] text-faint">
        {planTag(s.available) === "pro" ? (
          <span className="border border-line-strong px-1.5 py-0.5 tracking-[0.12em] text-ink">pro</span>
        ) : (
          <ComingSoon small className="normal-case tracking-normal" />
        )}
        merge plan
      </p>
      <h1 id="merge-plan" className={`display mt-3 text-[1.6rem] leading-none sm:text-[2.25rem] ${failed ? "text-orange" : "text-ink"}`}>
        {failed ? "Your merge plan couldn't be made" : "Your merge plan"}
        <span className="text-blue">.</span>
      </h1>
      {error}
      {actions}
    </section>
  );
}
