"use client";

import { startTransition, useEffect, useState } from "react";
import type { ApiError, FindResult } from "@/lib/types";

export interface FindJob {
  stage: { stage: string; progress: number };
  results: FindResult[] | null;
  error: ApiError | null;
}

/** Follows a queued /v1/find job (API.md allows 202 for slow searches) over SSE. */
export function useFindJob(jobId: string | null): FindJob {
  const [state, setState] = useState<FindJob & { jobId: string | null }>({ jobId, ...fresh() });
  // A new job starts from nothing (adjusting state during render, not in an effect).
  if (state.jobId !== jobId) setState({ jobId, ...fresh() });

  useEffect(() => {
    if (!jobId) return;
    const src = new EventSource(`/api/find/${encodeURIComponent(jobId)}/events`);
    const set = (patch: Partial<FindJob>) => setState((s) => (s.jobId === jobId ? { ...s, ...patch } : s));
    src.addEventListener("stage", (e) => set({ stage: JSON.parse((e as MessageEvent).data) }));
    src.addEventListener("done", (e) => {
      src.close();
      const d = JSON.parse((e as MessageEvent).data);
      // A transition, so the progress crossfades into the list.
      startTransition(() => set({ results: d.results ?? d.report?.results ?? [] }));
    });
    src.addEventListener("error", (e) => {
      src.close();
      const data = (e as MessageEvent).data;
      set({ error: (data && JSON.parse(data).error) || { code: "upstream", message: "Lost the connection to the search. Try again." } });
    });
    return () => src.close();
  }, [jobId]);

  return state;
}

function fresh(): FindJob {
  return { stage: { stage: "Fetching pull requests", progress: 0.05 }, results: null, error: null };
}
