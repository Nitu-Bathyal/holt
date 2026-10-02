"use client";

// A board's cards (Browse): the first part comes with the page, and the next
// ones load as the reader nears the end of the list (use-parts.ts).
import { boardHref } from "@/lib/discover";
import type { Part } from "@/lib/parts";
import { fromDiscover } from "@/lib/repo-card";
import type { DiscoverRepo, DiscoverSort } from "@/lib/types";
import { RepoGrid } from "../repo-card/repo-grid";
import { fetchPart } from "./fetch-part";
import { PartsFooter, partsTail } from "./parts-footer";
import { useParts } from "./use-parts";

const id = (r: DiscoverRepo) => r.repo.toLowerCase();

export function BoardList({ sort, language, topic, first, saved }: {
  sort: DiscoverSort;
  language: string | null;
  topic: string | null;
  first: Part<DiscoverRepo>;
  saved: string[] | null;
}) {
  const list = useParts({
    first,
    id,
    storeKey: `board:${boardHref({ sort, language, topic })}`,
    load: (cursor) => {
      const q = new URLSearchParams({ sort, cursor });
      if (language) q.set("language", language);
      if (topic) q.set("topic", topic);
      return fetchPart<DiscoverRepo>(`/api/discover?${q}`);
    },
  });
  return (
    <>
      {/* The welcoming board is all "Worth your time", so its cards leave the verdict out like Find's; the others mix verdicts. */}
      <RepoGrid repos={list.state.items.map(fromDiscover)} topicBase={boardHref({ sort, language })} saved={saved} verdict={false} tail={partsTail(list.state, { verdict: false })} />
      <PartsFooter list={list} />
    </>
  );
}
