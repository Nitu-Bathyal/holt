"use client";

// "How to get merged here": the paid playbook on a report page. It loads its
// own state, so the report renders without waiting on it, and it stays hidden
// when the server runs without paid features (or can't be reached). Everyone
// sees the teaser; unlocking is checked and charged by the server.
import Link from "next/link";
import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import { timeAgo } from "@/lib/format";
import { codeSpans, isGitHubLink, linkLabel, SECTION_ORDER, SECTION_TITLES, seenLabel, unlockOffer } from "@/lib/playbook";
import type { ApiError, Playbook, PlaybookClosingReason, PlaybookItem, PlaybookState } from "@/lib/types";

type Run =
  | { phase: "idle" }
  | { phase: "starting" }
  | { phase: "running"; stage: string; progress: number }
  | { phase: "error"; error: ApiError };

const LOST: ApiError = { code: "upstream", message: "We lost the connection mid-write. It may still finish, so reload in a minute." };
const FAILED: ApiError = { code: "upstream", message: "Something broke on our side. Try again in a minute." };

export function PlaybookSection({ repo, signedIn }: { repo: string; signedIn: boolean }) {
  const [s, setS] = useState<PlaybookState | null>(null);
  const [playbook, setPlaybook] = useState<Playbook | null>(null);
  const [run, setRun] = useState<Run>({ phase: "idle" });
  const es = useRef<EventSource | null>(null);

  const follow = useCallback((jobId: string) => {
    es.current?.close();
    setRun({ phase: "running", stage: "Getting in line", progress: 0.02 });
    const src = new EventSource(`/api/playbook-jobs/${encodeURIComponent(jobId)}/events`);
    es.current = src;
    src.addEventListener("stage", (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      setRun({ phase: "running", stage: d.stage, progress: d.progress ?? 0 });
    });
    src.addEventListener("done", (e) => {
      src.close();
      const p = JSON.parse((e as MessageEvent).data).playbook as Playbook;
      startTransition(() => {
        setPlaybook(p);
        setRun({ phase: "idle" });
      });
    });
    src.addEventListener("error", (e) => {
      const data = (e as MessageEvent).data;
      src.close();
      let error = LOST;
      if (data) {
        try {
          error = JSON.parse(data).error ?? LOST;
        } catch {}
      }
      setRun({ phase: "error", error });
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/playbook/${repo}`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((body: PlaybookState | null) => {
        if (cancelled || !body) return;
        setS(body);
        if (body.playbook) setPlaybook(body.playbook);
        if (body.job) follow(body.job.job_id);
      });
    return () => {
      cancelled = true;
      es.current?.close();
    };
  }, [repo, follow]);

  const unlock = useCallback(async () => {
    setRun({ phase: "starting" });
    let res: Response;
    try {
      res = await fetch(`/api/playbook/${repo}`, { method: "POST" });
    } catch {
      setRun({ phase: "error", error: LOST });
      return;
    }
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setRun({ phase: "error", error: body?.error ?? FAILED });
      return;
    }
    if (body.status === "done") {
      startTransition(() => {
        setPlaybook(body.playbook);
        setRun({ phase: "idle" });
      });
      return;
    }
    follow(body.job_id);
  }, [repo, follow]);

  // Off, still loading, or the server couldn't be reached: nothing at all.
  if (!s || !s.available) return null;

  return (
    <section aria-labelledby="playbook" className="border border-line-strong bg-panel p-5 shadow-card sm:p-8" data-playbook>
      <p className="text-[0.8rem] uppercase tracking-[0.08em] text-blue">Playbook ✦</p>
      <h2 id="playbook" className="mt-1 text-[1.25rem] font-semibold tracking-tight sm:text-[1.5rem]">How to get merged here</h2>
      {playbook ? (
        <FullPlaybook p={playbook} />
      ) : run.phase === "running" || run.phase === "starting" ? (
        <Writing stage={run.phase === "running" ? run.stage : "Starting"} progress={run.phase === "running" ? run.progress : 0.01} />
      ) : (
        <Teaser s={s} repo={repo} signedIn={signedIn} onUnlock={unlock} error={run.phase === "error" ? run.error : null} />
      )}
    </section>
  );
}

// --- before unlocking ---------------------------------------------------------------

function Teaser({ s, repo, signedIn, onUnlock, error }: { s: PlaybookState; repo: string; signedIn: boolean; onUnlock: () => void; error: ApiError | null }) {
  const t = s.teaser;
  const offer = unlockOffer(signedIn ? s.access : null, s.on_sale);
  const back = `/${repo}`;
  return (
    <div data-playbook-teaser>
      <p className="mt-2 max-w-2xl font-sans text-muted">
        What this project&apos;s merged PRs have in common, who reviews them, and why outside ones got closed, in the
        project&apos;s own words, linked. An AI writes it from 12 months of PR counts. Anything that doesn&apos;t match the
        counts is cut. It doesn&apos;t change the verdict.
      </p>

      {t?.first && (
        <div className="mt-5 border-l-2 border-blue pl-4" data-playbook-first>
          <p className="text-[0.8rem] uppercase tracking-[0.08em] text-faint">{SECTION_TITLES.must_do} · free preview</p>
          <ItemView item={t.first} />
        </div>
      )}

      <p className="mt-6 text-[0.8rem] uppercase tracking-[0.08em] text-faint">
        {t ? "In this repo's playbook" : "What a playbook covers"}
      </p>
      <ul className="mt-2 space-y-1.5 font-sans text-[0.95rem]" data-playbook-sections>
        {t
          ? t.sections.map((x) => {
              // The first must-do is shown above; count what's still locked.
              const locked = x.key === "must_do" && t.first ? x.count - 1 : x.count;
              return (
                <li key={x.key} className="flex flex-wrap items-baseline gap-x-2">
                  <span aria-hidden="true" className="text-faint">▪</span>
                  <span className="text-ink">{SECTION_TITLES[x.key]}</span>
                  <span className="text-[0.87rem] text-faint">
                    {locked > 0 ? `${locked} ${x.key === "must_do" && t.first ? "more " : ""}${x.key === "closing_reasons" ? (locked === 1 ? "reason" : "reasons") : locked === 1 ? "item" : "items"}` : "shown above"}
                  </span>
                </li>
              );
            })
          : SECTION_ORDER.map((k) => (
              <li key={k} className="flex gap-2">
                <span aria-hidden="true" className="text-faint">▪</span>
                <span className="text-ink">{SECTION_TITLES[k]}</span>
              </li>
            ))}
      </ul>
      {!t && <p className="mt-2 font-sans text-[0.89rem] text-faint">A section only appears when the pull requests show something for it.</p>}

      {error && (
        <p role="alert" className="mt-5 border border-orange/50 px-3 py-2 font-sans text-[0.9rem] text-orange" data-playbook-error>
          {error.message}
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2" data-playbook-offer={offer.kind}>
        {offer.kind === "sign-in" ? (
          <>
            <Link href={`/signin?callbackUrl=${encodeURIComponent(back)}`} prefetch={false} className="btn-primary bg-blue">
              sign in to unlock <span aria-hidden="true">→</span>
            </Link>
            <span className="text-[0.82rem] text-faint">{s.on_sale ? "Playbooks are a paid feature." : "Playbooks are a paid feature and aren't on sale yet."}</span>
          </>
        ) : (
          <>
            <button type="button" onClick={onUnlock} disabled={offer.kind !== "can-unlock"} className="btn-primary bg-blue disabled:cursor-not-allowed disabled:opacity-50" data-playbook-unlock>
              {error ? "try again" : "unlock the playbook"} <span aria-hidden="true">→</span>
            </button>
            <span className={`font-sans text-[0.89rem] ${offer.kind === "can-unlock" ? "text-muted" : "text-orange"}`}>{offer.note}</span>
          </>
        )}
      </div>
    </div>
  );
}

function Writing({ stage, progress }: { stage: string; progress: number }) {
  const pct = Math.round(Math.min(1, Math.max(0.03, progress)) * 100);
  return (
    <div className="mt-4" aria-live="polite" aria-busy="true" data-playbook-writing>
      <p className="font-sans text-ink">{stage}…</p>
      <div className="mt-3 h-1.5 bg-panel-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progress">
        <div className="h-full bg-blue transition-[width] duration-500 ease-out" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-3 font-sans text-[0.89rem] text-faint">
        This takes 1 to 3 minutes and keeps going if you leave. If it fails, you aren&apos;t charged.
      </p>
    </div>
  );
}

// --- the playbook ----------------------------------------------------------------------

function FullPlaybook({ p }: { p: Playbook }) {
  const shown = SECTION_ORDER.filter((k) => p.sections[k].length > 0);
  return (
    <div data-playbook-full>
      {p.note && <p className="mt-3 max-w-2xl border border-dashed border-line-strong px-3 py-2 font-sans text-[0.9rem] text-muted">{p.note}</p>}
      {p.archived && <p className="mt-3 font-sans text-[0.9rem] text-orange">This repo is archived. It doesn&apos;t take PRs any more.</p>}
      {shown.length === 0 && <p className="mt-4 font-sans text-muted">These PRs didn&apos;t show anything solid enough to advise on yet.</p>}
      <div className="mt-2 space-y-7">
        {shown.map((k) => (
          <div key={k}>
            <h3 className="mt-5 text-[0.8rem] uppercase tracking-[0.08em] text-faint">{SECTION_TITLES[k]}</h3>
            {k === "closing_reasons" ? (
              <ul className="mt-2 space-y-5">
                {p.sections.closing_reasons.map((r) => (
                  <li key={r.reason}>
                    <ReasonView r={r} />
                  </li>
                ))}
              </ul>
            ) : (
              <ul className="mt-2 space-y-4">
                {p.sections[k].map((item, i) => (
                  <li key={i}>
                    <ItemView item={item} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
      <p className="mt-8 border-t border-dashed border-line pt-4 text-[0.8rem] text-faint">
        Written by {p.model ?? "an AI model"} from counts of {p.window_days ? `the last ${p.window_days === 365 ? "12 months" : `${p.window_days} days`}` : "recent"} of
        PRs. Every item was checked against those counts and quotes, and anything that didn&apos;t match was cut. It
        doesn&apos;t change the verdict. Updated <time dateTime={p.generated_at} suppressHydrationWarning>{timeAgo(p.generated_at)}</time>.
      </p>
    </div>
  );
}

function Text({ text }: { text: string }) {
  return (
    <>
      {codeSpans(text).map(([piece, code], i) =>
        code ? (
          <code key={i} className="bg-panel-2 px-1 text-[0.9em]">
            {piece}
          </code>
        ) : (
          <span key={i}>{piece}</span>
        ),
      )}
    </>
  );
}

function Links({ links }: { links: string[] }) {
  const safe = links.filter(isGitHubLink).slice(0, 5);
  if (safe.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap gap-x-2">
      {safe.map((u) => (
        <a key={u} href={u} target="_blank" rel="noopener noreferrer" className="text-link">
          {linkLabel(u)}
        </a>
      ))}
    </span>
  );
}

function ItemView({ item }: { item: PlaybookItem }) {
  return (
    <div>
      <p className="font-sans text-[1rem] leading-relaxed text-ink">
        <Text text={item.text} />
      </p>
      {item.sources.map((src, i) => {
        const seen = seenLabel(src);
        return (
          <p key={i} className="mt-1 flex flex-wrap items-baseline gap-x-2 text-[0.85rem] text-faint">
            {seen && <span data-seen>{seen}</span>}
            {!seen && <span>from the project&apos;s documents</span>}
            <Links links={src.links} />
          </p>
        );
      })}
    </div>
  );
}

function ReasonView({ r }: { r: PlaybookClosingReason }) {
  return (
    <div>
      <p className="font-sans text-[1rem] font-medium text-ink">
        <Text text={r.reason} />
      </p>
      {r.explanation && (
        <p className="mt-1 font-sans text-[0.95rem] text-muted">
          <Text text={r.explanation} />
        </p>
      )}
      <p className="mt-1 text-[0.85rem] text-faint" data-seen>{seenLabel(r, "closed outside pull requests")}</p>
      <ul className="mt-2 space-y-2">
        {r.examples.filter((e) => isGitHubLink(e.url)).map((e) => (
          <li key={e.number} className="border-l-2 border-line-strong pl-3">
            <blockquote className="font-sans text-[0.95rem] text-ink">&ldquo;{e.quote}&rdquo;</blockquote>
            <p className="mt-0.5 text-[0.82rem] text-faint [overflow-wrap:anywhere]">
              {e.who} on{" "}
              <a href={e.url} target="_blank" rel="noopener noreferrer" className="text-link">
                #{e.number}
              </a>
              {e.title && <> · {e.title}</>}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
