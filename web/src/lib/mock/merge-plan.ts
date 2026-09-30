// The merge plan in the mock API (MOCK_API=1), following API.md's "Merge
// plan" section. `MOCK_PRO=0` switches it off. Each user has
// `MOCK_MERGE_PLANS` (default 3) to make, like the free plan; a repo named
// `*fail*` fails and gives the use back. A plan takes MOCK_MERGE_PLAN_MS (6 s).
import "server-only";
import type { Access, ApiError, MergePlan, MergePlanStart, MergePlanState, Result } from "../types";
import { canonicalName, isMockNotFound } from "./fixtures";

const JOB_MS = Number(process.env.MOCK_MERGE_PLAN_MS || 6000);
const FREE = Number(process.env.MOCK_MERGE_PLANS ?? 3);
const STAGES: [at: number, stage: string][] = [
  [0, "Reading the report and starter issues"],
  [0.1, "Reading the project's pull requests and reviews"],
  [0.6, "Checking every claim against its sources"],
];

interface Job {
  id: string;
  repo: string;
  user: string;
  started: number;
  done?: Result<MergePlan>;
}

interface State {
  plans: Map<string, MergePlan>;
  left: Map<string, number>;
  jobs: Map<string, Job>;
}

const g = globalThis as unknown as { holtMockMergePlan?: State };
function state(): State {
  g.holtMockMergePlan ??= { plans: new Map(), left: new Map(), jobs: new Map() };
  return g.holtMockMergePlan;
}

const on = () => process.env.MOCK_PRO !== "0";
const key = (user: string, repo: string) => `${user}|${repo.toLowerCase()}`;
const left = (user: string) => state().left.get(user) ?? FREE;

function err<T>(status: number, code: ApiError["code"], message: string): Result<T> {
  return { ok: false, status, error: { code, message } };
}

function access(user: string): Access {
  const n = left(user);
  const base = { feature: "merge_plan", name: "Merge plan", cost: 0, left_this_month: null, left: n };
  if (n > 0) return { ...base, allowed: true, via: "plan", code: null, message: null };
  return { ...base, allowed: false, via: null, code: "quota_exceeded", message: "You've used your free merge plans." };
}

function progressOf(job: Job) {
  const p = Math.min(1, (Date.now() - job.started) / JOB_MS);
  let stage = STAGES[0][1];
  for (const [at, name] of STAGES) if (p >= at) stage = name;
  return { p, stage };
}

function finish(job: Job): Result<MergePlan> {
  if (job.done) return job.done;
  const s = state();
  if (/fail/i.test(job.repo)) {
    s.left.set(job.user, left(job.user) + 1);
    job.done = err(502, "upstream", "GitHub or the AI didn't answer properly, so the merge plan couldn't be made. Please try again later. It didn't count against your merge plans.");
  } else {
    const plan = sample(job.repo);
    s.plans.set(key(job.user, job.repo), plan);
    job.done = { ok: true, data: plan };
  }
  return job.done;
}

function activeJob(user: string, repo: string): Job | undefined {
  return [...state().jobs.values()].find((j) => j.user === user && j.repo.toLowerCase() === repo.toLowerCase() && !j.done && progressOf(j).p < 1);
}

export async function mergePlanState(repoIn: string, userId?: string): Promise<Result<MergePlanState>> {
  const repo = canonicalName(repoIn);
  if (!userId) return { ok: true, data: { repo, available: on(), access: null, plan: null, job: null } };
  const running = on() ? activeJob(userId, repo) : undefined;
  if (!running) for (const j of state().jobs.values()) if (j.user === userId && progressOf(j).p >= 1) finish(j);
  return {
    ok: true,
    data: {
      repo,
      available: on(),
      access: on() ? access(userId) : null,
      plan: state().plans.get(key(userId, repo)) ?? null,
      job: running ? { job_id: running.id, status: "running", stage: progressOf(running).stage, progress: progressOf(running).p } : null,
    },
  };
}

