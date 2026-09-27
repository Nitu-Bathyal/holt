// An in-memory stand-in for server/ (MOCK_API=1). It follows API.md: cached
// reports return at once, anything else becomes a job with stages over SSE.
import "server-only";
import type {
  AnalysisStart, ApiError, Credits, FeedbackOut, FindJobStatus, FindQuery, FindResult, FindStart, GitHubConnection, HistoryItem,
  JobStatus, Me, Mode, Report, Result, StarterIssue,
} from "../types";
import type { FeedbackInput } from "../feedback";
import { MODELS } from "../models";
import { verdictView } from "./derived";
import { canonicalName, isMockNotFound, mockFindPool, mockIssues, mockReport, PRECACHED } from "./fixtures";

const JOB_MS = Number(process.env.MOCK_JOB_MS || 6500);
const WELCOME_CREDITS = Number(process.env.NEXT_PUBLIC_FREE_AI_QUOTA || 3);
const CLAIM_EVERY_DAYS = 7;
const DAY_MS = 86_400_000;

const STAGES: [at: number, stage: string][] = [
  [0, "Fetching pull requests"],
  [0.3, "Reading threads"],
  [0.6, "Checking evidence"],
  [0.82, "Writing the report"],
];

interface Job {
  id: string;
  repo: string;
  mode: Mode;
  days: number;
  userId?: string;
  model?: string;
  started: number;
}

interface FindJob {
  id: string;
  q: FindQuery;
  started: number;
}

interface State {
  cache: Map<string, Report>;
  jobs: Map<string, Job>;
  findJobs: Map<string, FindJob>;
  users: Map<string, { me: Me; history: HistoryItem[] }>;
}

// globalThis so route handlers and pages share one state in dev.
const g = globalThis as unknown as { holtMock?: State };
function state(): State {
  if (!g.holtMock) {
    const cache = new Map<string, Report>();
    for (const repo of PRECACHED) cache.set(key(repo, "rules", 7), mockReport(repo, "rules", 7));
    g.holtMock = { cache, jobs: new Map(), findJobs: new Map(), users: new Map() };
  }
  return g.holtMock;
}

function key(repo: string, mode: Mode, days: number) {
  return `${repo.toLowerCase()}|${mode}|${days}`;
}

function err(status: number, code: ApiError["code"], message: string, extra: Partial<ApiError> = {}) {
  return { ok: false as const, status, error: { code, message, ...extra } };
}

function user(id: string) {
  const s = state();
  let u = s.users.get(id);
  if (!u) {
    u = {
      me: {
        plan: "free",
        plan_expires_at: null,
        credits: {
          balance: WELCOME_CREDITS,
          free: WELCOME_CREDITS,
          purchased: 0,
          can_claim: false,
          next_claim_at: new Date(Date.now() + CLAIM_EVERY_DAYS * DAY_MS).toISOString(),
          claim_every_days: CLAIM_EVERY_DAYS,
          ai_available: true,
        },
      },
      history: [
        { job_id: "job_seed_requests", status: "done", repo: "psf/requests", mode: "rules", days: 7, ...verdictView("viable"), verdict: "viable", created_at: new Date(Date.now() - 26 * 3_600_000).toISOString() },
        { job_id: "job_seed_pytorch", status: "done", repo: "pytorch/pytorch", mode: "rules", days: 7, ...verdictView("not_viable"), verdict: "not_viable", created_at: new Date(Date.now() - 50 * 3_600_000).toISOString() },
      ],
    };
    s.users.set(id, u);
  }
  return u;
}

function remember(userId: string | undefined, r: Report) {
  if (!userId) return;
  const h = user(userId).history;
  h.unshift({ job_id: `job_${crypto.randomUUID().slice(0, 12)}`, status: "done", repo: r.repo, mode: r.mode, days: r.days, verdict: r.verdict, headline: r.headline, tone: r.tone, created_at: new Date().toISOString() });
  h.splice(30);
}

