"use client";
// Refresh with its cooldown: disabled, with the minutes left, until the server
// will read GitHub again. The server enforces it either way.
import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { cooldownLabel, minutesLeft } from "@/lib/contributions";

/** Two arrows chasing round: turns while GitHub is being read. */
function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={`size-3.5 shrink-0 ${spinning ? "motion-safe:animate-spin" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 11a8 8 0 0 0-14.5-4.5L4 8" />
      <path d="M4 3.5V8h4.5" />
      <path d="M4 13a8 8 0 0 0 14.5 4.5L20 16" />
      <path d="M20 20.5V16h-4.5" />
    </svg>
  );
}

function Submit({ wait }: { wait: number }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || wait > 0}
      aria-describedby="refresh-note"
      className="inline-flex min-h-11 items-center gap-1.5 border border-line-strong bg-panel px-3 text-[0.78rem] text-muted transition-colors hover:border-blue hover:text-ink focus-visible:outline-2 focus-visible:outline-blue disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-line-strong disabled:hover:text-muted sm:min-h-8"
    >
      <RefreshIcon spinning={pending} />
      {pending ? "checking GitHub…" : "refresh from GitHub"}
    </button>
  );
}

export function RefreshButton({ action, nextRefreshAt }: { action: () => Promise<void>; nextRefreshAt: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  const wait = minutesLeft(nextRefreshAt, now);
  useEffect(() => {
    if (!wait) return;
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, [wait]);

  return (
    <form action={action} className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
      <Submit wait={wait} />
      <span id="refresh-note" suppressHydrationWarning className="text-[0.76rem] text-faint">{cooldownLabel(wait)}</span>
    </form>
  );
}
