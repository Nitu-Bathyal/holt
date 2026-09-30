"use client";
// PROTOTYPE: mute or watch one PR's alerts from its row. The free line
// stays either way.
import { useState } from "react";
import { BellIcon } from "./bell-icon";

export function WatchToggle({ pr, initialMuted = false }: { pr: string; initialMuted?: boolean }) {
  const [muted, setMuted] = useState(initialMuted);
  return (
    <button
      type="button"
      onClick={() => setMuted((m) => !m)}
      aria-pressed={!muted}
      aria-label={muted ? `Watch ${pr}` : `Mute alerts for ${pr}`}
      title={muted ? "Watch" : "Mute alerts"}
      className={`inline-flex min-h-11 items-center gap-1.5 px-1 text-[0.8rem] transition-colors sm:min-h-9 ${muted ? "text-faint hover:text-ink" : "text-blue hover:text-ink"}`}
    >
      <BellIcon off={muted} className="size-[18px]" />
      {muted && <span>muted</span>}
    </button>
  );
}