function validate(repo: string): Result<string> {
  if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(repo)) return err(400, "invalid_repo", "That doesn't look like a GitHub repository. Try something like pallets/flask.");
  if (isMockNotFound(repo)) return err(404, "not_found", `We couldn't find ${repo} on GitHub. It may be private, renamed, or misspelled.`);
  return { ok: true, data: canonicalName(repo) };
}

export async function startAnalysis(
  repoIn: string, mode: Mode, days: number, refresh: boolean, userId?: string, model?: string,
): Promise<Result<AnalysisStart>> {
  const v = validate(repoIn);
  if (!v.ok) return v;
  const repo = v.data;
  if (mode === "ai") {
    if (!userId) return err(401, "unauthorized", "Sign in to get an AI report.");
    const c = user(userId).me.credits;
    if (!c.ai_available) return err(503, "ai_unavailable", "AI reports aren't switched on yet. The free quick report has the full verdict and evidence.");
    if (c.balance <= 0) return err(402, "quota_exceeded", "You've used your free AI reports. You can claim another one in your settings once a week. The quick report is always free.");
  }
  const s = state();
  const cached = s.cache.get(key(repo, mode, days));
  if (cached && !refresh) {
    remember(userId, cached);
    return { ok: true, data: { status: "done", report: cached } };
  }
  const id = `job_${crypto.randomUUID().slice(0, 12)}`;
  s.jobs.set(id, { id, repo, mode, days, userId, model, started: Date.now() });
  if (mode === "ai" && userId) {
    const c = user(userId).me.credits;
    c.balance--;
    c.free--;
  }
  return { ok: true, data: { status: "queued", job_id: id } };
}

function progressOf(job: Job) {
  const p = Math.min(1, (Date.now() - job.started) / JOB_MS);
  let stage = STAGES[0][1];
  for (const [at, name] of STAGES) if (p >= at) stage = name;
  return { p, stage };
}

function finish(job: Job): Report {
  const s = state();
  const k = key(job.repo, job.mode, job.days);
  let r = s.cache.get(k);
  if (!r) {
    r = { ...mockReport(job.repo, job.mode, job.days), generated_at: new Date().toISOString() };
    // Show the chosen model the way a real AI report would.
    if (r.cost && job.model) r = { ...r, cost: { ...r.cost, model: MODELS.find((m) => m.id === job.model)?.openrouter ?? job.model } };
    s.cache.set(k, r);
    remember(job.userId, r);
  }
  return r;
}

export async function jobStatus(id: string): Promise<Result<JobStatus>> {
  const job = state().jobs.get(id);
  if (!job) return err(404, "not_found", "That analysis has expired. Start it again.");
  const { p, stage } = progressOf(job);
  if (p >= 1) return { ok: true, data: { status: "done", stage: "Done", progress: 1, report: finish(job), error: null } };
  return { ok: true, data: { status: p < 0.05 ? "queued" : "running", stage, progress: p, report: null, error: null } };
}

