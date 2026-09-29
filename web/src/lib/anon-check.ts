// Signed out, opening a report with no result yet runs the free check (lib/gate.ts).
// Only the report page may start one: when it renders for a person (not a
// bot), it mints a short-lived ticket for that repo and budget, and POST
// /api/analyses accepts a signed-out check only with a valid ticket. The API
// server's per-IP limit (HOLT_ANON_RATE_PER_HOUR) caps how many run. Node
// built-ins only, so it runs under `node --test`.
import { createHmac, timingSafeEqual } from "node:crypto";

/** How long a ticket from one page view can start its check (a retry included). */
export const TICKET_TTL_MS = 15 * 60_000;

// Crawlers, link previews, headless browsers and scripts. Browsers people use
// all send a "Mozilla/5.0 (…" user agent; anything else counts as a bot too.
const BOT = /bot\b|bot\/|crawl|spider|slurp|scrap|facebookexternalhit|embedly|preview|headless|lighthouse|pagespeed|phantom|puppeteer|playwright|selenium|whatsapp|telegram|curl|wget|python|httpx|go-http|java\/|okhttp|axios|node-fetch|libwww|monitor|uptime/i;

export function isBot(ua: string | null | undefined): boolean {
  if (!ua || !ua.startsWith("Mozilla/5.0 (")) return true;
  return BOT.test(ua);
}

function sign(secret: string, repo: string, days: number, exp: string): string {
  return createHmac("sha256", secret).update(`anon-check\n${repo.toLowerCase()}\n${days}\n${exp}`).digest("base64url");
}

/** A ticket for one signed-out rules check of `repo` at `days`. */
export function mintTicket(secret: string, repo: string, days: number, now = Date.now()): string {
  const exp = (now + TICKET_TTL_MS).toString(36);
  return `${exp}.${sign(secret, repo, days, exp)}`;
}

function ticketValid(secret: string, ticket: string, repo: string, days: number, now: number): boolean {
  const [exp, sig, extra] = ticket.split(".");
  if (!exp || !sig || extra !== undefined) return false;
  const expires = parseInt(exp, 36);
  if (!Number.isFinite(expires) || expires < now) return false;
  const want = Buffer.from(sign(secret, repo, days, exp));
  const got = Buffer.from(sig);
  return got.length === want.length && timingSafeEqual(got, want);
}

/** May this signed-out request start a check? */
export function anonymousStart(req: {
  secret: string | undefined;
  ticket: unknown;
  ua: string | null | undefined;
  repo: string;
  mode: string;
  days: number;
  refresh: boolean;
  now?: number;
}): boolean {
  if (!req.secret || typeof req.ticket !== "string" || !req.ticket) return false;
  if (req.mode !== "rules" || req.refresh || isBot(req.ua)) return false;
  return ticketValid(req.secret, req.ticket, req.repo, req.days, req.now ?? Date.now());
}
