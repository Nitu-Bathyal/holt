import NextAuth from "next-auth";
import type { Provider } from "next-auth/providers";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db } from "@/db";
import { reportSignIn } from "@/lib/api";
import { accounts, sessions, users, verificationTokens } from "@/db/schema";
import { authSecret } from "@/lib/auth-secret";
import { confirmedGitHub } from "@/lib/github-account";
import { withoutTokens } from "@/lib/oauth-account";

const providers: Provider[] = [];
if (process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET) providers.push(GitHub);
if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) providers.push(Google);

export const oauthProviders = providers.map((p) => (typeof p === "function" ? p() : p)).map((p) => ({ id: p.id, name: p.name }));

/** Development with no OAuth credentials gets a one-click dev sign-in. */
export const devSignInEnabled = process.env.NODE_ENV === "development" && providers.length === 0;

const adapter = DrizzleAdapter(db, {
  usersTable: users,
  accountsTable: accounts,
  sessionsTable: sessions,
  verificationTokensTable: verificationTokens,
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Sign-in stores the provider and account id only; see withoutTokens.
  adapter: { ...adapter, linkAccount: (account) => adapter.linkAccount!(withoutTokens(account)) },
  providers,
  session: { strategy: "database" },
  trustHost: true,
  secret: authSecret(process.env),
  pages: { signIn: "/signin" },
  callbacks: {
    // Runs once the provider has confirmed the account, before Auth.js links
    // it or refuses to. Connect GitHub (the Auth.js route) wants to know
    // which GitHub account that was; nothing else is listening.
    signIn({ account }) {
      const seen = confirmedGitHub.getStore();
      if (seen && account?.provider === "github") seen.id = account.providerAccountId;
      return true;
    },
    session({ session, user }) {
      session.user.id = user.id;
      return session;
    },
  },
  events: {
    // The server sends account emails (the welcome, once) to this address.
    async signIn({ user, isNewUser }) {
      if (user.id) await reportSignIn(user.id, user.email ?? null, Boolean(isNewUser));
    },
  },
});