function sse(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function jobEvents(kind: "analyses" | "find", id: string, signal: AbortSignal): Response {
  if (kind === "find") return findEvents(id, signal);
  const job = state().jobs.get(id);
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (!job) {
        controller.enqueue(enc.encode(sse("error", { error: { code: "not_found", message: "That analysis has expired. Start it again." } })));
        controller.close();
        return;
      }
      let last = "";
      const tick = () => {
        if (signal.aborted) return;
        const { p, stage } = progressOf(job);
        if (p >= 1) {
          controller.enqueue(enc.encode(sse("stage", { stage: "Writing the report", progress: 1 })));
          controller.enqueue(enc.encode(sse("done", { report: finish(job) })));
          controller.close();
          return;
        }
        if (stage !== last || Math.random() < 0.5) {
          controller.enqueue(enc.encode(sse("stage", { stage, progress: Math.round(p * 100) / 100 })));
          last = stage;
        }
        setTimeout(tick, 350);
      };
      tick();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
}

export async function listReports(limit: number): Promise<Result<{ reports: { repo: string; mode: Mode; generated_at: string; verdict: string }[] }>> {
  const rows = [...state().cache.values()]
    .filter((r) => r.mode === "rules" && r.days === 7)
    .map((r) => ({ repo: r.repo, mode: r.mode, generated_at: r.generated_at, verdict: r.verdict }))
    .sort((a, b) => b.generated_at.localeCompare(a.generated_at));
  return { ok: true, data: { reports: rows.slice(0, limit) } };
}

export async function getReport(repoIn: string, mode: Mode, days: number): Promise<Result<Report>> {
  const v = validate(repoIn);
  if (!v.ok) return v;
  const r = state().cache.get(key(v.data, mode, days));
  return r ? { ok: true, data: r } : err(404, "not_found", "No report yet for this repository.");
}

export async function starterIssues(repoIn: string, limit: number): Promise<Result<{ repo: string; issues: StarterIssue[] }>> {
  const v = validate(repoIn);
  if (!v.ok) return v;
  return { ok: true, data: { repo: v.data, issues: mockIssues(v.data).slice(0, limit) } };
}

const FIND_MS = Math.round(JOB_MS / 2);

/** API.md: find always answers 202; the job's `done` carries {results}. */
export async function find(q: FindQuery): Promise<Result<FindStart>> {
  const id = `find_${crypto.randomUUID().slice(0, 12)}`;
  state().findJobs.set(id, { id, q, started: Date.now() });
  return { ok: true, data: { status: "queued", job_id: id } };
}

export async function findStatus(id: string): Promise<Result<FindJobStatus>> {
  const job = state().findJobs.get(id);
  if (!job) return err(404, "not_found", "That search has expired. Start it again.");
  const p = Math.min(1, (Date.now() - job.started) / FIND_MS);
  return p >= 1
    ? { ok: true, data: { status: "done", stage: "Done", progress: 1, results: findResults(job.q), error: null } }
    : { ok: true, data: { status: "running", stage: p < 0.5 ? "Fetching pull requests" : "Checking evidence", progress: p, results: null, error: null } };
}

function findEvents(id: string, signal: AbortSignal): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const tick = async () => {
        if (signal.aborted) return;
        const r = await findStatus(id);
        if (!r.ok) {
          controller.enqueue(enc.encode(sse("error", { error: r.error })));
          controller.close();
          return;
        }
        if (r.data.status === "done") {
          controller.enqueue(enc.encode(sse("done", { results: r.data.results })));
          controller.close();
          return;
        }
        controller.enqueue(enc.encode(sse("stage", { stage: r.data.stage, progress: Math.round(r.data.progress * 100) / 100 })));
        setTimeout(tick, 350);
      };
      tick();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
}

function findResults(q: FindQuery): FindResult[] {
  const langs = q.languages.map((l) => l.toLowerCase());
  return mockFindPool()
    .filter(({ seed }) => !langs.length || langs.includes(seed.language.toLowerCase()))
    .filter(({ seed }) => !q.hacktoberfest || seed.hacktoberfest)
    .filter(({ issues }) => issues.length > 0)
    .sort((a, b) => b.seed.stats.first_time_merged_authors - a.seed.stats.first_time_merged_authors)
    .slice(0, q.limit)
    .map(({ seed, issues }) => ({
      repo: seed.repo,
      ...verdictView(seed.verdict),
      verdict: seed.verdict,
      description: seed.description,
      language: seed.language,
      stars: seed.stars,
      stats: {
        outsider_attempts: seed.stats.outsider_attempts,
        outsider_merged: seed.stats.outsider_merged,
        first_time_merged_authors: seed.stats.first_time_merged_authors,
        median_first_response_hours: seed.stats.median_first_response_hours,
      },
      issues: q.days <= 1 ? issues.filter((i) => i.labels.some((l) => /doc|typo|good first/i.test(l))).slice(0, 2) : issues,
    }))
    .filter((r) => r.issues.length > 0);
}

/** Accepts an answer for any cached report version, like the server. */
export async function sendFeedback(input: FeedbackInput): Promise<Result<FeedbackOut>> {
  const r = state().cache.get(key(input.repo, input.mode, input.days));
  if (!r || r.generated_at !== input.generated_at) return err(404, "not_found", "We couldn't find that report any more. Reload the page and try again.");
  return { ok: true, data: { repo: r.repo, generated_at: r.generated_at, verdict: r.verdict, vote: input.vote, reason: input.reason } };
}

