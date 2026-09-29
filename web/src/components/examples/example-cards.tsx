"use client";

// /examples: one card per example report, in the landing's card language
// (landing/people.tsx): the repo, today's verdict in its colour with its cat,
// why it's worth a look, and one action. The cards step in as they arrive
// (desktop; transform only, the text is never hidden). Pointing at one only
// lifts it 2px and lights its border in the verdict's colour (globals.css,
// .ex-card).
import Link from "next/link";
import type { CatMood } from "@/lib/cat";
import type { Tone } from "@/lib/types";
import { ReactiveCat } from "../reactive-cat";
import { TONE, TONE_MOOD } from "../report/tone";
import { useReducedMotion, useSeen } from "../motion/use-seen";

export interface ExampleCard {
  href: string;
  repo: string;
  /** Today's verdict as the server words it; none when the report isn't cached. */
  headline?: string;
  tone?: Tone;
  why: string;
  action: string;
  /** The AI report: blue, and a label in place of the verdict. */
  ai?: boolean;
}

export function ExampleCards({ cards }: { cards: ExampleCard[] }) {
  const reduced = useReducedMotion();
  const { ref, seen, below } = useSeen<HTMLUListElement>();
  const phase = reduced || !below ? "done" : seen ? "go" : "wait";
  return (
    <ul ref={ref} className="ls-people" data-phase={phase}>
      {cards.map((c, i) => {
        const tone = c.ai ? "neutral" : (c.tone ?? "neutral");
        const mood: CatMood = c.ai ? "adoring" : c.tone ? TONE_MOOD[c.tone] : "thinking";
        const word = c.ai ? "AI report ✦" : c.headline;
        return (
          <li key={c.href} className="ls-person ex-card ls-lift relative flex flex-col border border-line bg-panel" data-tone={tone} style={{ ["--i" as string]: i }}>
            <Link href={c.href} className="flex flex-1 flex-col">
              <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${TONE[tone].bg}`} />
              <span className="flex items-start justify-between gap-3">
                <span className="min-w-0 pt-1 font-semibold tracking-tight text-ink [overflow-wrap:anywhere]">{c.repo}</span>
                <ReactiveCat mood={mood} className="ls-person-cat" />
              </span>
              {word && (
                <span className={`display ls-person-title mt-auto ${TONE[tone].text}`}>
                  {word}
                  {!c.ai && <span className="text-ink">.</span>}
                </span>
              )}
              <span className={`ls-person-body font-sans text-muted ${word ? "mt-2" : "mt-auto"}`}>{c.why}</span>
              <span className="mt-5 border-t border-dashed border-line pt-4">
                <span className="bracket-link">[ {c.action} → ]</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
