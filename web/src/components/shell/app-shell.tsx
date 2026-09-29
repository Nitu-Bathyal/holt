// What the shells need from the server, once per full page load: who's
// signed in and their AI reports.
import { me } from "@/lib/api";
import { statusLine } from "@/lib/home";
import type { SessionUser } from "@/lib/session";
import { sidebarGroups } from "@/lib/shell";
import { AppTopBar } from "../header";
import { Drawer, Sidebar } from "./sidebar";

/** "3 AI reports left", or null when AI reports are off or the server didn't say. */
export async function creditsLine(user: SessionUser | null): Promise<string | null> {
  if (!user) return null;
  const account = await me(user.id);
  return (account.ok && statusLine({ waiting: 0, credits: account.data.credits })) || null;
}

export async function appShell(user: SessionUser, credits: string | null) {
  const nav = { groups: sidebarGroups() };
  return {
    topBar: <AppTopBar user={user} credits={credits} drawer={<Drawer {...nav} />} />,
    rail: <Sidebar {...nav} />,
  };
}
