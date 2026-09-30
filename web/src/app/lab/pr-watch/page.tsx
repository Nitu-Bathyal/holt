// PROTOTYPE, don't merge. /lab/pr-watch: Holt Pro's PR watch (alerts on the
// bell and by email), on made-up data, so the owner can judge it on staging
// before anything real is built. Staging and dev only: production answers 404.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isAccess } from "./mock";
import { PrWatchLab } from "./_parts/lab";
import "./pr-watch.css";

export const metadata: Metadata = {
  title: "Lab: PR watch",
  robots: { index: false, follow: false },
};

// Staging is the only production build with ROBOTS_NOINDEX=1 (deploy/README.md).
export const dynamic = "force-dynamic";

export default async function PrWatchLabPage({ searchParams }: PageProps<"/lab/pr-watch">) {
  if (process.env.NODE_ENV === "production" && process.env.ROBOTS_NOINDEX !== "1") notFound();
  const sp = await searchParams;
  const state = Array.isArray(sp.state) ? sp.state[0] : sp.state;
  return <PrWatchLab initial={isAccess(state) ? state : "on"} />;
}
