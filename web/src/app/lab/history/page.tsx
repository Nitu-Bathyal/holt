// PROTOTYPE, don't merge. /lab/history: four ways to show someone's
// open-source history (docs/design/HISTORY.md), on made-up data, so the owner
// can pick one on staging before anything real is built.
import type { Metadata } from "next";
import { HistoryLab } from "./_parts/lab";
import "./history.css";

export const metadata: Metadata = {
  title: "Lab: contribution history",
  robots: { index: false, follow: false },
};

export default async function HistoryLabPage({ searchParams }: PageProps<"/lab/history">) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  return <HistoryLab concept={one(sp.concept)} person={one(sp.person)} />;
}
