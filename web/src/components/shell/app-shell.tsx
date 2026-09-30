// What the shells need from the server, once per full page load: who's
// signed in and their AI reports.
import { cache, Suspense } from "react";
import { contributions, me } from "@/lib/api";
import { prGroups } from "@/lib/contributions";
import { clock, statusLine } from "@/lib/home";
import type { SessionUser } from "@/lib/session";
import { sidebarGroups } from "@/lib/shell";
import { hacktoberfest } from "@/lib/site";
import { AppTopBar } from "../header";
import { Icon } from "./icons";
import { Drawer, Sidebar } from "./sidebar";

/** "3 AI reports left", or null when AI reports are off or the server didn't say. */
export async function creditsLine(user: SessionUser | null): Promise<string | null> {
  if (!user) return null;
  const account = await me(user.id);
  return (account.ok && statusLine({ waiting: 0, credits: account.data.credits })) || null;
}

/** Your open PRs that have waited longer than their repo usually takes to reply (lib/contributions.ts). */
const needsYou = cache(async (userId: string): Promise<number> => {
  const r = await contributions(userId);
  return r.ok ? prGroups(r.data.pull_requests, clock()).needs.length : 0;
});

async function NeedsYouBadge({ userId }: { userId: string }) {
  const n = await needsYou(userId);
  if (!n) return null;
  return (
    <span className="side-badge" data-tone="needs">
      {n}
      <span className="sr-only"> {n === 1 ? "needs" : "need"} you</span>
    </span>
  );
}

export async function appShell(user: SessionUser, credits: string | null, railCollapsed: boolean) {
  const season = hacktoberfest();
  const badges: Record<string, React.ReactNode> = {
    // Streams in, so the shell never waits on it.
    prs: (
      <Suspense fallback={null}>
        <NeedsYouBadge userId={user.id} />
      </Suspense>
    ),
  };
  if (season?.live)
    badges.find = (
      <span className="side-badge" data-tone="leaf" title={season.text}>
        <Icon name="leaf" className="size-3" />
        <span className="sr-only"> ({season.text})</span>
      </span>
    );
  const nav = { groups: sidebarGroups(), badges, user: { name: user.name || user.email || "You", image: user.image ?? null }, credits };
  return {
    topBar: <AppTopBar user={user} credits={credits} railCollapsed={railCollapsed} drawer={<Drawer {...nav} />} />,
    rail: <Sidebar {...nav} />,
  };
}