export async function startMergePlan(repoIn: string, userId: string): Promise<Result<MergePlanStart>> {
  if (!on()) return err(501, "not_implemented", "This feature isn't available yet.");
  if (isMockNotFound(repoIn)) return err(404, "not_found", `We couldn't find ${repoIn} on GitHub. Check the spelling; private repositories can't be checked.`);
  const repo = canonicalName(repoIn);
  const running = activeJob(userId, repo);
  if (running) return { ok: true, data: { status: "queued", job_id: running.id } };
  const a = access(userId);
  if (!a.allowed) return err(402, "quota_exceeded", a.message ?? "");
  state().left.set(userId, left(userId) - 1);
  const id = `mpjob_${crypto.randomUUID().slice(0, 12)}`;
  state().jobs.set(id, { id, repo, user: userId, started: Date.now() });
  return { ok: true, data: { status: "queued", job_id: id } };
}

const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

export function mergePlanEvents(id: string, signal: AbortSignal): Response {
  const job = state().jobs.get(id);
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (!job) {
        controller.enqueue(enc.encode(sse("error", { error: { code: "not_found", message: "We couldn't find that check. It may have expired." } })));
        controller.close();
        return;
      }
      let last = "";
      const tick = () => {
        if (signal.aborted) return;
        const { p, stage } = progressOf(job);
        if (p >= 1) {
          const r = finish(job);
          controller.enqueue(enc.encode(r.ok ? sse("done", { plan: r.data }) : sse("error", { error: r.error })));
          controller.close();
          return;
        }
        if (stage !== last) {
          controller.enqueue(enc.encode(sse("stage", { stage, progress: Math.round(p * 100) / 100 })));
          last = stage;
        }
        setTimeout(tick, 400);
      };
      tick();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
}

/** Shaped like a real one: the counts and quotes are made up for the mock. */
function sample(repo: string): MergePlan {
  const pr = (n: number) => `https://github.com/${repo}/pull/${n}`;
  const src = { statement: "3 of 5 pull requests from outside contributors that touched `tests/` were merged.", seen: 3, of: 5, links: [pr(3876), pr(3801)] };
  return {
    repo,
    recorded_on: new Date(Date.now() - 3_600_000).toISOString(),
    generated_at: new Date().toISOString(),
    window: { days: 365, since: "2025-09-30" },
    sample: { merged: 50, closed: 25, merged_outside: 5, closed_outside: 25 },
    note: null,
    verdict: {
      verdict: "viable", headline: "Worth your time", tone: "good",
      line: "Outside contributors get real replies here, and their work gets merged.",
      numbers: [{ value: "5 of 8", label: "outside PRs merged" }, { value: "4.4 h", label: "typical first reply" }],
    },
    call: { text: "Pick a small change in `tests/` and write it yourself.", sources: [src] },
    steps: [
      { title: "Pick #3696, or a small fix in `tests/`", detail: "It is open and labelled docs.", link: { label: "#3696 on GitHub", url: `https://github.com/${repo}/issues/3696` }, copy: null, sources: [src] },
      { title: "Ask on the issue before you start", detail: null, link: null, copy: { label: "Comment to post", text: "Hi! I'd like to work on this. Is it still free?" }, sources: [src] },
    ],
    merged: [{ value: "72", unit: "lines", label: "typical merged pull request, in about 3 files", seen: 38, of: 50, sources: [src] }],
    closed: [{ reason: "Written with AI tools", seen: 8, of: 25, quote: { text: "Please read our policy on AI tools.", who: "maintainer", url: pr(3874), number: 3874 }, examples: [{ number: 3874, url: pr(3874) }] }],
    reviewers: { people: [{ login: "maintainer", reviewed: 27, of: 50, areas: ["tests/", "src/"] }], sources: [src] },
    ai: null,
  };
}
