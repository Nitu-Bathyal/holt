"use server";
// Profile: save, skip the onboarding card, delete.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { deleteProfile, saveProfile } from "@/lib/api";
import { PICKS_COOKIE } from "@/lib/find-picks";
import { findHref, fromForm, SKIP_COOKIE } from "@/lib/profile";
import { answer, BLANK, current, QUESTIONS, type Prefs } from "@/lib/profile-flow";
import { currentUser } from "@/lib/session";
import { PRIVACY_SETTINGS, PROFILE_SETTINGS } from "@/lib/settings";

// Only our own pages, so a crafted form can't send people elsewhere.
const PAGES = ["/", "/me", "/find", "/hacktoberfest", PROFILE_SETTINGS];
function back(form: FormData): string {
  const v = String(form.get("back") ?? "");
  return PAGES.includes(v) ? v : PROFILE_SETTINGS;
}

function withNotice(path: string, notice: string) {
  return `${path}?profile=${notice}`;
}

export async function save(form: FormData) {
  const to = back(form);
  const user = await currentUser();
  if (!user) redirect(`/signin?callbackUrl=${encodeURIComponent(to)}`);
  const prefs = fromForm(form);
  const r = await saveProfile(user.id, prefs);
  if (!r.ok) redirect(withNotice(to, r.status === 400 && r.error.message.includes("18") ? "adult" : "error"));
  revalidatePath("/", "layout");
  // A saved profile is the new starting point for /find, over the last picks there.
  (await cookies()).delete(PICKS_COOKIE);
  // From an onboarding card, straight to results that use it.
  if (to === "/" || to === "/find") redirect(findHref(r.data.profile ?? prefs, { profile: "saved" }));
  redirect(withNotice(to, "saved"));
}

export async function skip(form: FormData) {
  (await cookies()).set(SKIP_COOKIE, "1", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 365 * 86_400,
  });
  redirect(back(form));
}

export async function remove() {
  const user = await currentUser();
  if (!user) redirect(`/signin?callbackUrl=${PRIVACY_SETTINGS}`);
  const r = await deleteProfile(user.id);
  revalidatePath("/", "layout");
  redirect(withNotice(PRIVACY_SETTINGS, r.ok ? "deleted" : "error"));
}

/**
 * One answer from the first-time flow on /me. Saves the whole profile so far
 * and returns, without revalidating or touching cookies: either would refresh
 * /me and close the flow mid-way. `finish` does that at the end. It sends
 * adult_confirmed, so call it only after the 18+ start button (ProfileFlow).
 */
export async function saveStep(p: Prefs): Promise<{ ok: true } | { ok: false; adult: boolean }> {
  const user = await currentUser();
  if (!user) return { ok: false, adult: false };
  // Rebuilt from the answers, so only valid values reach the API.
  let clean = BLANK;
  for (const q of QUESTIONS) clean = answer(clean, q.id, current({ ...BLANK, ...p }, q.id));
  const r = await saveProfile(user.id, { ...clean, adult_confirmed: true });
  if (r.ok) return { ok: true };
  return { ok: false, adult: r.status === 400 && r.error.message.includes("18") };
}

/** The end of the flow: the picks on /find start from the profile now, then on to the picks. */
export async function finish() {
  revalidatePath("/", "layout");
  (await cookies()).delete(PICKS_COOKIE);
  redirect("/for-you");
}
