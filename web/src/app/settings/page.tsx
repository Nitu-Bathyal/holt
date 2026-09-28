import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getProfile, githubConnection, me } from "@/lib/api";
import { describe } from "@/lib/profile";
import { currentUser } from "@/lib/session";
import { legacySettingsHref, SECTIONS, type SectionId } from "@/lib/settings";
import { SettingsHashRedirect } from "@/components/settings/hash-redirect";

export const metadata: Metadata = { title: "Settings", robots: { index: false } };

// The overview: every section with where it stands, one tap from each.
export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const user = await currentUser();
  if (!user) redirect("/signin?callbackUrl=/settings");
  const sp = await searchParams;
  // Old form results (?claimed=1, ?github=saved) belong to a section now.
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) for (const one of [v ?? []].flat()) q.append(k, one);
  const moved = legacySettingsHref("", q.toString());
  if (moved) redirect(moved);

  const [account, profile, gh] = await Promise.all([me(user.id), getProfile(user.id), githubConnection(user.id)]);
  const c = account.ok ? account.data.credits : null;
  const p = profile.ok ? profile.data.profile : null;
  const acct = gh.ok ? gh.data.account : null;

  const status: Record<SectionId, string | null> = {
    profile: profile.ok ? (p ? describe(p) : "Not set yet. Your picks need it.") : null,
    "ai-reports": c ? `${c.balance} ${c.purchased > 0 ? "credits" : "free AI reports"} left${c.can_claim ? ". This week's free one is ready to claim." : "."}` : null,
    accounts: gh.ok ? (acct ? `GitHub connected as @${acct.login}.` : "GitHub not connected.") : null,
    privacy: acct ? (acct.stats_opt_out ? "You're left out of statistics." : "Your contributions count, without your name, in repo statistics.") : null,
  };

  return (
    <>
      <SettingsHashRedirect />
      <ul className="divide-y divide-line border-y border-line">
        {SECTIONS.map((s) => (
          <li key={s.id}>
            <Link href={s.href} className="group flex items-center gap-4 py-4 transition-colors hover:bg-panel-2 sm:px-3">
              <span className="min-w-0 flex-1">
                <span className="block text-[1rem] font-semibold group-hover:text-blue">{s.title}</span>
                <span className="mt-1 block font-sans text-[0.875rem] text-muted">{status[s.id] ?? s.blurb}</span>
              </span>
              <span aria-hidden="true" className="text-faint group-hover:text-blue">›</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
