"use client";

// Landing section 03, "who it's for" (docs/design/EXPRESSIVE.md): three
// people, each with their own cat, and a fourth card that's you, starting from
// zero, carrying the section's call to action. The cards step in one after
// another as the pane arrives (transform only; the text is never hidden).
// Everything reads without pointing: pointing at a card only lifts it a
// couple of pixels and lights its border (globals.css, .ls-person).
import Link from "next/link";
import type { CatMood } from "@/lib/cat";
import { ReactiveCat } from "../reactive-cat";
import { useReducedMotion, useSeen } from "../motion/use-seen";

export interface Person {
  key: string;
  who: string;
  title: string;
  body: string;
  mood: CatMood;
  /** A real example, e.g. "home-assistant/core" and what Holt found there. */
  example: { repo: string; fact: string };
}

export function People({ people }: { people: Person[] }) {
  const reduced = useReducedMotion();
  const { ref, seen, below } = useSeen<HTMLUListElement>();
  const phase = reduced || !below ? "done" : seen ? "go" : "wait";
  return (
    <ul ref={ref} className="ls-people" data-phase={phase}>
      {people.map((p, i) => (
        <li key={p.key} className="ls-person ls-lift relative flex flex-col border border-line bg-panel" style={{ ["--i" as string]: i }}>
          <div className="flex items-start justify-between gap-3">
            <p className="text-[0.78rem] uppercase tracking-[0.08em] text-faint">{p.who}</p>
            <ReactiveCat mood={p.mood} className="ls-person-cat" />
          </div>
          <p className="ls-person-title mt-auto font-semibold tracking-tight text-ink">{p.title}</p>
          <p className="ls-person-body mt-2 font-sans text-muted">{p.body}</p>
          <p className="mt-4 border-t border-dashed border-line pt-3 text-[0.82rem]">
            <span className="text-faint">e.g. </span>
            <Link href={`/${p.example.repo}`} prefetch={false} className="text-blue hover:underline">
              {p.example.repo}
            </Link>
            <span className="text-muted">: {p.example.fact}</span>
          </p>
        </li>
      ))}
      <li className="ls-person ls-person--you ls-lift relative flex flex-col border border-orange/60 bg-panel" style={{ ["--i" as string]: people.length }}>
        <div className="flex items-start justify-between gap-3">
          <p className="text-[0.78rem] uppercase tracking-[0.08em] text-orange">you, maybe</p>
          <ReactiveCat mood="ready" className="ls-person-cat" />
        </div>
        <p className="ls-person-title mt-auto font-semibold tracking-tight text-ink">Starting from zero?</p>
        <Link href="/find" className="bracket-link bracket-link--orange ls-person-cta mt-4 min-h-11 self-start">
          [ find a project in your language → ]
        </Link>
      </li>
    </ul>
  );
}
