// PR pre-flight for the mock API (MOCK_API=1): every target gets the example
// result (retitled for it) after a short fake job. Each mock user has
// MOCK_PREFLIGHT_CREDITS checks (default 3); after that the page shows the
// "coming soon" state. MOCK_PRO_OFF=1 turns pre-flight off, as on a server
// without paid features.
import "server-only";
import { EXAMPLE_PREFLIGHT } from "../preflight-example";
import type { Access, ApiError, Preflight, PreflightFor, PreflightStart, PreflightState, Result } from "../types";

const JOB_MS = Number(process.env.MOCK_PREFLIGHT_MS || 3500);
const CREDITS = Number(process.env.MOCK_PREFLIGHT_CREDITS || 3);

interface MockJob {
  id: string;
  userId: string;
  key: string;
  target: PreflightFor;
  started: number;
}

interface MockState {
  left: Map<string, number>;
  results: Map<string, Preflight>;
  jobs: Map<string, MockJob>;
}

const g = globalThis as unknown as { holtMockPreflight?: MockState };
const state = (): MockState => (g.holtMockPreflight ??= { left: new Map(), results: new Map(), jobs: new Map() });

function err(status: number, code: ApiError["code"], message: string) {
  return { ok: false as const, status, error: { code, message } };
}

function parse(q: { pr?: string | null; repo?: string | null; branch?: string | null; base?: string | null }): PreflightFor | null | "bad" {
  const pr = q.pr?.trim();
  if (pr) {
    const m = /github\.com\/([^/\s]+\/[^/\s]+)\/pull\/(\d+)/.exec(pr) ?? /^([^/\s]+\/[^/\s#]+)#(\d+)$/.exec(pr);
    return m ? { repo: m[1], number: Number(m[2]), branch: null, base: null } : "bad";
  }
  if (q.repo?.trim() && q.branch?.trim()) return { repo: q.repo.trim(), number: null, branch: q.branch.trim(), base: q.base?.trim() || null };
  if (q.repo || q.branch) return "bad";
  return null;
}

const keyOf = (userId: string, t: PreflightFor) => `${userId}|${t.repo.toLowerCase()}|${t.number ?? `${t.branch}...${t.base ?? ""}`}`;

function access(userId: string): Access {
  const left = state().left.get(userId) ?? CREDITS;
  return left > 0
    ? { feature: "preflight", name: "PR pre-flight check", allowed: true, via: "credits", cost: 1, left_this_month: null, left: null, code: null, message: null }
    : { feature: "preflight", name: "PR pre-flight check", allowed: false, via: null, cost: 1, left_this_month: null, left: null, code: "quota_exceeded", message: "PR pre-flight check costs 1 credit, and you don't have enough purchased credits." };
}

function resultFor(t: PreflightFor): Preflight {
  const e = structuredClone(EXAMPLE_PREFLIGHT);
  e.repo = t.repo;
  e.checked_at = new Date().toISOString();
  e.target = t.number != null
    ? { ...e.target, number: t.number, url: `https://github.com/${t.repo}/pull/${t.number}` }
    : { ...e.target, kind: "branch", number: null, state: null, outside: null, title: null, head: t.branch, base: t.base ?? "main", url: `https://github.com/${t.repo}/compare/${t.base ?? "main"}...${t.branch}` };
  return e;
}

function progress(job: MockJob) {
  const p = Math.min(0.97, (Date.now() - job.started) / JOB_MS);
  return { stage: p < 0.4 ? "Reading the pull request and what gets merged here" : "Comparing it with merged pull requests", progress: Math.max(0.05, p) };
}

export async function preflightState(q: { pr?: string | null; repo?: string | null; branch?: string | null; base?: string | null }, userId?: string): Promise<Result<PreflightState>> {
  const t = parse(q);
  if (t === "bad") return err(400, "invalid_request", "That doesn't look like a pull request link. Paste one like https://github.com/owner/repo/pull/123, or pick a repository and a branch.");
  if (process.env.MOCK_PRO_OFF === "1") return { ok: true, data: { available: false, on_sale: false, access: null, target: t, result: null, job: null } };
  const s = state();
  let result: Preflight | null = null;
  let job: PreflightState["job"] = null;
  if (userId && t) {
    const k = keyOf(userId, t);
    result = s.results.get(k) ?? null;
    const running = [...s.jobs.values()].find((j) => j.key === k);
    if (running) job = { job_id: running.id, status: "running", ...progress(running) };
  }
  return { ok: true, data: { available: true, on_sale: false, access: userId ? access(userId) : null, target: t, result, job } };
}

export async function startPreflight(body: { pr_url?: string; repo?: string; branch?: string; base?: string; summary: boolean }, userId: string): Promise<Result<PreflightStart>> {
  if (process.env.MOCK_PRO_OFF === "1") return err(501, "not_implemented", "This feature isn't available yet.");
  const t = parse({ pr: body.pr_url, repo: body.repo, branch: body.branch, base: body.base });
  if (!t || t === "bad") return err(400, "invalid_request", "Paste a pull request link, or pick a repository and a branch.");
  if (t.repo.toLowerCase().startsWith("doesnotexist/")) return err(404, "not_found", `We couldn't find ${t.repo} on GitHub. Check the spelling; private repositories can't be checked.`);
  const s = state();
  const key = keyOf(userId, t);
  const running = [...s.jobs.values()].find((j) => j.key === key);
  if (running) return { ok: true, data: { status: "queued", job_id: running.id } };
  const a = access(userId);
  if (!a.allowed) return err(402, "quota_exceeded", a.message ?? "");
  s.left.set(userId, (s.left.get(userId) ?? CREDITS) - 1);
  const id = `pf${Math.random().toString(36).slice(2, 12)}`;
  s.jobs.set(id, { id, userId, key, target: t, started: Date.now() });
  return { ok: true, data: { status: "queued", job_id: id } };
}

function sse(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function preflightEvents(id: string, signal: AbortSignal): Response {
  const job = state().jobs.get(id);
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (!job) {
        controller.enqueue(enc.encode(sse("error", { error: { code: "not_found", message: "We couldn't find that check. It may have expired." } })));
        controller.close();
        return;
      }
      const tick = () => {
        if (signal.aborted) return controller.close();
        if (Date.now() - job.started >= JOB_MS) {
          const s = state();
          s.jobs.delete(id);
          if (job.target.repo.toLowerCase().startsWith("broken/")) {
            s.left.set(job.userId, (s.left.get(job.userId) ?? 0) + 1);
            controller.enqueue(enc.encode(sse("error", { error: { code: "upstream", message: "GitHub didn't answer properly, so the check couldn't run. Please try again in a few minutes. You weren't charged for it." } })));
          } else {
            const result = resultFor(job.target);
            s.results.set(job.key, result);
            controller.enqueue(enc.encode(sse("done", { preflight: result })));
          }
          return controller.close();
        }
        controller.enqueue(enc.encode(sse("stage", progress(job))));
        setTimeout(tick, 400);
      };
      tick();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
}
