// The user's GitHub account as Auth.js knows it: the numeric id GitHub gave
// when they signed in with GitHub or linked it from the Connect screen. It's
// the only place the id for /v1/me/github comes from, so nobody can connect
// an account they haven't proved is theirs.
import "server-only";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { accounts } from "@/db/schema";

/** Carries the choices made on the connect form (Settings → Accounts) through GitHub's sign-in page and back
 *  to /api/github/connect. Only ever set by the connect action, after the 18+
 *  box was ticked. */
export const PENDING_COOKIE = "holt_connect";

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
