"use client";

// Every pick as the home's cards: the first part comes with the page, the
// rest load as the reader nears the end, the way a board's do (use-parts.ts).
import { fetchPart } from "@/components/discover/fetch-part";
import { PartsFooter, partsTail } from "@/components/discover/parts-footer";
import { useParts } from "@/components/discover/use-parts";
import { RepoGrid } from "@/components/repo-card/repo-grid";
import type { Part } from "@/lib/parts";
import { fromPick } from "@/lib/repo-card";
import type { Recommendation } from "@/lib/types";

const id = (p: Recommendation) => p.repo.toLowerCase();
const load = (cursor: string) => fetchPart<Recommendation>(`/api/picks?cursor=${encodeURIComponent(cursor)}`, { cache: "no-store" });

export function PicksList({ first, saved, why }: { first: Part<Recommendation>; saved: string[]; why: boolean }) {
  const list = useParts({ first, id, storeKey: "picks", load });
  return (
    <>
      <RepoGrid repos={list.state.items.map(fromPick)} cols={3} saved={saved} topicBase="/discover" why={why} tail={partsTail(list.state, { count: 3 })} />
      <PartsFooter list={list} />
    </>
  );
}
