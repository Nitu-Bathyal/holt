"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { track } from "@/lib/analytics";
import { defaultPicks, PICKS_COOKIE, picksQuery, searchKey, widen, type Picks, type PicksSource } from "@/lib/find-picks";
import { signInHref } from "@/lib/gate";
import { personalise } from "@/lib/profile";
import type { FindResult, FindStart, Result } from "@/lib/types";
import { CatFace } from "../cat-face";
import { ErrorPanel } from "../error-panel";
import { EmptyState } from "../shell/app-page";
import { FindFilters } from "./find-filters";
import { FindResults } from "./find-results";
import { FindResultsSkeleton } from "./find-skeleton";
import { useFindJob } from "./use-find-job";

/** Taps closer together than this make one search: each new search can spend the visitor's hourly limit. */
const SETTLE_MS = 700;

type Shown = { key: string; result: Result<FindStart> };

/**
 * /find after the first paint: the filters apply as they're tapped. Experience
 * and work type only reorder what's already here; languages, time, topics and
 * the Hacktoberfest switch start a new (cached) search once the taps settle.
 * Signed out, `initial` is the shared default search (`searched`), and any
 * other search asks for sign-in instead of running.
 */
export function FindView({ initialPicks, searched = initialPicks, initial, source, hf, saved, signedIn = true, notice }: {
  initialPicks: Picks;
  /** The picks `initial` was searched with, when not `initialPicks`. */
  searched?: Picks;
  initial: Result<FindStart>;
  source: PicksSource;
  hf: { note: string; on: boolean } | null;
  saved: string[] | null;
  signedIn?: boolean;
  /** A one-off note (profile saved), just under the filters. */
  notice?: React.ReactNode;
}) {
  const [picks, setPicks] = useState(initialPicks);
  const [shown, setShown] = useState<Shown>({ key: searchKey(searched), result: initial });
  const [retry, setRetry] = useState(0);
  // A new server render (a link to /find with other picks) starts over from it.
  const [from, setFrom] = useState({ initialPicks, initial });
  if (from.initialPicks !== initialPicks || from.initial !== initial) {
    setFrom({ initialPicks, initial });
    setPicks(initialPicks);
    setShown({ key: searchKey(searched), result: initial });
  }

  const key = searchKey(picks);
  const pending = key !== shown.key;
  const q = picksQuery(picks);

  // The URL and the remembered picks follow every change. A search opened
  // from a link counts as picked; a profile or the defaults don't, so a later
  // profile change still shows through.
  const seen = useRef<string | null>(null);
  useEffect(() => {
    const prev = seen.current;
    seen.current = q;
    if (prev === q) return; // the same picks again (a strict-mode re-run)
    if (prev === null && source !== "url") return;
    try {
      if (prev !== null) window.history.replaceState(null, "", `/find?${q}`);
      document.cookie = `${PICKS_COOKIE}=${encodeURIComponent(q)}; path=/; max-age=${60 * 60 * 24 * 180}; samesite=lax`;
    } catch {
      // Remembering is a convenience; the search still runs.
    }
  }, [q, source]);

  useEffect(() => {
    if (!pending || !signedIn) return;
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      track("find-run");
      let result: Result<FindStart>;
      try {
        const res = await fetch("/api/find", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ q }), signal: ctl.signal });
        const body = await res.json();
        result = res.ok ? { ok: true, data: body } : { ok: false, status: res.status, error: body.error ?? { code: "upstream", message: "The search didn't answer. Try again." } };
      } catch {
        if (ctl.signal.aborted) return;
        result = { ok: false, status: 0, error: { code: "upstream", message: "Couldn't reach Holt. Check your connection and try again." } };
      }
      setShown({ key, result });
    }, SETTLE_MS);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
    // `retry` re-runs a failed search with the same picks.
  }, [pending, key, q, retry, signedIn]);

  const retryNow = () => {
    setShown((s) => ({ ...s, key: "" }));
    setRetry((n) => n + 1);
  };
  const fit = { level: picks.level, contributions: picks.types };
  const isDefault = q === picksQuery(defaultPicks(hf?.on ?? false));
  const untouched = picks === initialPicks;

  return (
    <>
      <FindFilters picks={picks} onChange={setPicks} hf={hf} />
      {notice}
      <Results shown={shown} pending={pending} locked={pending && !signedIn ? `/find?${q}` : null} fit={fit} days={picks.days} saved={saved} picks={picks} setPicks={setPicks} onRetry={retryNow}>
        {source === "profile" && untouched && (
          <span>
            Started from your profile. <Link href="/settings/profile" className="text-link">edit it</Link>
          </span>
        )}
        {source === "last" && untouched && <span>Your last search.</span>}
        {!isDefault && (
          <button type="button" onClick={() => setPicks(defaultPicks(hf?.on ?? false))} className="min-h-6 text-muted underline decoration-dotted underline-offset-4 hover:text-ink">
            reset filters
          </button>
        )}
      </Results>
    </>
  );
}

