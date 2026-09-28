// The profile section in settings: the full form, and deleting it.
import Link from "next/link";
import { remove } from "@/app/profile/actions";
import { getProfile } from "@/lib/api";
import { shortDate } from "@/lib/format";
import { ProfileForm } from "./profile-form";

const NOTICES: Record<string, { tone: string; text: string }> = {
  saved: { tone: "text-green border-green/50 bg-green/10", text: "Saved. Find and Hacktoberfest now start from your profile." },
  deleted: { tone: "text-muted border-line-strong", text: "Profile deleted." },
  adult: { tone: "text-orange border-orange/50 bg-orange/10", text: "Tick the 18+ box to save a profile." },
  error: { tone: "text-orange border-orange/50 bg-orange/10", text: "That didn't work. Try again in a minute." },
};

export async function ProfileCard({ userId, notice }: { userId: string; notice?: string | string[] }) {
  const r = await getProfile(userId);
  const p = r.ok ? r.data.profile : null;
  const n = typeof notice === "string" ? NOTICES[notice] : undefined;

  return (
    <section id="profile" aria-labelledby="profile-h" className="mt-10 scroll-mt-24 border border-line-strong bg-panel p-5 shadow-soft sm:p-8">
      <h2 id="profile-h" className="text-[1.3rem] font-semibold tracking-tight">Your profile</h2>
      <p className="prose-sans mt-2 text-[0.95rem]">
        Say what you&apos;re after once. <Link href="/find" className="text-link">Find</Link> and{" "}
        <Link href="/hacktoberfest" className="text-link">Hacktoberfest</Link> start from it. You can still change any search.
      </p>
      {n && <p role="status" className={`mt-4 border px-4 py-3 font-sans text-[0.9rem] ${n.tone}`}>{n.text}</p>}
      {!r.ok && <p role="alert" className="mt-4 border border-orange/50 px-4 py-3 font-sans text-[0.9rem] text-orange">{r.error.message}</p>}
      {r.ok && (
        <div className="mt-6">
          <ProfileForm prefs={p} adultConfirmed={r.data.adult_confirmed} back="/settings" submitLabel={p ? "save changes" : "save my profile"} />
        </div>
      )}
      {p && (
        <form action={remove} className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
          <p className="font-sans text-[0.8rem] text-faint">
            {p.updated_at && <>Last saved {shortDate(p.updated_at)}. </>}
            See <Link href="/privacy#profile" className="text-link">what we keep</Link>.
          </p>
          <button type="submit" className="btn-ghost text-orange">delete my profile</button>
        </form>
      )}
    </section>
  );
}
