import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { oauthProviders, signOut } from "@/auth";
import { githubConnection } from "@/lib/api";
import { isAnotherAccountsSignIn, linkedGitHubId, mergeProofFor, signInProviders } from "@/lib/github-account";
import { currentUser } from "@/lib/session";
import { ACCOUNT_SETTINGS } from "@/lib/settings";
import { ConnectGitHubForm, GitHubConnectionRow, MergeAccountsForm } from "@/components/connect-github-card";
import { Block, Notice, SectionHead } from "@/components/settings/section-head";

export const metadata: Metadata = { title: "Connected accounts · Settings", robots: { index: false } };

const PROVIDER_NAME: Record<string, string> = { github: "GitHub", google: "Google" };

async function doSignOut() {
  "use server";
  await signOut({ redirectTo: "/" });
}

/** "GitHub", "Google or GitHub": how this person signs in, or null if unknown. */
async function signInWith(userId: string): Promise<string | null> {
  try {
    const names = (await signInProviders(userId)).map((p) => PROVIDER_NAME[p] ?? p);
    return names.length ? names.join(" or ") : null;
  } catch (e) {
    console.error("[holt] sign-in providers lookup failed:", (e as Error).message);
    return null;
  }
}

/**
 * Whether to offer a merge in place of "that GitHub account is taken": only
 * with this browser's fresh proof that GitHub confirmed the account, and only
 * while it still is another account's sign-in. The query string decides nothing.
 */
async function canMerge(userId: string): Promise<boolean> {
  try {
    const proof = await mergeProofFor(userId);
    return proof !== null && (await isAnotherAccountsSignIn(proof.githubId, userId));
  } catch (e) {
    console.error("[holt] merge offer lookup failed:", (e as Error).message);
    return false;
  }
}

export default async function AccountSettings({ searchParams }: PageProps<"/settings/accounts">) {
  const user = await currentUser();
  if (!user) redirect(`/signin?callbackUrl=${ACCOUNT_SETTINGS}`);
  const { github: notice, connect: connectError } = await searchParams;
  const [gh, via, githubId] = await Promise.all([githubConnection(user.id), signInWith(user.id), linkedGitHubId(user.id)]);
  const acct = gh.ok ? gh.data.account : null;
  const offerMerge = connectError === "taken" && gh.ok && !acct && (await canMerge(user.id));

  return (
    <section aria-labelledby="accounts-h">
      <SectionHead id="accounts" />

      {notice === "connected" && <Notice tone="good">GitHub connected.</Notice>}
      {notice === "merged" && <Notice tone="good">Accounts merged. GitHub connected.</Notice>}
      {notice === "disconnected" && (
        <Notice tone="plain">GitHub disconnected. We deleted the connection, the list of repos you viewed and your saved pull requests.</Notice>
      )}
      {notice === "error" && <Notice tone="bad">That didn&apos;t work. Try again in a minute.</Notice>}

      <Block title="Signing in">
        <div className="app-row flex flex-wrap justify-between">
          <div className="min-w-0 text-[0.9rem]">
            <p className="font-semibold [overflow-wrap:anywhere]">{user.email || user.name}</p>
            <p className="mt-1 text-muted">{via ? `You sign in with ${via}.` : "Signed in."}</p>
          </div>
          <form action={doSignOut}>
            <button type="submit" className="btn-ghost">sign out</button>
          </form>
        </div>
      </Block>

      <Block id="github" title="GitHub" className="mt-8">
        {!gh.ok ? (
          <p role="alert" className="border border-orange/50 px-4 py-3 font-sans text-[0.9rem] text-orange">{gh.error.message}</p>
        ) : acct ? (
          <GitHubConnectionRow acct={acct} />
        ) : offerMerge ? (
          <MergeAccountsForm />
        ) : (
          <ConnectGitHubForm viaGitHub={!githubId} canLink={oauthProviders.some((p) => p.id === "github")} error={typeof connectError === "string" ? connectError : undefined} />
        )}
      </Block>
    </section>
  );
}
