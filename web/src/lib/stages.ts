// Friendly progress copy. Server stage strings are plain English already;
// these add a line of context for someone waiting on a phone.
const FRIENDLY: [RegExp, string, string][] = [
  [/^starting/i, "Starting", "Warming up."],
  [/queue|waiting|in line/i, "Getting in line", "Someone else's report is running. Yours is next."],
  [/fetch|pull request/i, "Fetching pull requests", "The last few months of PRs from people outside the team."],
  [/count/i, "Counting replies and merges", "Who got an answer, who got merged, and how long it took."],
  [/thread|read/i, "Reading threads", "Who replied, how fast, and what happened to each PR."],
  [/check|verif|evidence/i, "Checking evidence", "Every claim has to link to a real GitHub page, or it's dropped."],
  [/rules/i, "Applying the rules", "The same written rules as every other repo."],
  [/writ|report|verdict/i, "Writing the report", "The same written rules as every other repo."],
];

export function friendlyStage(stage: string | undefined): { title: string; detail: string } {
  if (!stage) return { title: "Starting", detail: "Warming up." };
  // "In the queue: 3 checks ahead of yours" -> the place in line as the detail.
  const place = /^In the queue: (.+)$/.exec(stage);
  if (place) return { title: "Getting in line", detail: place[1].charAt(0).toUpperCase() + place[1].slice(1) + "." };
  for (const [re, title, detail] of FRIENDLY) if (re.test(stage)) return { title, detail };
  return { title: stage, detail: "" };
}

/** One line of the live progress log: a stage, and when it started (seconds in). */
export interface LogLine {
  title: string;
  detail: string;
  at: number;
}

/**
 * The progress log after a stage event, printed like a terminal: a new stage
 * adds a line, the same stage (a new place in the queue) rewrites its detail,
 * and a stage already passed never prints again (the server can say
 * "Starting" after the page has already said "Getting in line"). Returns the
 * same array when nothing changed.
 */
export function logStage(log: LogLine[], stage: string | undefined, at: number): LogLine[] {
  const f = friendlyStage(stage);
  const last = log.at(-1);
  if (last?.title === f.title) return last.detail === f.detail ? log : [...log.slice(0, -1), { ...last, detail: f.detail }];
  if (log.some((l) => l.title === f.title)) return log;
  return [...log, { ...f, at }];
}

/** "4s", "1m 05s": how long a stage took. */
export function stageTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

/**
 * Seconds a free check typically takes once it starts: 11 to 23 seconds on
 * the repos measured for PR #179, busy ones at the top. The ETA rounds to it.
 */
export const TYPICAL_CHECK_SECONDS = 20;

/**
 * "about 15s left", "almost done", or null when there's no honest guess: an
 * AI report (the model's time varies too much), or a check already running
 * well past the typical time. `ahead`: checks in the queue before this one.
 */
export function eta(s: { mode: "rules" | "ai"; elapsed: number; ahead?: number }): string | null {
  if (s.mode !== "rules") return null;
  const left = (s.ahead ?? 0) * TYPICAL_CHECK_SECONDS + TYPICAL_CHECK_SECONDS - s.elapsed;
  if (left < -TYPICAL_CHECK_SECONDS) return null;
  if (left <= 5) return "almost done";
  return left < 60 ? `about ${Math.ceil(left / 5) * 5}s left` : `about ${Math.round(left / 60)} min left`;
}
