"use server";
// The refresh button. The server decides whether GitHub is read again (at most
// every 15 minutes per user); the button's countdown is only a hint.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { refreshContributions, setContributionCounted } from "@/lib/api";
import { dismissedNudges, NUDGE_COOKIE } from "@/lib/home";
import { currentUser } from "@/lib/session";

const PATH = "/me/contributions";

export async function refresh() {
  const user = await currentUser();
  if (!user) redirect(`/signin?callbackUrl=${PATH}`);
  const r = await refreshContributions(user.id);
  revalidatePath(PATH);
  if (!r.ok) redirect(`${PATH}?refresh=${r.error.code === "rate_limited" ? "limited" : "error"}`);
  // A cached answer carries a `fetched_at` from before this click.
  const fresh = Date.now() - Date.parse(r.data.fetched_at) < 60_000;
  redirect(`${PATH}?refresh=${fresh ? "done" : "wait"}`);
}

/**
 * Count a repo's pull requests in your numbers or not. `counted` is "no"
 * (leave it out), "yes" (count it, over Holt's own-project default) or
 * "reset" (back to the default).
 */
export async function setCounted(form: FormData) {
  const user = await currentUser();
  if (!user) redirect(`/signin?callbackUrl=${PATH}`);
  const repo = String(form.get("repo") ?? "");
  const choice = String(form.get("counted") ?? "");
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !["yes", "no", "reset"].includes(choice)) redirect(PATH);
  const r = await setContributionCounted(user.id, repo, choice === "reset" ? null : choice === "yes");
  revalidatePath(PATH);
  revalidatePath("/me");
  if (!r.ok) redirect(`${PATH}?count=error`);
}

/** Close the "turn on alerts" card for a year (the home nudges' cookie). */
export async function dismissAlertsCard() {
  const jar = await cookies();
  const next = [...new Set([...dismissedNudges(jar.get(NUDGE_COOKIE)?.value), "alerts"])];
  jar.set(NUDGE_COOKIE, next.join(","), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 365 * 86_400,
  });
  revalidatePath(PATH);
}
