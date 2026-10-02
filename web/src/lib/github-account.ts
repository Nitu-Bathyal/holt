// The user's GitHub account as Auth.js knows it: the numeric id GitHub gave
// when they signed in with GitHub or linked it from the Connect screen. It's
// the only place the id for /v1/me/github comes from, so nobody can connect
// an account they haven't proved is theirs.
import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { and, eq, ne, or } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import { accounts, sessions, users } from "@/db/schema";
import { mergeAccount } from "./api";
import { authSecret } from "./auth-secret";
import { type MergeProof, readMergeProof, signInMove } from "./github-connect";

/** Carries the choices made on the connect form (Settings → Accounts) through GitHub's sign-in page and back
 *  to /api/github/connect. Only ever set by the connect action, after the 18+
 *  box was ticked. */
export const PENDING_COOKIE = "holt_connect";
/** Wide enough for the Auth.js callback (/api/auth) too: it reads the cookie to
 *  know a failed link belongs to the connect form, not to sign-in. */
export const PENDING_COOKIE_PATH = "/api";

export async function linkedGitHubId(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: accounts.providerAccountId })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.provider, "github")))
    .limit(1);
  return row && /^\d{1,16}$/.test(row.id) ? row.id : null;
}

/**
 * After a disconnect: forget the GitHub link too, so a different GitHub account
 * can be connected next time. Not when GitHub is how they sign in (their only
 * sign-in method), or they'd be locked out.
 */
export async function unlinkGitHubIfNotSignIn(userId: string): Promise<void> {
  const [other] = await db
    .select({ provider: accounts.provider })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), ne(accounts.provider, "github")))
    .limit(1);
  if (!other) return;
  await db.delete(accounts).where(and(eq(accounts.userId, userId), eq(accounts.provider, "github")));
}

/** The providers this person can sign in with ("github", "google"), for settings. */
export async function signInProviders(userId: string): Promise<string[]> {
  const rows = await db.select({ provider: accounts.provider }).from(accounts).where(eq(accounts.userId, userId));
  return [...new Set(rows.map((r) => r.provider))].sort();
}

// Merging two accounts (lib/github-connect.ts says when). It needs proof of
// both from one browser: the session of the account being kept, and GitHub
// having just confirmed the other one's sign-in.

/** The proof, left by the Auth.js route when a link came back "taken". */
export const MERGE_COOKIE = "holt_merge";
/** Only the Accounts page and its actions ever see it. */
export const MERGE_COOKIE_PATH = "/settings/accounts";

/**
 * While the Auth.js route runs, the GitHub account GitHub just confirmed:
 * Auth.js's sign-in callback (auth.ts) writes it, the route reads it.
 */
export const confirmedGitHub = new AsyncLocalStorage<{ id?: string }>();

/** This browser's proof, when it is the signed-in person's and still fresh. */
export async function mergeProofFor(userId: string): Promise<MergeProof | null> {
  return readMergeProof((await cookies()).get(MERGE_COOKIE)?.value, userId, authSecret(process.env));
}

/** Whether `githubId` is the sign-in of a Holt account other than `userId`: one to merge. */
export async function isAnotherAccountsSignIn(githubId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ userId: accounts.userId })
    .from(accounts)
    .where(and(eq(accounts.provider, "github"), eq(accounts.providerAccountId, githubId)))
    .limit(1);
  return Boolean(row) && row.userId !== userId;
}

/**
 * Merge the account that signs in with `githubId` into `into`. The caller has
 * checked the proof (mergeProofFor). The server moves that account's data in
 * its own transaction, inside this one: here the GitHub sign-in moves to
 * `into`, and the emptied account goes with its sessions and any other
 * sign-in it had (those weren't proven). If the server refuses or can't be
 * reached, nothing here is kept either. False when nothing was merged.
 */
export async function mergeGitHubAccount(githubId: string, into: string): Promise<boolean> {
  const github = eq(accounts.provider, "github");
  try {
    await db.transaction(async (tx) => {
      const signIns = await tx
        .select({ userId: accounts.userId, githubId: accounts.providerAccountId })
        .from(accounts)
        .where(and(github, or(eq(accounts.providerAccountId, githubId), eq(accounts.userId, into))))
        .for("update");
      const move = signInMove(githubId, into, signIns);
      if (move === "done") return;
      if (move === "refuse") throw new Error("not a sign-in to merge");
      await tx.update(accounts).set({ userId: into }).where(and(github, eq(accounts.providerAccountId, githubId)));
      await tx.delete(sessions).where(eq(sessions.userId, move.from));
      await tx.delete(accounts).where(eq(accounts.userId, move.from));
      await tx.delete(users).where(eq(users.id, move.from));
      const moved = await mergeAccount(into, move.from, githubId);
      if (!moved.ok) throw new Error(`the server answered ${moved.status}`);
    });
    return true;
  } catch (e) {
    console.error("[holt] merging accounts failed:", (e as Error).message);
    return false;
  }
}
