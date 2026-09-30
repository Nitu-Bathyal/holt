// The paid playbook in the mock API (MOCK_API=1), following API.md's
// "Playbook" section. `MOCK_PRO=0` switches it off (the section hides).
// `MOCK_PLAYBOOK_CREDITS` (default 0) is what each user has to spend on it;
// with 0 the page shows "coming soon", as production does while nothing is on
// sale. pallets/flask has a playbook already; a repo named `*fail*` fails and
// is refunded. A new playbook takes MOCK_PLAYBOOK_MS (8 s).
import "server-only";
import type { Access, ApiError, Playbook, PlaybookStart, PlaybookState, Result } from "../types";
import { canonicalName, isMockNotFound } from "./fixtures";

const JOB_MS = Number(process.env.MOCK_PLAYBOOK_MS || 8000);
const CREDITS = Number(process.env.MOCK_PLAYBOOK_CREDITS || 0);
const STAGES: [at: number, stage: string][] = [
  [0, "Reading the project's pull requests and reviews"],
  [0.5, "Writing the playbook"],
  [0.85, "Checking every claim against the counts"],
];

interface Job {
  id: string;
  repo: string;
  started: number;
  users: string[];
}

interface State {
  playbooks: Map<string, Playbook>;
  unlocks: Set<string>;
  credits: Map<string, number>;
  jobs: Map<string, Job>;
}

const g = globalThis as unknown as { holtMockPlaybook?: State };
function state(): State {
  if (!g.holtMockPlaybook) {
    g.holtMockPlaybook = { playbooks: new Map([["pallets/flask", sample("pallets/flask")]]), unlocks: new Set(), credits: new Map(), jobs: new Map() };
  }
  return g.holtMockPlaybook;
}

const on = () => process.env.MOCK_PRO !== "0";
const k = (repo: string) => repo.toLowerCase();
const credits = (user: string) => state().credits.get(user) ?? CREDITS;

function err<T>(status: number, code: ApiError["code"], message: string): Result<T> {
  return { ok: false, status, error: { code, message } };
}

function access(user: string): Access {
  const have = credits(user);
  if (have >= 1) return { feature: "playbook", name: "Contribution playbook", allowed: true, via: "credits", cost: 1, left_this_month: null, code: null, message: null };
  return {
    feature: "playbook", name: "Contribution playbook", allowed: false, via: null, cost: 1, left_this_month: null, code: "quota_exceeded",
    message: "Contribution playbook costs 1 credit, and free credits can't be used for it. You don't have enough purchased credits.",
  };
}

function teaser(p: Playbook): PlaybookState["teaser"] {
  const keys = ["must_do", "size_and_scope", "reviewers", "closing_reasons", "checklist"] as const;
  return {
    sections: keys.filter((x) => p.sections[x].length > 0).map((x) => ({ key: x, count: p.sections[x].length })),
    first: p.sections.must_do[0] ?? null,
    generated_at: p.generated_at,
  };
}

function progressOf(job: Job) {
  const p = Math.min(1, (Date.now() - job.started) / JOB_MS);
  let stage = STAGES[0][1];
  for (const [at, name] of STAGES) if (p >= at) stage = name;
  return { p, stage };
}

/** A finished job's playbook, or its failure (everyone waiting gets their credit back). */
function finish(job: Job): Result<Playbook> {
  const s = state();
  if (/fail/i.test(job.repo)) {
    if (s.jobs.delete(job.id)) {
      for (const u of job.users) {
        s.unlocks.delete(`${u}|${k(job.repo)}`);
        s.credits.set(u, credits(u) + 1);
      }
    }
    return err(502, "upstream", "GitHub or the writing model didn't answer properly, so the playbook couldn't be written. Please try again later. You weren't charged for it.");
  }
  let p = s.playbooks.get(k(job.repo));
  if (!p || Date.parse(p.generated_at) < job.started) {
    p = { ...sample(job.repo), generated_at: new Date().toISOString() };
    s.playbooks.set(k(job.repo), p);
  }
  return { ok: true, data: p };
}

function activeJob(repo: string): Job | undefined {
  return [...state().jobs.values()].find((j) => k(j.repo) === k(repo) && progressOf(j).p < 1);
}

export async function playbookState(repoIn: string, userId?: string): Promise<Result<PlaybookState>> {
  const repo = canonicalName(repoIn);
  if (!on()) return { ok: true, data: { repo, available: false, teaser: null, playbook: null, unlocked: false, access: null, on_sale: false, job: null } };
  const s = state();
  const p = s.playbooks.get(k(repo)) ?? null;
  const unlocked = Boolean(userId && s.unlocks.has(`${userId}|${k(repo)}`));
  const running = unlocked ? activeJob(repo) : undefined;
  const job = running ? { job_id: running.id, status: "running" as const, stage: progressOf(running).stage, progress: progressOf(running).p } : null;
  return {
    ok: true,
    data: {
      repo, available: true, teaser: p ? teaser(p) : null, playbook: unlocked && p ? p : null, unlocked,
      access: userId ? access(userId) : null, on_sale: false, job,
    },
  };
}

