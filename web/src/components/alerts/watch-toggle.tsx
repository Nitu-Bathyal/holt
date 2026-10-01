"use client";
// Mute or watch one pull request's alerts from its row on My PRs. The row's
// own line stays either way.
import { useRef, useState } from "react";
import { setMute } from "@/lib/alerts-client";
import { BellIcon } from "./bell-icon";

export function WatchToggle({ repo, number, initial }: { repo: string; number: number; initial: "on" | "muted" }) {
  const [muted, setMuted] = useState(initial === "muted");
  // Requests go one after another, so a quick mute-unmute lands in order.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const latest = useRef(0);
  const pr = `${repo.split("/")[1]} #${number}`;

  function send(next: boolean) {
    const seq = ++latest.current;
    setMuted(next);
    queue.current = queue.current.then(async () => {
      const ok = await setMute(repo, number, next);
      // A newer click decides what shows.
      if (!ok && seq === latest.current) setMuted(!next);
    });
  }

  return (
    <button
      type="button"
      onClick={() => send(!muted)}
      aria-pressed={!muted}
      aria-label={`Alerts for ${pr}`}
      title={muted ? "Watch" : "Mute alerts"}
      className={`inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 px-1 text-[0.8rem] transition-colors sm:min-h-9 sm:min-w-9 ${muted ? "text-faint hover:text-ink" : "text-blue hover:text-ink"}`}
    >
      <BellIcon off={muted} className="size-[18px]" />
      {muted && <span>muted</span>}
    </button>
  );
}
