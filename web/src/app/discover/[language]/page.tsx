import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DiscoverView } from "@/components/discover/discover-view";
import { discover } from "@/lib/api";
import { boardTitle, languageFromSlug, languageSlug, parseSort } from "@/lib/discover";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim().slice(0, 80) || null;

/** The language a slug names, among the ones Holt has checked repos in. */
async function language(slug: string): Promise<string | null> {
  const r = await discover("welcoming", null, null);
  if (!r.ok) return decodeURIComponent(slug); // let the board show the error
  return languageFromSlug(slug, r.data.languages.map((l) => l.name));
}

export async function generateMetadata({ params }: PageProps<"/discover/[language]">): Promise<Metadata> {
  const name = await language((await params).language);
  if (!name) notFound();
  return {
    title: boardTitle("welcoming", name),
    description: `${name} repos that are worth your time, ranked by how they treat outside contributors: replies, merges and how fast. Built from Holt's rules, never AI.`,
    alternates: { canonical: `/discover/${languageSlug(name)}` },
  };
}

export default async function LanguageBoard({ params, searchParams }: PageProps<"/discover/[language]">) {
  const [{ language: slug }, sp] = await Promise.all([params, searchParams]);
  const name = await language(slug);
  if (!name) notFound();
  return <DiscoverView sort={parseSort(sp.sort)} language={name} topic={one(sp.topic)?.toLowerCase() ?? null} />;
}
