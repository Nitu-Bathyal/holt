"use server";
// GitHub in settings: connect (the form in Accounts), merging the account a
// GitHub sign-in belongs to, the statistics switch, disconnect.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { oauthProviders, signIn } from "@/auth";
import { connectGitHub, disconnectGitHub, setStatsOptOut } from "@/lib/api";
import { linkedGitHubId, MERGE_COOKIE, MERGE_COOKIE_PATH, mergeGitHubAccount, mergeProofFor, PENDING_COOKIE, PENDING_COOKIE_PATH, unlinkGitHubIfNotSignIn } from "@/lib/github-account";
import { currentUser } from "@/lib/session";
import { ACCOUNT_SETTINGS, connectFailed, CONNECT_GITHUB, PRIVACY_SETTINGS } from "@/lib/settings";

async function signedIn(back: string) {
  const user = await currentUser();
  if (!user) redirect(`/signin?callbackUrl=${encodeURIComponent(back)}`);
  return user;
}

export async function connect(form: FormData) {
  const user = await signedIn(CONNECT_GITHUB);
  if (form.get("adult") !== "on") redirect(connectFailed("adult"));
  const optOut = form.get("stats_opt_out") === "on";

  const githubId = await linkedGitHubId(user.id);
  if (githubId) {
    const r = await connectGitHub(user.id, githubId, optOut);
    if (!r.ok) redirect(connectFailed(r.status === 409 ? "taken" : "save"));
    revalidatePath("/settings", "layout");
    redirect(`${ACCOUNT_SETTINGS}?github=connected`);
  }

  // Signed in with Google (or dev sign-in): prove which GitHub account is
  // theirs first. GitHub signs them in, Auth.js links it to this user, and
  // /api/github/connect finishes the job.
  if (!oauthProviders.some((p) => p.id === "github")) redirect(connectFailed("unavailable"));
  (await cookies()).set(PENDING_COOKIE, optOut ? "opt-out" : "include", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: PENDING_COOKIE_PATH,
    maxAge: 600,
  });
  await signIn("github", { redirectTo: "/api/github/connect" });
}

/**
 * Merge the account that signs in with the GitHub account this browser just
 * confirmed into the one signed in here, then connect GitHub. Everything it
 * acts on comes from the session and the signed proof, nothing from the form.
 */
export async function merge() {
  const user = await signedIn(CONNECT_GITHUB);
  const proof = await mergeProofFor(user.id);
  if (!proof) redirect(connectFailed("link"));
  (await cookies()).delete({ name: MERGE_COOKIE, path: MERGE_COOKIE_PATH });

  if (!(await mergeGitHubAccount(proof.githubId, user.id))) redirect(connectFailed("save"));
  const r = await connectGitHub(user.id, proof.githubId, proof.optOut);
  // Saved repos, history and the plan all changed, not only settings.
  revalidatePath("/", "layout");
  if (!r.ok) redirect(connectFailed("save"));
  redirect(`${ACCOUNT_SETTINGS}?github=merged`);
}

export async function setStats(form: FormData) {
  const user = await signedIn(PRIVACY_SETTINGS);
  const r = await setStatsOptOut(user.id, form.get("stats_opt_out") === "on");
  revalidatePath("/settings", "layout");
  redirect(`${PRIVACY_SETTINGS}?github=${r.ok ? "saved" : "error"}`);
}

export async function disconnect() {
  const user = await signedIn(ACCOUNT_SETTINGS);
  const r = await disconnectGitHub(user.id);
  if (!r.ok) redirect(`${ACCOUNT_SETTINGS}?github=error`);
  await unlinkGitHubIfNotSignIn(user.id);
  revalidatePath("/settings", "layout");
  redirect(`${ACCOUNT_SETTINGS}?github=disconnected`);
}
