import { fromFind } from "@/lib/repo-card";
import type { FindResult } from "@/lib/types";
import { RepoGrid } from "../repo-card/repo-grid";
import { EmptyState } from "../shell/app-page";

/**
 * Find results as compact cards; each opens into the focus view with its starter issues. `empty` is the one thing to try when there are none.
 * Find only lists repos worth your time (API.md), so the cards leave the verdict out and the status line says it once.
 */
export function FindResults({ results, days, saved, empty }: { results: FindResult[]; days: number; saved?: string[] | null; empty?: React.ReactNode }) {
  if (!results.length) return <EmptyState title="No welcoming repos match that yet.">{empty}</EmptyState>;
  return <RepoGrid repos={results.map(fromFind)} days={days} saved={saved} verdict={false} />;
}
