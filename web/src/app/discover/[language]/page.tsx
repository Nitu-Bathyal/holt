import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DiscoverView } from "@/components/discover/discover-view";
import { discover } from "@/lib/api";
import { boardTitle, languageFromSlug, parseSort } from "@/lib/discover";
import { requireUser } from "@/lib/session";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim().slice(0, 80) || null;

/** The language a slug names, among the ones Holt has checked repos in. */
async function language(slug: string): Promise<string | null> {
  const r = await discover("welcoming", null, null);
  if (!r.ok) return decodeURIComponent(slug); // let the board show the error
  return languageFromSlug(slug, r.data.languages.map((l) => l.name));
}

// For signed-in people (lib/gate.ts), so never in a search index; signed out, not even the title is worked out.
export async function generateMetadata({ params, searchParams }: PageProps<"/discover/[language]">): Promise<Metadata> {
  const [{ language: slug }, sp] = await Promise.all([params, searchParams]);
  await requireUser(`/discover/${slug}`, sp);
  const name = await language(slug);
  if (!name) notFound();
  return { title: boardTitle("welcoming", name), robots: { index: false } };
}

export default async function LanguageBoard({ params, searchParams }: PageProps<"/discover/[language]">) {
  const [{ language: slug }, sp] = await Promise.all([params, searchParams]);
  const user = await requireUser(`/discover/${slug}`, sp);
  const name = await language(slug);
  if (!name) notFound();
  return <DiscoverView user={user} sort={parseSort(sp.sort)} language={name} topic={one(sp.topic)?.toLowerCase() ?? null} />;
}
