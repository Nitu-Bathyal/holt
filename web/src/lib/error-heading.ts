import type { ApiError } from "./types";

const HEAD: Record<string, string> = {
  not_found: "We couldn't find that repo",
  invalid_repo: "That doesn't look like a repo",
  invalid_request: "We didn't understand that request",
  not_implemented: "Coming soon",
  rate_limited: "Too many checks, too fast",
  quota_exceeded: "You've used what your plan covers",
  needs_key: "Sign in first",
  ai_unavailable: "Merge plans aren't switched on yet",
  claim_not_ready: "Not yet",
  unauthorized: "Sign in first",
  upstream: "GitHub or the AI didn't answer",
  internal: "Something broke on our side",
};

/** The error panel's heading. AI switched off and the site's AI budget being
 * used up share `ai_unavailable`; the server tells them apart with `reason`. */
export function errorHeading(error: Pick<ApiError, "code" | "reason">): string {
  if (error.reason === "ai_budget_used_up") return "AI is paused for now";
  return HEAD[error.code] ?? "That didn't work";
}
