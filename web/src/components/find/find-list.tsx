"use client";

// Find results that carry on past the first part: what Holt's index has for
// the same filters, loaded as the reader nears the end of the list (or on the
// button alone, where more page follows the list). Scrolling never starts a
// GitHub search: the parts come from the index only (API.md, POST
// /v1/find/index). Each part is fitted to the reader on its own, so cards
// already on the page stay where they are.
import { FIND_FIRST } from "@/lib/find-picks";
import { chunks, FROM_START } from "@/lib/parts";
import { personalise, type Fit } from "@/lib/profile";
import { fromFind } from "@/lib/repo-card";
import type { FindResult } from "@/lib/types";
import { fetchPart } from "../discover/fetch-part";
import { PartsFooter, partsTail } from "../discover/parts-footer";
import { useParts } from "../discover/use-parts";
import { RepoGrid } from "../repo-card/repo-grid";
import { EmptyState } from "../shell/app-page";

const id = (r: FindResult) => r.repo.toLowerCase();

export function FindList({ results, more, auto, fit, days, saved, empty }: {
  /** The search's results, as the server sent them. */
  results: FindResult[];
  /** The search as a /find query string, when the list may load the rest of the index; null for the results alone (a search still running, a signed-out page). */
  more: string | null;
  /** False loads only on the button (use-parts.ts). */
  auto?: boolean;
  fit: Fit | null;
  days: number;
  saved?: string[] | null;
  empty?: React.ReactNode;
}) {
  const list = useParts<FindResult>({
    // A full first part may have more of the index behind it; a short one was everything.
    first: { items: results, next: more !== null && results.length >= FIND_FIRST ? FROM_START : null, total: results.length },
    id,
    storeKey: `find:${more ?? ""}`,
    auto,
    load: (cursor) => fetchPart<FindResult>("/api/find/more", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ q: more, cursor: cursor || null }) }),
  });
  const shown = chunks(list.state).flatMap((part) => personalise(part, fit));
  if (!shown.length && list.state.next === null) return <EmptyState title="No welcoming repos match that yet.">{empty}</EmptyState>;
  return (
    <>
      <RepoGrid repos={shown.map(fromFind)} days={days} saved={saved} verdict={false} tail={partsTail(list.state, { verdict: false })} />
      {more !== null && <PartsFooter list={list} shown={shown.length} />}
    </>
  );
}
