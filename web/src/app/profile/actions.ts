"use server";
// Profile: save, skip the onboarding card, delete.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { deleteProfile, saveProfile } from "@/lib/api";
import { findHref, fromForm, SKIP_COOKIE } from "@/lib/profile";
import { currentUser } from "@/lib/session";

// Only our own pages, so a crafted form can't send people elsewhere.
const PAGES = ["/", "/me", "/find", "/hacktoberfest", "/settings"];
function back(form: FormData): string {
  const v = String(form.get("back") ?? "");
  return PAGES.includes(v) ? v : "/settings";
}

function withNotice(path: string, notice: string) {
  return path === "/settings" ? `/settings?profile=${notice}#profile` : `${path}?profile=${notice}`;
}

export async function save(form: FormData) {
  const to = back(form);
  const user = await currentUser();
  if (!user) redirect(`/signin?callbackUrl=${encodeURIComponent(to)}`);
  const prefs = fromForm(form);
  const r = await saveProfile(user.id, prefs);
  if (!r.ok) redirect(withNotice(to, r.status === 400 && r.error.message.includes("18") ? "adult" : "error"));
  revalidatePath("/", "layout");
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
  if (!user) redirect("/signin?callbackUrl=/settings");
  const r = await deleteProfile(user.id);
  revalidatePath("/", "layout");
  redirect(withNotice("/settings", r.ok ? "deleted" : "error"));
}
