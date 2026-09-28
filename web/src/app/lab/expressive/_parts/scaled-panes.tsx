"use client";

// PROTOTYPE, pattern 1: panes at full scale. Since #135 every landing pane is
// one screen tall, but its content kept its old size and floated small in it.
// Here the content is sized by the screen: the headline by the smaller of the
// width and the height (min(vw, svh)), so it owns the pane at 1440×900 and
// still fits at 1280×720; spacing in svh; a wider measure (up to 1680px) and
// no side rail, so the left third isn't empty. Phones fall back to rem floors.
import Link from "next/link";
import { PasteBox } from "@/components/paste-box";
import type { CatMood } from "@/lib/cat";
import { LabCat } from "./lab-cat";
import { useReduced, useSeen } from "./motion";
import { SwapUrl } from "./swap-url";

export function ScaledHero() {
  return (
    <section className="pane xp-pane relative overflow-hidden border-b border-line" aria-labelledby="xp-hero-h">
      <div aria-hidden="true" className="hero-backdrop" />
      <div className="xp-wide relative z-10">
        <div className="flex items-start justify-between gap-6">
          <p className="xp-kicker text-muted">
            <span className="text-blue">01</span> holt / free / for your first PR or your fiftieth
          </p>
          {/* Wrapped: .xp-cat's own display would beat Tailwind hidden. */}
          <span className="hidden lg:inline-block">
            <LabCat mood="ready" className="xp-hero-cat" />
          </span>
        </div>
        <div className="xp-hero-grid">
          <h1 id="xp-hero-h" className="display xp-hero-h1">
            <span className="block">Will this repo</span>
            <span className="block text-orange">
              <span className="marker">actually merge</span>
            </span>
            <span className="block text-orange">your PR?</span>
          </h1>
          <p className="prose-sans xp-hero-sub">
            Paste a repo. Holt checks what happened to the outsiders who tried before you: did anyone reply, and did
            anything get merged?
          </p>
        </div>
        <div className="xp-hero-act">
          <PasteBox id="xp-hero-input" />
        </div>
        <div className="xp-hero-foot">
          <p className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="font-sans text-muted">No repo in mind?</span>
            <Link href="/find" className="bracket-link bracket-link--orange">
              [ find a project → ]
            </Link>
          </p>
          <p className="font-sans text-faint">
            Already on GitHub? <span className="font-mono text-muted"><SwapUrl compact /></span>
          </p>
        </div>
      </div>
    </section>
  );
}

const ANSWERS: { mood: CatMood; word: string; tone: string; body: string }[] = [
  { mood: "celebrating", word: "Worth your time.", tone: "text-green", body: "Outsiders get replies and get merged. Holt shows you where to start." },
  { mood: "heartbroken", word: "Not worth your time.", tone: "text-orange", body: "Outside PRs mostly go unanswered or unmerged. Save your week." },
  { mood: "thinking", word: "Not enough evidence.", tone: "text-amber", body: "Too few people have tried recently to say. Holt won't guess." },
];

/**
 * Landing section 06 at full scale: the three verdicts are the pane, set as
 * large as the screen allows. They slide in once, one after another, when
 * the pane scrolls in (desktop, transform only: the words are never hidden).
 * Point at one and the others step back while its cat reacts.
 */
export function ScaledAnswers() {
  const reduced = useReduced();
  const { ref, seen, below } = useSeen<HTMLUListElement>();
  const phase = reduced || !below ? "done" : seen ? "go" : "wait";
  return (
    <section className="pane xp-pane border-t border-line" aria-labelledby="xp-answers-h">
      <div className="xp-wide">
        <p className="xp-kicker text-muted">
          <span className="text-blue">06</span> three answers
        </p>
        <h2 id="xp-answers-h" className="h2 xp-answers-h2">Three possible answers. No hedging.</h2>
        <ul ref={ref} className="xp-answers" data-phase={phase}>
          {ANSWERS.map((a, i) => (
            <li key={a.word} className="xp-answer" style={{ ["--i" as string]: i }}>
              <LabCat mood={a.mood} className="xp-answer-cat" />
              <div className="min-w-0">
                <p className={`display xp-answer-word ${a.tone}`}>{a.word}</p>
                <p className="xp-answer-body font-sans text-muted">{a.body}</p>
              </div>
            </li>
          ))}
        </ul>
        <p className="xp-answers-foot font-sans text-muted">
          The same written rules judge every repo. An AI can explain the evidence to you. It can&apos;t change the
          answer.{" "}
          <Link href="/how-it-works" className="text-link font-mono">
            [ how it decides ]
          </Link>
        </p>
      </div>
    </section>
  );
}
