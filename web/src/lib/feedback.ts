// "Was this verdict right?" answers (API.md, Feedback). No imports, so the
// component, the route handler and `node --test` share it.

export type Vote = "up" | "down";

export const REASON_MAX = 500;

export interface FeedbackInput {
  repo: string;
  mode: "rules" | "ai";
  days: number;
  /** The report's `generated_at`: which version of the report is being judged. */
  generated_at: string;
  vote: Vote;
  reason: string | null;
}

const REPO = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;

/** A browser's request body, checked; null if anything is off. */
export function parseFeedback(body: unknown): FeedbackInput | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const repo = typeof b.repo === "string" ? b.repo.trim() : "";
  const days = Number(b.days ?? 7);
  const generated = typeof b.generated_at === "string" ? b.generated_at.trim() : "";
  if (!REPO.test(repo)) return null;
  if (b.mode !== undefined && b.mode !== "rules" && b.mode !== "ai") return null;
  if (!Number.isInteger(days) || days < 1 || days > 90) return null;
  if (!generated || generated.length > 40) return null;
  if (b.vote !== "up" && b.vote !== "down") return null;
  if (b.reason != null && typeof b.reason !== "string") return null;
  return {
    repo,
    mode: b.mode === "ai" ? "ai" : "rules",
    days,
    generated_at: generated,
    vote: b.vote,
    reason: cleanReason(b.reason),
  };
}

export function cleanReason(reason: unknown): string | null {
  if (typeof reason !== "string") return null;
  return reason.replace(/\s+/g, " ").trim().slice(0, REASON_MAX) || null;
}

/** Where the browser remembers its own answer, per report version. */
export function feedbackKey(repo: string, mode: string, days: number, generatedAt: string): string {
  return `holt:feedback:${repo.toLowerCase()}|${mode}|${days}|${generatedAt}`;
}
