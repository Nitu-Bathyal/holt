"use client";

// PROTOTYPE: the cat as a face that reacts. A mood change re-keys the face, so
// its CSS squash (.xp-cat-face) replays; `look` shifts only the eyes, -1..1.
import { CAT, TONE_TEXT, type CatMood } from "@/lib/cat";

export function LabCat({ mood, look = 0, className = "", blink = true }: { mood: CatMood; look?: number; className?: string; blink?: boolean }) {
  const c = CAT[mood];
  const eyes = { transform: `translateX(${(Math.max(-1, Math.min(1, look)) * 0.18).toFixed(3)}em)` };
  return (
    <span className={`xp-cat ${TONE_TEXT[c.tone]} ${className}`} aria-hidden="true">
      <span key={mood} className={`xp-cat-face ${blink ? "xp-cat-blink" : ""}`} data-mood={mood}>
        (=<span className="xp-cat-ear">{c.ears[0]}</span>
        <span className="xp-cat-eyes" style={eyes}>
          <span className="xp-cat-eye">{c.eyes[0]}</span>
          {c.mouth}
          <span className="xp-cat-eye">{c.eyes[1]}</span>
        </span>
        <span className="xp-cat-ear">{c.ears[1]}</span>=)
      </span>
    </span>
  );
}
