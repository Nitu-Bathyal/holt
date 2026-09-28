import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { signOut } from "@/auth";
import { githubConnection } from "@/lib/api";
import { signInProviders } from "@/lib/github-account";
import { currentUser } from "@/lib/session";
import { ACCOUNT_SETTINGS } from "@/lib/settings";
import { GitHubConnectionCard } from "@/components/connect-github-card";
import { Notice, SectionHead } from "@/components/settings/section-head";

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

export default async function AccountSettings({ searchParams }: PageProps<"/settings/accounts">) {
  const user = await currentUser();
  if (!user) redirect(`/signin?callbackUrl=${ACCOUNT_SETTINGS}`);
  const { github: notice } = await searchParams;
  const [gh, via] = await Promise.all([githubConnection(user.id), signInWith(user.id)]);
  const acct = gh.ok ? gh.data.account : null;

  return (
    <section aria-labelledby="accounts-h">
      <SectionHead id="accounts" />

      {notice === "connected" && <Notice tone="good">GitHub connected.</Notice>}
      {notice === "disconnected" && (
        <Notice tone="plain">GitHub disconnected. We deleted the connection, the list of repos you viewed and your saved pull requests.</Notice>
      )}
      {notice === "error" && <Notice tone="bad">That didn&apos;t work. Try again in a minute.</Notice>}

      <h3 className="text-[1.1rem] font-semibold tracking-tight">Signing in</h3>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border border-line-strong bg-panel p-4 shadow-soft">
        <div className="min-w-0 text-[0.9rem]">
          <p className="font-semibold [overflow-wrap:anywhere]">{user.email || user.name}</p>
          <p className="mt-1 text-muted">{via ? `You sign in with ${via}.` : "Signed in."}</p>
        </div>
        <form action={doSignOut}>
          <button type="submit" className="btn-ghost">sign out</button>
        </form>
      </div>

      <h3 id="github" className="mt-8 scroll-mt-24 text-[1.1rem] font-semibold tracking-tight">GitHub</h3>
      <div className="mt-3">
        {gh.ok ? (
          <GitHubConnectionCard acct={acct} />
        ) : (
          <p role="alert" className="border border-orange/50 px-4 py-3 font-sans text-[0.9rem] text-orange">{gh.error.message}</p>
        )}
      </div>
    </section>
  );
}
