import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { remove } from "@/app/profile/actions";
import { getProfile, githubConnection } from "@/lib/api";
import { currentUser } from "@/lib/session";
import { ACCOUNT_SETTINGS, PRIVACY_SETTINGS, PROFILE_SETTINGS } from "@/lib/settings";
import { StatsSwitch } from "@/components/connect-github-card";
import { ContactEmail } from "@/components/legal-page";
import { Notice, SectionHead } from "@/components/settings/section-head";

export const metadata: Metadata = { title: "Privacy and data | Settings", robots: { index: false } };

const H3 = "text-[1.125rem] font-semibold tracking-tight";

export default async function PrivacySettings({ searchParams }: PageProps<"/settings/privacy">) {
  const user = await currentUser();
  if (!user) redirect(`/signin?callbackUrl=${PRIVACY_SETTINGS}`);
  const sp = await searchParams;
  const [gh, profile] = await Promise.all([githubConnection(user.id), getProfile(user.id)]);
  const acct = gh.ok ? gh.data.account : null;
  const p = profile.ok ? profile.data.profile : null;

  return (
    <section aria-labelledby="privacy-h">
      <SectionHead id="privacy">
        <p>
          Holt keeps little: your sign-in details, the reports you ran, and what you chose to save here. The{" "}
          <Link href="/privacy" className="text-link">privacy policy</Link> has the full list.
        </p>
      </SectionHead>

      {sp.github === "saved" && <Notice tone="good">Saved.</Notice>}
      {sp.profile === "deleted" && <Notice tone="plain">Profile deleted.</Notice>}
      {(sp.github === "error" || sp.profile === "error") && <Notice tone="bad">That didn&apos;t work. Try again in a minute.</Notice>}

      <h3 id="stats" className={`${H3} scroll-mt-24`}>Statistics</h3>
      <div className="mt-3 border border-line-strong bg-panel p-4 shadow-soft">
        {acct ? (
          <StatsSwitch acct={acct} />
        ) : (
          <p className="font-sans text-[0.875rem] text-muted">
            Only counts once you <Link href={ACCOUNT_SETTINGS} className="text-link">connect GitHub</Link>. Nothing of yours is in any statistics now.
          </p>
        )}
      </div>

      <h3 className={`${H3} mt-8`}>Your profile</h3>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border border-line-strong bg-panel p-4 shadow-soft">
        <p className="min-w-0 flex-1 basis-56 font-sans text-[0.875rem] text-muted">
          {p ? "Your languages, time, experience and topics. Deleting it doesn't touch your history." : <>No profile saved. <Link href={PROFILE_SETTINGS} className="text-link">Set one up</Link> for picks.</>}
        </p>
        {p && (
          <form action={remove}>
            <button type="submit" className="btn-ghost text-orange">delete my profile</button>
          </form>
        )}
      </div>

      <h3 className={`${H3} mt-8`}>Your account</h3>
      <p className="prose-sans mt-2 text-[0.875rem]">
        To delete your account and everything tied to it, or to get a copy of what we hold, email <ContactEmail /> from the address you sign in with.
      </p>
    </section>
  );
}
