"use client";
// Refresh with its cooldown: disabled, with the minutes left, until the server
// will read GitHub again. The server enforces it either way.
import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { cooldownLabel, minutesLeft } from "@/lib/contributions";

function Submit({ wait }: { wait: number }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending || wait > 0} aria-describedby="refresh-note" className="btn-ghost disabled:cursor-not-allowed disabled:opacity-60">
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
    <form action={action} className="flex flex-wrap items-center gap-3">
      <Submit wait={wait} />
      <span id="refresh-note" suppressHydrationWarning className="text-[0.75rem] text-faint">{cooldownLabel(wait)}</span>
    </form>
  );
}
