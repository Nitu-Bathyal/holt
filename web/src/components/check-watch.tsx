"use client";

// Follows the checks a signed-in person started and walked away from
// (lib/pending-checks.ts), and says when each is ready, on whatever app page
// they're on. The report page follows its own check; this follows the rest.
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { reportHref } from "@/lib/budget";
import { parsePending, PENDING_EVENT, PENDING_KEY, toFollow, withoutPending, withPending, type PendingCheck } from "@/lib/pending-checks";
import type { Tone } from "@/lib/types";
import { VerdictPill } from "./report/verdict-pill";

const POLL_MS = 4000;

function read(): PendingCheck[] {
  try {
    return parsePending(localStorage.getItem(PENDING_KEY), Date.now());
  } catch {
    return [];
  }
}

function write(list: PendingCheck[]) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(list));
    window.dispatchEvent(new Event(PENDING_EVENT));
  } catch {}
}

export function rememberCheck(check: PendingCheck) {
  write(withPending(read(), check));
}

export function forgetCheck(job: string) {
  const list = read();
  if (list.some((c) => c.job === job)) write(withoutPending(list, job));
}

type Note = { check: PendingCheck; ok: true; headline: string; tone: Tone } | { check: PendingCheck; ok: false };

export function CheckWatch() {
  const pathname = usePathname();
  const router = useRouter();
  const [pending, setPending] = useState<PendingCheck[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);

  useEffect(() => {
    const sync = () => setPending(read());
    sync();
    window.addEventListener(PENDING_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(PENDING_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const following = toFollow(pending, pathname);
  const jobs = following.map((c) => c.job).join(",");

  useEffect(() => {
    if (!jobs) return;
    let stopped = false;
    const poll = async () => {
      if (document.visibilityState !== "visible") return;
      for (const check of toFollow(read(), pathname)) {
        let res: Response;
        try {
          res = await fetch(`/api/analyses/${encodeURIComponent(check.job)}`, { cache: "no-store" });
        } catch {
          continue; // offline for a moment: ask again next time
        }
        if (stopped) return;
        const d = await res.json().catch(() => null);
        if (res.status === 404 || res.status === 400) forgetCheck(check.job);
        if (!res.ok || !d) continue;
        if (d.status === "done" && d.headline && d.tone) {
          forgetCheck(check.job);
          setNotes((n) => [...n, { check, ok: true, headline: d.headline, tone: d.tone }]);
          router.refresh(); // Your repos and the home show it now
        } else if (d.status === "error") {
          forgetCheck(check.job);
          setNotes((n) => [...n, { check, ok: false }]);
        }
      }
    };
    const id = window.setInterval(poll, POLL_MS);
    void poll();
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [jobs, pathname, router]);

  const dismiss = useCallback((job: string) => setNotes((n) => n.filter((x) => x.check.job !== job)), []);
  // Opening the report dismisses its note.
  const shown = notes.filter((n) => toFollow([n.check], pathname).length > 0);
  if (!shown.length) return null;
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-end gap-2 sm:left-auto sm:w-[22rem]">
      {shown.map(({ check, ...n }) => (
        <div key={check.job} className="app-appear pointer-events-auto flex w-full items-start gap-3 border border-line-strong bg-panel p-4 shadow-card">
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold tracking-tight">{check.repo}</p>
            {n.ok ? (
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
                <VerdictPill headline={n.headline} tone={n.tone} className="px-1.5 py-0.5 text-[0.74rem]" />
                <Link href={reportHref(check.repo, check.days, check.mode)} onClick={() => dismiss(check.job)} className="text-link text-[0.85rem]">
                  open →
                </Link>
              </div>
            ) : (
              <p className="mt-1 font-sans text-[0.88rem] text-muted">
                The check didn&rsquo;t finish.{" "}
                <Link href={reportHref(check.repo, check.days, check.mode)} onClick={() => dismiss(check.job)} className="text-link font-mono text-[0.85rem]">
                  try again →
                </Link>
              </p>
            )}
          </div>
          <button type="button" onClick={() => dismiss(check.job)} aria-label="Dismiss" className="-m-1 p-1 text-faint hover:text-ink">
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
