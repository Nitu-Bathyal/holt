"use server";
// Connect GitHub: connect, the statistics switch, disconnect.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { oauthProviders, signIn } from "@/auth";
import { connectGitHub, disconnectGitHub, setStatsOptOut } from "@/lib/api";
import { linkedGitHubId, PENDING_COOKIE, unlinkGitHubIfNotSignIn } from "@/lib/github-account";
import { currentUser } from "@/lib/session";

async function signedIn(back: string) {
  const user = await currentUser();
  if (!user) redirect(`/signin?callbackUrl=${encodeURIComponent(back)}`);
  return user;
}

export async function connect(form: FormData) {
  const user = await signedIn("/connect");
  if (form.get("adult") !== "on") redirect("/connect?error=adult");
  const optOut = form.get("stats_opt_out") === "on";

  const githubId = await linkedGitHubId(user.id);
  if (githubId) {
    const r = await connectGitHub(user.id, githubId, optOut);
    if (!r.ok) redirect(`/connect?error=${r.status === 409 ? "taken" : "save"}`);
    revalidatePath("/settings");
    redirect("/settings?github=connected");
  }

  // Signed in with Google (or dev sign-in): prove which GitHub account is
  // theirs first. GitHub signs them in, Auth.js links it to this user, and
  // /api/github/connect finishes the job.
  if (!oauthProviders.some((p) => p.id === "github")) redirect("/connect?error=unavailable");
  (await cookies()).set(PENDING_COOKIE, optOut ? "opt-out" : "include", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/github/connect",
    maxAge: 600,
  });
  await signIn("github", { redirectTo: "/api/github/connect" });
}

export async function setStats(form: FormData) {
  const user = await signedIn("/settings");
  const r = await setStatsOptOut(user.id, form.get("stats_opt_out") === "on");
  revalidatePath("/settings");
  redirect(r.ok ? "/settings?github=saved#github" : "/settings?github=error#github");
}

export async function disconnect() {
  const user = await signedIn("/settings");
  const r = await disconnectGitHub(user.id);
  if (!r.ok) redirect("/settings?github=error#github");
  await unlinkGitHubIfNotSignIn(user.id);
  revalidatePath("/settings");
  redirect("/settings?github=disconnected#github");
}
