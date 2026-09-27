import type { Tone } from "@/lib/types";
import { TONE } from "./tone";

/** A verdict as the server words and colours it (`headline`, `tone`). */
export function VerdictPill({ headline, tone, className = "" }: { headline: string; tone: Tone; className?: string }) {
  const t = TONE[tone];
  return (
    <span className={`inline-flex items-center gap-2 border px-2 py-1 text-[0.72rem] font-semibold ${t.text} ${t.border} ${t.soft} ${className}`}>
      <span aria-hidden="true" className={`size-1.5 rounded-full ${t.bg}`} />
      {headline}
    </span>
  );
}
