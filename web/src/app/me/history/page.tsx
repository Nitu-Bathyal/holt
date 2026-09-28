import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CatFace } from "@/components/cat-face";
import { ErrorPanel } from "@/components/error-panel";
import { CheckedList } from "@/components/home/checked-list";
import { PageTransition } from "@/components/motion/page-transition";
import { AppPageHeader } from "@/components/shell/app-page";
import { history } from "@/lib/api";
import { currentUser } from "@/lib/session";
import { CHECK_HREF } from "@/lib/shell";

export const metadata: Metadata = { title: "Repos you checked", robots: { index: false } };

export default async function HistoryPage() {
  const user = await currentUser();
  if (!user) redirect("/signin?callbackUrl=/me/history");
  const r = await history(user.id);

  return (
    <PageTransition>
      <div className="wrap max-w-3xl pb-14">
        <AppPageHeader title="Repos you checked" lead="Every report you ran while signed in, AI reports included." />
        {!r.ok ? (
          <ErrorPanel error={r.error} retryHref="/me/history" />
        ) : r.data.items.length === 0 ? (
          <div className="border border-dashed border-line-strong p-8 text-center">
            <CatFace mood="startled" className="text-[1.6rem]" />
            <p className="mt-4 font-sans text-muted">Nothing yet. Reports you run while signed in show up here.</p>
            <Link href={CHECK_HREF} className="bracket-link mt-6">[ check a repo → ]</Link>
          </div>
        ) : (
          <CheckedList items={r.data.items} />
        )}
      </div>
    </PageTransition>
  );
}