export async function me(userId: string): Promise<Result<Me>> {
  return { ok: true, data: user(userId).me };
}

export async function claimCredit(userId: string): Promise<Result<Credits>> {
  const c = user(userId).me.credits;
  if (!c.can_claim) {
    const when = c.next_claim_at ? new Date(c.next_claim_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" }) : "later";
    return err(409, "claim_not_ready", `Your next free AI report can be claimed on ${when}.`);
  }
  c.balance++;
  c.free++;
  c.can_claim = false;
  c.next_claim_at = new Date(Date.now() + CLAIM_EVERY_DAYS * DAY_MS).toISOString();
  return { ok: true, data: c };
}

export async function history(userId: string): Promise<Result<{ items: HistoryItem[] }>> {
  return { ok: true, data: { items: user(userId).history } };
}

export function badge(repoIn: string): Response {
  const v = validate(repoIn);
  const report = v.ok ? state().cache.get(key(v.data, "rules", 7)) : undefined;
  const [text, color] = !report
    ? ["not checked yet", "#6b6b64"]
    : report.verdict === "viable"
      ? ["newcomer-friendly", "#17775a"]
      : report.verdict === "not_viable"
        ? ["hard for newcomers", "#b34a12"]
        : ["not enough evidence", "#8a5a00"];
  return new Response(badgeSvg("holt", text, color), {
    headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}

/** Shields-style badge. Opaque fills so it reads on light and dark READMEs. */
export function badgeSvg(label: string, message: string, color: string): string {
  const w = (s: string) => Math.round(s.length * 6.6 + 12);
  const lw = 36 + Math.round(label.length * 6.6) + 6;
  const mw = w(message);
  const total = lw + mw;
  const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="20" role="img" aria-label="${esc(label)}: ${esc(message)}">
<title>${esc(label)}: ${esc(message)}</title>
<clipPath id="r"><rect width="${total}" height="20" rx="3"/></clipPath>
<g clip-path="url(#r)"><rect width="${lw}" height="20" fill="#1b1d1c"/><rect x="${lw}" width="${mw}" height="20" fill="${color}"/></g>
<g fill="#83a9ff" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11"><text x="5" y="13.5" font-size="8.5">=^.^=</text></g>
<g fill="#fff" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11"><text x="36" y="14">${esc(label)}</text><text x="${lw + 6}" y="14">${esc(message)}</text></g>
</svg>`;
}

// Connect GitHub. The mock names the account after its id; the real server asks GitHub.
const g2 = globalThis as unknown as { holtMockGitHub?: Map<string, GitHubConnection> };
const connections = () => (g2.holtMockGitHub ??= new Map());
const NOT_CONNECTED: GitHubConnection = { connected: false, account: null };

export async function githubConnection(userId: string): Promise<Result<GitHubConnection>> {
  return { ok: true, data: connections().get(userId) ?? NOT_CONNECTED };
}

export async function connectGitHub(userId: string, githubId: string, statsOptOut: boolean): Promise<Result<GitHubConnection>> {
  const at = new Date().toISOString();
  const prev = connections().get(userId)?.account;
  const data: GitHubConnection = {
    connected: true,
    account: { id: Number(githubId), login: `github-user-${githubId}`, connected_at: prev?.connected_at ?? at, adult_confirmed_at: at, stats_opt_out: statsOptOut },
  };
  connections().set(userId, data);
  return { ok: true, data };
}

export async function setStatsOptOut(userId: string, statsOptOut: boolean): Promise<Result<GitHubConnection>> {
  const c = connections().get(userId);
  if (!c?.account) return err(404, "not_found", "Your GitHub account isn't connected.");
  const data = { connected: true, account: { ...c.account, stats_opt_out: statsOptOut } };
  connections().set(userId, data);
  return { ok: true, data };
}

export async function disconnectGitHub(userId: string): Promise<Result<GitHubConnection>> {
  connections().delete(userId);
  return { ok: true, data: NOT_CONNECTED };
}
