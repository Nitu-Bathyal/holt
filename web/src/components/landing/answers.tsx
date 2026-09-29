"use client";

// Landing section 06, "four possible answers" (docs/design/EXPRESSIVE.md):
// the four verdicts are the pane, as large as the screen allows, each with
// what it means for you and what to do next. They slide in one after another
// as the pane arrives (desktop; transform only, the words are never hidden).
// Everything reads without pointing: pointing at one only thickens its
// colour bar (globals.css, .ls-answer).
import Link from "next/link";
import type { CatMood } from "@/lib/cat";
import { ReactiveCat } from "../reactive-cat";
import { useReducedMotion, useSeen } from "../motion/use-seen";

const ANSWERS: { key: string; word: string; mood: CatMood; tone: string; bar: string; means: string; next: React.ReactNode }[] = [
  {
    key: "good",
    word: "Worth your time",
    mood: "celebrating",
    tone: "text-green",
    bar: "bg-green",
    means: "Outsiders get replies and get merged here.",
    next: "Pick a starter issue from the report and open your PR.",
  },
  {
    key: "long",
    word: "Long shot",
    mood: "thinking",
    tone: "text-amber",
    bar: "bg-amber",
    means: "Some outside PRs get in. Most get silence or a very slow reply.",
    next: "Ask on an issue first, and start only if a maintainer answers.",
  },
  {
    key: "bad",
    word: "Not worth your time",
    mood: "heartbroken",
    tone: "text-orange",
    bar: "bg-orange",
    means: "Outside PRs mostly go unanswered or unmerged.",
    next: (
      <>
        Save your week. <Link href="/find" className="text-link">Find a project that answers →</Link>
      </>
    ),
  },
  {
    key: "unknown",
    word: "Not enough evidence",
    mood: "ready",
    tone: "text-blue",
    bar: "bg-blue",
    means: "Too few people tried recently to say. Holt won't guess.",
    next: "Ask the maintainers in an issue before you start, or check back later.",
  },
];

export function Answers() {
  const reduced = useReducedMotion();
  const { ref, seen, below } = useSeen<HTMLUListElement>();
  const phase = reduced || !below ? "done" : seen ? "go" : "wait";
  return (
    <ul ref={ref} className="ls-answers" data-phase={phase}>
      {ANSWERS.map((a, i) => (
        <li
          key={a.key}
          className="ls-answer relative"
          style={{ ["--i" as string]: i }}
        >
          <span aria-hidden="true" className={`ls-answer-bar absolute inset-y-0 left-0 w-1 ${a.bar}`} />
          <ReactiveCat mood={a.mood} className="ls-answer-cat" />
          <div className="min-w-0">
            <p className={`display ls-answer-word ${a.tone}`}>
              {a.word}
              <span className="text-ink">.</span>
            </p>
            <dl className="ls-answer-text mt-2 grid gap-x-5 gap-y-1 font-sans sm:grid-cols-[7.5rem_minmax(0,1fr)]">
              <dt className="font-mono text-[0.8em] text-faint sm:pt-[0.15em]">what it means</dt>
              <dd className="text-muted">{a.means}</dd>
              <dt className="font-mono text-[0.8em] text-faint sm:pt-[0.15em]">what to do</dt>
              <dd className="text-ink">{a.next}</dd>
            </dl>
          </div>
        </li>
      ))}
    </ul>
  );
}
