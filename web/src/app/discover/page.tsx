import type { Metadata } from "next";
import { DiscoverView } from "@/components/discover/discover-view";
import { parseSort } from "@/lib/discover";

const base: Metadata = {
  title: "Discover repos",
  description: "Open-source repos ranked by how they treat outside contributors: replies, merges and how fast. Built from Holt's rules, never AI.",
  alternates: { canonical: "/discover" },
};

export async function generateMetadata({ searchParams }: PageProps<"/discover">): Promise<Metadata> {
  return Object.keys(await searchParams).length ? { ...base, robots: { index: false } } : base;
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim().slice(0, 80) || null;

export default async function DiscoverPage({ searchParams }: PageProps<"/discover">) {
  const sp = await searchParams;
  return <DiscoverView sort={parseSort(sp.sort)} language={null} topic={one(sp.topic)?.toLowerCase() ?? null} />;
}
