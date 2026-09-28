"use server";
// The refresh button. The server decides whether GitHub is read again (at most
// every 15 minutes per user); the button's countdown is only a hint.
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { refreshContributions } from "@/lib/api";
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
