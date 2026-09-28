import type { ApiError } from "./types";

const HEAD: Record<string, string> = {
  not_found: "We couldn't find that repository",
  invalid_repo: "That doesn't look like a repository",
  invalid_request: "That request didn't make sense to us",
  not_implemented: "Coming soon",
  rate_limited: "Too many checks at once",
  quota_exceeded: "You've used your free AI reports",
  needs_key: "Sign in for AI reports",
  ai_unavailable: "AI reports aren't switched on yet",
  claim_not_ready: "Not yet",
  unauthorized: "Sign in first",
  upstream: "GitHub or the AI model didn't answer",
  internal: "Something broke on our side",
};

/** The error panel's heading. AI switched off and the site's AI budget being
 * used up share `ai_unavailable`; the server tells them apart with `reason`. */
export function errorHeading(error: Pick<ApiError, "code" | "reason">): string {
  if (error.reason === "ai_budget_used_up") return "AI is paused for now";
  return HEAD[error.code] ?? "Something went wrong";
}
