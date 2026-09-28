"use server";
// The home's one-line nudge: dismissing it is remembered for a year.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { dismissedNudges, NUDGE_COOKIE } from "@/lib/home";

export async function dismissNudge(form: FormData) {
  const jar = await cookies();
  const next = [...new Set([...dismissedNudges(jar.get(NUDGE_COOKIE)?.value), ...dismissedNudges(String(form.get("nudge") ?? ""))])];
  jar.set(NUDGE_COOKIE, next.join(","), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 365 * 86_400,
  });
  redirect("/me");
}
