// A small card after sign-in: say what you want once, and /find and
// /hacktoberfest start from it. Skippable; settings always has the full form.
import { cookies } from "next/headers";
import { skip } from "@/app/profile/actions";
import { getProfile } from "@/lib/api";
import { SKIP_COOKIE } from "@/lib/profile";
import { currentUser } from "@/lib/session";
import { ProfileForm } from "./profile-form";

export async function ProfileOnboarding({ back, className = "" }: { back: "/" | "/find" | "/hacktoberfest"; className?: string }) {
  const user = await currentUser();
  if (!user || (await cookies()).get(SKIP_COOKIE)) return null;
  const r = await getProfile(user.id);
  // No card when it's saved, or when the server can't tell us.
  if (!r.ok || r.data.profile) return null;

  return (
    <div className={className}>
    <section aria-labelledby="onboard-h" className="border border-blue/50 bg-panel p-5 shadow-soft sm:p-8 [&:has(details[open])>form]:hidden">
      <details className="group">
        <summary className="flex cursor-pointer list-none flex-wrap items-baseline justify-between gap-x-6 gap-y-2 [&::-webkit-details-marker]:hidden">
          <span>
            <span id="onboard-h" className="block text-[1.15rem] font-semibold tracking-tight">What are you after?</span>
            <span className="mt-1 block font-sans text-[0.9rem] text-muted">
              Pick your languages and how much time you have. Searches start there. Change it any time in settings.
            </span>
          </span>
          <span className="text-[0.85rem] text-blue group-open:hidden">[ set it up · 30 seconds → ]</span>
        </summary>
        <div className="mt-6 border-t border-line pt-6">
          <ProfileForm prefs={null} adultConfirmed={r.data.adult_confirmed} back={back}>
            <button type="submit" formAction={skip} formNoValidate className="text-[0.85rem] text-muted hover:text-ink">
              skip for now
            </button>
          </ProfileForm>
        </div>
      </details>
      <form action={skip} className="mt-3">
        <input type="hidden" name="back" value={back} />
        <button type="submit" className="text-[0.8rem] text-faint hover:text-ink">not now</button>
      </form>
    </section>
    </div>
  );
}
