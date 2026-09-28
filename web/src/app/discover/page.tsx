import type { Metadata } from "next";
import { DiscoverView } from "@/components/discover/discover-view";
import { parseSort } from "@/lib/discover";

export const metadata: Metadata = {
  title: "Discover repos",
  description: "Open-source repos ranked by how they treat outside contributors: replies, merges and how fast. Built from Holt's rules, never AI.",
  alternates: { canonical: "/discover" },
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim().slice(0, 80) || null;

export default async function DiscoverPage({ searchParams }: PageProps<"/discover">) {
  const sp = await searchParams;
  return <DiscoverView sort={parseSort(sp.sort)} language={null} topic={one(sp.topic)?.toLowerCase() ?? null} />;
}
