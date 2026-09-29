// How long a PR has waited, against the repo's typical first reply: blue while
// that's normal, orange once it's longer than usual. The tick is "usually".
import { humanHours } from "@/lib/format";
import type { Waiting } from "@/lib/home";

export function WaitBar({ w }: { w: Waiting }) {
  const text = w.typical == null ? `waiting ${humanHours(w.hours)}` : `${humanHours(w.hours)} · usually ${humanHours(w.typical)}`;
  if (w.typical == null) return <p className="mt-1 text-[0.78rem] text-faint">{text}</p>;
  const max = Math.max(w.hours, w.typical) * 1.25;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
      <div
        className="wait-bar"
        role="img"
        aria-label={`Waited ${humanHours(w.hours)}. Replies there usually come within ${humanHours(w.typical)}.`}
        style={{ "--w": `${(w.hours / max) * 100}%`, "--t": `${(w.typical / max) * 100}%`, "--c": w.late ? "var(--orange)" : "var(--blue)" } as React.CSSProperties}
      >
        <span />
        <i />
      </div>
      <span className={`text-[0.78rem] ${w.late ? "text-orange" : "text-faint"}`}>{text}</span>
    </div>
  );
}
