import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { alertList, entitlements, getProfile, githubConnection } from "@/lib/api";
import { alertView } from "@/lib/alerts";
import { shortDate } from "@/lib/format";
import { MOTION_OPTIONS, motionFromCookies } from "@/lib/motion";
import { describe } from "@/lib/profile";
import { currentUser } from "@/lib/session";
import { legacySettingsHref, sectionsFor, type SectionId } from "@/lib/settings";
import { SettingsHashRedirect } from "@/components/settings/hash-redirect";

export const metadata: Metadata = { title: "Settings", robots: { index: false } };

// The overview: every section with where it stands, one tap from each.
export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const user = await currentUser();
  if (!user) redirect("/signin?callbackUrl=/settings");
  const sp = await searchParams;
  // Old form results (?subscribed=1, ?github=saved) belong to a section now.
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) for (const one of [v ?? []].flat()) q.append(k, one);
  const moved = legacySettingsHref("", q.toString());
  if (moved) redirect(moved);

  const [covered, profile, gh, alerts, jar] = await Promise.all([entitlements(user.id), getProfile(user.id), githubConnection(user.id), alertList(user.id), cookies()]);
  const watch = alerts.ok ? alertView(alerts.data.access, alerts.data.enabled) : "hidden";
  const motion = motionFromCookies(jar);
  const e = covered.ok ? covered.data : null;
  const plansLeft = e?.features.find((f) => f.feature === "merge_plan")?.left ?? null;
  const p = profile.ok ? profile.data.profile : null;
  const acct = gh.ok ? gh.data.account : null;

  const status: Record<SectionId, string | null> = {
    profile: profile.ok ? (p ? describe(p) : "Not set yet. Your picks need it.") : null,
    plan: e ? `${e.plan === "pro" ? `Pro${e.plan_expires_at ? ` until ${shortDate(e.plan_expires_at)}` : ""}` : "Free"}.${plansLeft == null ? "" : ` ${plansLeft} merge plan${plansLeft === 1 ? "" : "s"} left.`}` : null,
    accounts: gh.ok ? (acct ? `GitHub connected as @${acct.login}.` : "GitHub not connected.") : null,
    display: `${MOTION_OPTIONS.find((o) => o.value === motion)!.label}.`,
    alerts: alerts.ok && watch === "on" ? `Watching ${alerts.data.watching} pull request${alerts.data.watching === 1 ? "" : "s"}.` : watch === "ended" ? "Ended." : watch === "off" ? "Off." : null,
    privacy: acct ? (acct.stats_opt_out ? "You're left out of statistics." : "Your contributions count, without your name, in repo statistics.") : null,
  };

  return (
    <>
      <SettingsHashRedirect />
      <h2 className="sr-only">All settings</h2>
      <ul className="border-t border-line">
        {sectionsFor(watch !== "hidden").map((s) => (
          <li key={s.id}>
            <Link href={s.href} className="app-row group grid-cols-[minmax(0,1fr)_auto]">
              <span className="min-w-0">
                <span className="block text-[0.95rem] font-semibold group-hover:text-blue">{s.title}</span>
                <span className="mt-1 block font-sans text-[0.9rem] text-muted">{status[s.id] ?? s.blurb}</span>
              </span>
              <span aria-hidden="true" className="text-faint group-hover:text-blue">›</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