export async function unlockPlaybook(repoIn: string, userId: string): Promise<Result<PlaybookStart>> {
  if (!on()) return err(501, "not_implemented", "This feature isn't available yet.");
  if (isMockNotFound(repoIn)) return err(404, "not_found", `We couldn't find ${repoIn} on GitHub. Check the spelling; private repositories can't be checked.`);
  const repo = canonicalName(repoIn);
  const s = state();
  const u = `${userId}|${k(repo)}`;
  const unlocked = s.unlocks.has(u);
  const pay = (): Result<null> => {
    if (unlocked) return { ok: true, data: null };
    const a = access(userId);
    if (!a.allowed) return err(402, "quota_exceeded", a.message ?? "");
    s.credits.set(userId, credits(userId) - 1);
    s.unlocks.add(u);
    return { ok: true, data: null };
  };
  const cached = s.playbooks.get(k(repo));
  if (cached) {
    const paid = pay();
    if (!paid.ok) return paid;
    return { ok: true, data: { status: "done", playbook: cached } };
  }
  const running = activeJob(repo);
  const paid = pay();
  if (!paid.ok) return paid;
  if (running) {
    running.users.push(userId);
    return { ok: true, data: { status: "queued", job_id: running.id } };
  }
  const id = `pbjob_${crypto.randomUUID().slice(0, 12)}`;
  s.jobs.set(id, { id, repo, started: Date.now(), users: [userId] });
  return { ok: true, data: { status: "queued", job_id: id } };
}

const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

export function playbookEvents(id: string, signal: AbortSignal): Response {
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
          controller.enqueue(enc.encode(r.ok ? sse("done", { playbook: r.data }) : sse("error", { error: r.error })));
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
function sample(repo: string): Playbook {
  const pr = (n: number) => `https://github.com/${repo}/pull/${n}`;
  return {
    repo,
    generated_at: "2026-09-27T10:00:00Z",
    model: "ai",
    note: null,
    window_days: 365,
    archived: false,
    sections: {
      must_do: [
        {
          text: "Add or change tests with any code change: 34 of 44 merged pull requests that changed code did.",
          sources: [{ statement: "34 of 44 merged pull requests that changed code also added or changed tests. Of those closed without merging, 9 of 24 did.", seen: 34, of: 44, links: [pr(5821), pr(5807), pr(5790)] }],
        },
        {
          text: "Make sure `tests` and `typing` pass: every merged pull request passed both.",
          sources: [{ statement: "All 44 merged pull requests passed the checks `tests` and `typing`.", seen: 44, of: 44, links: [pr(5821), pr(5799)] }],
        },
        {
          text: "Link the issue your pull request fixes: 29 of 44 merged pull requests did.",
          sources: [{ statement: "29 of 44 merged pull requests linked an issue.", seen: 29, of: 44, links: [pr(5790), pr(5776)] }],
        },
      ],
      size_and_scope: [
        {
          text: "Keep it small: half of merged pull requests changed 40 lines or fewer, in 3 files or fewer.",
          sources: [{ statement: "Half of the 44 merged pull requests changed 40 lines or fewer and 3 files or fewer.", seen: 22, of: 44, links: [pr(5807)] }],
        },
      ],
      reviewers: [
        {
          text: "Most reviews come from two maintainers; changes under `src/flask/json/` are reviewed by the same person every time.",
          sources: [{ statement: "38 of 44 merged pull requests were reviewed by one of two people.", seen: 38, of: 44, links: [pr(5821), pr(5790)] }],
        },
      ],
      closing_reasons: [
        {
          reason: "The change wasn't discussed first",
          explanation: "The project asks for an issue before a pull request that changes behaviour, and closes ones that skip it.",
          seen: 9,
          of: 24,
          examples: [
            { number: 5768, url: pr(5768), title: "Add a config option for JSON sorting", who: "davidism", quote: "Please open an issue to discuss this first." },
            { number: 5741, url: pr(5741), title: "Change default error handler", who: "davidism", quote: "This needs an issue and discussion before a PR." },
          ],
        },
        {
          reason: "Written with AI tools",
          explanation: "The project closes pull requests written with AI tools and links to its policy on them.",
          seen: 6,
          of: 24,
          examples: [{ number: 5752, url: pr(5752), title: "Improve docs", who: "davidism", quote: "Closing per our policy on AI-generated contributions." }],
        },
      ],
      checklist: [
        { text: "Add a changelog entry under the next version in `CHANGES.rst`.", sources: [{ statement: "31 of 44 merged pull requests changed `CHANGES.rst`.", seen: 31, of: 44, links: [pr(5821)] }] },
        { text: "Fill in the pull request template, including the issue it fixes.", sources: [{ statement: "The repository has a pull request template.", seen: null, of: null, links: [`https://github.com/${repo}/blob/HEAD/.github/pull_request_template.md`] }] },
      ],
    },
  };
}
