// What the shells need from the server, once per full page load: who's
// signed in, their AI reports, whether pre-flight runs here, and whether the
// sidebar was left folded.
import { cookies } from "next/headers";
import { me, preflightState } from "@/lib/api";
import { showPreflight } from "@/lib/preflight";
import { statusLine } from "@/lib/home";
import type { SessionUser } from "@/lib/session";
import { sidebarGroups, SIDEBAR_COOKIE } from "@/lib/shell";
import { hacktoberfest } from "@/lib/site";
import { AppTopBar, doSignOut } from "../header";
import { Drawer, Sidebar } from "./sidebar";

// Pre-flight is on (and on sale) or not for the whole server, so one answer serves everyone for a while.
let preflight: { on: boolean; at: number } | null = null;
async function preflightOn(): Promise<boolean> {
  if (preflight && Date.now() - preflight.at < 10 * 60_000) return preflight.on;
  const r = await preflightState({}, {});
  if (!r.ok) return preflight?.on ?? false;
  preflight = { on: showPreflight(r.data), at: Date.now() };
  return preflight.on;
}

/** "3 AI reports left", or null when AI reports are off or the server didn't say. */
export async function creditsLine(user: SessionUser | null): Promise<string | null> {
  if (!user) return null;
  const account = await me(user.id);
  return (account.ok && statusLine({ waiting: 0, credits: account.data.credits })) || null;
}

export async function appShell(user: SessionUser, credits: string | null) {
  const [on, jar] = await Promise.all([preflightOn(), cookies()]);
  const groups = sidebarGroups({ hacktoberfest: hacktoberfest()?.live === true, preflight: on });
  const nav = { groups, credits, signOut: doSignOut };
  return {
    topBar: <AppTopBar user={user} credits={credits} drawer={<Drawer {...nav} />} />,
    rail: <Sidebar {...nav} initialFolded={jar.get(SIDEBAR_COOKIE)?.value === "folded"} />,
  };
}
