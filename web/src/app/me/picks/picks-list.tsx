"use client";

import { RepoGrid } from "@/components/repo-card/repo-grid";
import { ListFoot, usePagedList } from "@/components/shell/load-more";
import type { Part } from "@/lib/paged-list";
import { fromPick } from "@/lib/repo-card";
import type { Recommendation } from "@/lib/types";

async function load(offset: number): Promise<Part<Recommendation>> {
  const res = await fetch(`/api/picks?offset=${offset}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`picks: ${res.status}`);
  const data = (await res.json()) as { picks: Recommendation[]; next: number | null };
  return { items: data.picks, next: data.next };
}

const key = (p: Recommendation) => p.repo.toLowerCase();

/** Every pick as the home's cards: `first` came with the page, the rest load as the reader nears the end. */
export function PicksList({ first, saved, why }: { first: Part<Recommendation>; saved: string[]; why: boolean }) {
  const list = usePagedList(first, load, key);
  return (
    <>
      <RepoGrid repos={list.items.map(fromPick)} cols={3} saved={saved} topicBase="/discover" why={why} />
      <ListFoot list={list} end="No more picks." />
    </>
  );
}
