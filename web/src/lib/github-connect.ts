// Connect GitHub goes through GitHub's sign-in page. When Auth.js can't link
// the account it sends the browser to /signin?error=<code>, and /signin sends
// anyone signed in on to /me: the failure vanished. This reads where Auth.js
// is redirecting, so the Auth.js route can send a failed link back to the
// connect form with the reason. Pure, so it runs under `node --test`.
//
// "taken" can end in a merge. A person who signed in with GitHub once and with
// Google later has two Holt accounts; when GitHub has just confirmed the
// account is theirs, they may merge the first into the one they are signed in
// to. The proof of that confirmation and the decision are here too.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { ConnectError } from "./settings";

/** Where Auth.js sends a failed sign-in: its own error page or ours. */
const FAILED = new Set(["/signin", "/api/auth/error", "/api/auth/signin"]);

/** The connect form's error for an Auth.js redirect, or null when it isn't a failure. */
export function connectErrorFor(location: string | null): ConnectError | null {
  if (!location) return null;
  let url: URL;
  try {
    url = new URL(location, "http://holt.invalid");
  } catch {
    return null;
  }
  const code = url.searchParams.get("error");
  if (!code || !FAILED.has(url.pathname)) return null;
  // The GitHub account is already another Holt user's sign-in.
  return code === "OAuthAccountNotLinked" ? "taken" : "link";
}

/** How long after GitHub confirmed the account a merge may still be asked for. */
export const MERGE_WINDOW_S = 600;

export interface MergeProof {
  /** The GitHub account GitHub just signed this browser in to. */
  githubId: string;
  /** "Don't include me in statistics", as ticked on the connect form. */
  optOut: boolean;
}

function sign(body: string, secret: string): Buffer {
  return createHmac("sha256", `holt-merge|${secret}`).update(body).digest();
}

/**
 * The proof the Auth.js route leaves in a cookie when GitHub confirmed
 * `githubId` for the browser signed in as `userId`, and the link was refused
 * because that GitHub account is another Holt account's sign-in. Signed with
 * the server's secret, so only that moment can make one.
 */
export function mergeProof(p: MergeProof & { userId: string }, secret: string, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ g: p.githubId, u: p.userId, o: p.optOut, e: Math.floor(now / 1000) + MERGE_WINDOW_S })).toString("base64url");
  return `${body}.${sign(body, secret).toString("base64url")}`;
}

/** What a proof cookie proves for the person signed in as `userId` now, or null: not ours, not theirs, or too old. */
export function readMergeProof(cookie: string | undefined, userId: string, secret: string | undefined, now = Date.now()): MergeProof | null {
  if (!cookie || !secret) return null;
  const [body, sig, ...rest] = cookie.split(".");
  if (!body || !sig || rest.length) return null;
  const given = Buffer.from(sig, "base64url");
  const expected = sign(body, secret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const { g, u, o, e } = JSON.parse(Buffer.from(body, "base64url").toString()) as Record<string, unknown>;
    if (typeof g !== "string" || !/^\d{1,16}$/.test(g) || u !== userId || typeof e !== "number" || e * 1000 <= now) return null;
    return { githubId: g, optOut: o === true };
  } catch {
    return null;
  }
}

/**
 * What to do with the GitHub sign-in `githubId`, given every GitHub sign-in
 * that is that account or belongs to `into` (the account being kept): merge
 * the account that owns it, nothing (it was already moved), or refuse (it is
 * nobody's sign-in, or `into` already signs in with another GitHub account).
 */
export function signInMove(githubId: string, into: string, signIns: { userId: string; githubId: string }[]): { from: string } | "done" | "refuse" {
  if (signIns.some((s) => s.userId === into && s.githubId !== githubId)) return "refuse";
  const owner = signIns.find((s) => s.githubId === githubId);
  if (!owner) return "refuse";
  return owner.userId === into ? "done" : { from: owner.userId };
}