function Results({ shown, pending, locked, fit, days, saved, picks, setPicks, onRetry, children }: {
  shown: Shown;
  pending: boolean;
  /** Signed out and the picks changed: where to come back to after signing in. */
  locked: string | null;
  fit: { level: Picks["level"]; contributions: Picks["types"] };
  days: number;
  saved: string[] | null;
  picks: Picks;
  setPicks: (p: Picks) => void;
  onRetry: () => void;
  /** Notes about the picks, at the end of the status line. */
  children: React.ReactNode;
}) {
  const r = shown.result;
  const job = useFindJob(r.ok && r.data.status === "queued" ? r.data.job_id : null);
  const raw: FindResult[] | null = !r.ok ? null : r.data.status === "done" ? r.data.results : job.results;
  const error = !r.ok ? r.error : job.error;

  let body: React.ReactNode;
  let status = "";
  if (locked) {
    body = <SignInToSearch back={locked} />;
  } else if (error) {
    body = <ErrorPanel error={error} onRetry={onRetry} />;
  } else if (!raw) {
    const pct = Math.round(Math.min(1, Math.max(0.05, job.stage.progress)) * 100);
    status = "Checking which repos reply to outsiders. A new search takes up to a minute.";
    body = (
      <>
        <div className="mb-5 h-1 bg-panel-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Search progress">
          <div className="h-full bg-blue transition-[width] duration-500 ease-out" style={{ width: `${pct}%` }} />
        </div>
        <FindResultsSkeleton count={3} />
      </>
    );
  } else {
    const list = personalise(raw, fit);
    if (!list.length) {
      body = <Empty picks={picks} setPicks={setPicks} />;
    } else {
      status = `${list.length} repo${list.length === 1 ? "" : "s"} that merge outside PRs, best starter issues first`;
      body = <FindResults results={list} days={days} saved={saved} />;
    }
  }

  return (
    <section aria-label="Results" aria-busy={!locked && (pending || (!raw && !error))} className="mt-5">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[0.8rem] text-faint">
        <p aria-live="polite" className="flex items-center gap-x-2">
          {pending && !locked ? (
            <>
              <span aria-hidden="true" className="inline-block size-2 animate-pulse rounded-full bg-blue" />
              Updating…
            </>
          ) : (
            status
          )}
        </p>
        <p className="flex flex-wrap items-baseline gap-x-4">{children}</p>
      </div>
      <div className={`transition-opacity duration-200 ${pending && !locked ? "pointer-events-none opacity-40" : ""}`}>{body}</div>
    </section>
  );
}

function SignInToSearch({ back }: { back: string }) {
  return (
    <div className="border border-dashed border-line-strong p-6 text-center sm:p-8" data-signin-card>
      <CatFace mood="ready" className="text-[1.6rem]" />
      <p className="mt-4 text-[1.1rem] font-semibold">Sign in to search with these filters.</p>
      <Link href={signInHref(back)} prefetch={false} className="btn-primary mt-5">
        sign in to search <span aria-hidden="true">→</span>
      </Link>
    </div>
  );
}

function Empty({ picks, setPicks }: { picks: Picks; setPicks: (p: Picks) => void }) {
  const fixes = widen(picks);
  return (
    <EmptyState title={fixes.length ? "No repos match all of that." : "No repos match that. Try another language."}>
      {fixes.map((f, i) => (
        <button key={f.label} type="button" onClick={() => setPicks(f.picks)} className={i ? "text-link text-[0.9rem]" : "btn-primary"}>
          {f.label}
        </button>
      ))}
    </EmptyState>
  );
}
