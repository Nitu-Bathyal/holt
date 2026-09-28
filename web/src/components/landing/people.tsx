"use client";

// Landing section 03, "who it's for" (docs/design/EXPRESSIVE.md): three
// people, each with their own cat, and a fourth card that's you, starting from
// zero, carrying the section's call to action. The cards step in one after
// another as the pane arrives (transform only; the text is never hidden).
// Point at one and it lifts, its cat reacts and its example (a real number
// from the example report) slides into view in the space it already has.
// Works on focus too; touch and reduced motion see every example, still.
import Link from "next/link";
import { useState } from "react";
import type { CatMood } from "@/lib/cat";
import { ReactiveCat } from "../reactive-cat";
import { useReducedMotion, useSeen } from "../motion/use-seen";

export interface Person {
  key: string;
  who: string;
  title: string;
  body: string;
  mood: CatMood;
  hover: CatMood;
  /** A real example, e.g. "home-assistant/core" and what Holt found there. */
  example: { repo: string; fact: string };
}

export function People({ people }: { people: Person[] }) {
  const reduced = useReducedMotion();
  const { ref, seen, below } = useSeen<HTMLUListElement>();
  const [hot, setHot] = useState<string | null>(null);
  const phase = reduced || !below ? "done" : seen ? "go" : "wait";
  const on = (key: string) => ({
    "data-hot": hot === key,
    onPointerEnter: (e: React.PointerEvent) => e.pointerType === "mouse" && setHot(key),
    onPointerLeave: () => setHot(null),
    onFocus: () => setHot(key),
    onBlur: () => setHot(null),
  });
  return (
    <ul ref={ref} className="ls-people" data-phase={phase} data-hot={hot ?? undefined}>
      {people.map((p, i) => (
        <li key={p.key} className="ls-person ls-lift relative flex flex-col border border-line bg-panel" style={{ ["--i" as string]: i }} {...on(p.key)}>
          <div className="flex items-start justify-between gap-3">
            <p className="text-[0.78rem] uppercase tracking-[0.08em] text-faint">{p.who}</p>
            <ReactiveCat mood={hot === p.key ? p.hover : p.mood} className="ls-person-cat" />
          </div>
          <p className="ls-person-title mt-auto font-semibold tracking-tight text-ink">{p.title}</p>
          <p className="ls-person-body mt-2 font-sans text-muted">{p.body}</p>
          <p className="ls-person-example mt-4 border-t border-dashed border-line pt-3 text-[0.82rem]">
            <span className="text-faint">e.g. </span>
            <Link href={`/${p.example.repo}`} prefetch={false} className="text-blue hover:underline">
              {p.example.repo}
            </Link>
            <span className="text-muted">: {p.example.fact}</span>
          </p>
        </li>
      ))}
      <li className="ls-person ls-person--you ls-lift relative flex flex-col border border-orange/60 bg-panel" style={{ ["--i" as string]: people.length }} {...on("you")}>
        <div className="flex items-start justify-between gap-3">
          <p className="text-[0.78rem] uppercase tracking-[0.08em] text-orange">you, maybe</p>
          <ReactiveCat mood={hot === "you" ? "celebrating" : "ready"} className="ls-person-cat" />
        </div>
        <p className="ls-person-title mt-auto font-semibold tracking-tight text-ink">Starting from zero?</p>
        <p className="ls-person-body mt-2 font-sans text-muted">Pick a language. Holt lists projects that answer outsiders and have issues you could take.</p>
        <Link href="/find" className="bracket-link bracket-link--orange ls-person-cta mt-4 min-h-11 self-start">
          [ find a project in your language → ]
        </Link>
      </li>
    </ul>
  );
}
