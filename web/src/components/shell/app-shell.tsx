// What the shells need from the server, once per full page load: who's
// signed in and what needs them.
import { cache, Suspense } from "react";
import { contributions } from "@/lib/api";
import { prGroups } from "@/lib/contributions";
import { clock } from "@/lib/home";
import type { SessionUser } from "@/lib/session";
import { sidebarGroups } from "@/lib/shell";
import { hacktoberfest } from "@/lib/site";
import { BellSlot } from "../alerts/bell-slot";
import { AppTopBar } from "../header";
import { Drawer, Sidebar } from "./sidebar";

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

export async function appShell(user: SessionUser, railCollapsed: boolean) {
  const badges: Record<string, React.ReactNode> = {
    // Streams in, so the shell never waits on it.
    prs: (
      <Suspense fallback={null}>
        <NeedsYouBadge userId={user.id} />
      </Suspense>
    ),
  };
  const nav = { groups: sidebarGroups(hacktoberfest() !== null), badges, user: { name: user.name || user.email || "You", image: user.image ?? null } };
  return {
    topBar: (
      <AppTopBar
        user={user}
        railCollapsed={railCollapsed}
        drawer={<Drawer {...nav} />}
        // Streams in like the badge; nothing while PR watch is switched off.
        bell={
          <Suspense fallback={null}>
            <BellSlot userId={user.id} />
          </Suspense>
        }
      />
    ),
    rail: <Sidebar {...nav} />,
  };
}
