import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/session";
import { motionFromCookies } from "@/lib/motion";
import { DISPLAY_SETTINGS } from "@/lib/settings";
import { MotionChoice } from "@/components/settings/motion-choice";
import { SectionHead } from "@/components/settings/section-head";

export const metadata: Metadata = { title: "Display · Settings", robots: { index: false } };

export default async function DisplaySettings() {
  const user = await currentUser();
  if (!user) redirect(`/signin?callbackUrl=${DISPLAY_SETTINGS}`);
  const motion = motionFromCookies(await cookies());

  return (
    <section aria-labelledby="display-h">
      <SectionHead id="display" />
      <div className="border border-line-strong bg-panel p-4 shadow-soft">
        <MotionChoice initial={motion} />
      </div>
    </section>
  );
}
