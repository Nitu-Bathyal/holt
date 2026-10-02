import type { Metadata } from "next";
import { DiscoverView } from "@/components/discover/discover-view";
import { parseSort } from "@/lib/discover";
import { requireUser } from "@/lib/session";

// For signed-in people (lib/gate.ts), so never in a search index.
export const metadata: Metadata = {
  title: "Discover repos",
  robots: { index: false },
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim().slice(0, 80) || null;

export default async function DiscoverPage({ searchParams }: PageProps<"/discover">) {
  const sp = await searchParams;
  const user = await requireUser("/discover", sp);
  return <DiscoverView user={user} sort={parseSort(sp.sort)} language={null} topic={one(sp.topic)?.toLowerCase() ?? null} />;
}
