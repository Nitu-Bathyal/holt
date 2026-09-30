// The cat as a face that reacts (the expressive design plan). A mood change
// re-keys the face, so its squash (.rcat-face in globals.css) replays; `look`
// (-1..1) turns the eyes and mouth toward something. Decorative: always
// aria-hidden, never the only sign of anything.
import { CAT, TONE_TEXT, type CatMood } from "@/lib/cat";

export function ReactiveCat({ mood, look = 0, blink = true, className = "" }: { mood: CatMood; look?: number; blink?: boolean; className?: string }) {
  const c = CAT[mood];
  const gaze = { transform: `translateX(${(Math.max(-1, Math.min(1, look)) * 0.18).toFixed(3)}em)` };
  return (
    <span className={`rcat ${TONE_TEXT[c.tone]} ${className}`} aria-hidden="true">
      <span key={mood} className={`rcat-face ${blink ? "rcat-blink" : ""}`} data-mood={mood}>
        (=<span className="rcat-ear">{c.ears[0]}</span>
        <span className="rcat-gaze" style={gaze}>
          <span className="rcat-eye">{c.eyes[0]}</span>
          {c.mouth}
          <span className="rcat-eye">{c.eyes[1]}</span>
        </span>
        <span className="rcat-ear">{c.ears[1]}</span>=)
      </span>
    </span>
  );
}
