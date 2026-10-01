// An open PR's one line (home.ts `waiting`). With the repo's mark, a bar of the
// wait so far against it: blue while that's normal, orange once it's late.
import { humanHours } from "@/lib/format";
import type { Waiting } from "@/lib/home";

export function WaitBar({ w }: { w: Waiting }) {
  const text = w.line ?? `waiting ${humanHours(w.hours)}`;
  const tone = w.turn === "yours" || w.late ? "text-orange" : "text-faint";
  if (w.mark == null) return <p className={`mt-1 text-[0.78rem] ${tone}`}>{text}</p>;
  const max = Math.max(w.hours, w.mark) * 1.25;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
      <div
        className="wait-bar"
        role="img"
        aria-label={text}
        style={{ "--w": `${(w.hours / max) * 100}%`, "--t": `${(w.mark / max) * 100}%`, "--c": w.late ? "var(--orange)" : "var(--blue)" } as React.CSSProperties}
      >
        <span />
        <i />
      </div>
      <span aria-hidden="true" className={`text-[0.78rem] ${tone}`}>{text}</span>
    </div>
  );
}
