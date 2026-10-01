// The home's head (the dashboard plan): the next move as one sentence
// that lands word by word, the cat reacting to it, one fact, the one primary
// action, and the loop with where you are lit.
import { CatFace } from "@/components/cat-face";
import { CAT, TONE_TEXT, type CatMood } from "@/lib/cat";
import type { NextMove } from "@/lib/home";

/** The loop's four steps; the tip shows as the step's tooltip. */
const STEPS = [
  { title: "Find a repo", hint: "One where outside PRs get replies and merges." },
  { title: "Pick an issue", hint: "Small, clearly described, and nobody's on it." },
  { title: "Open a PR", hint: "Follow the repo's contributing guide." },
  { title: "Get it merged", hint: "Answer reviews quickly." },
] as const;

function Words({ title }: { title: string }) {
  let i = 0;
  const parts = title.split(/(\*[^*]+\*)/).filter(Boolean);
  return (
    <>
      {parts.map((part, p) => {
        const mark = part.startsWith("*");
        return part.replaceAll("*", "").split(" ").filter(Boolean).map((w) => {
          const n = i++;
          return (
            <span key={`${p}-${n}`}>
              <span className={`move-word ${mark ? "move-mark" : ""}`} style={{ "--i": n } as React.CSSProperties}>{w}</span>{" "}
            </span>
          );
        });
      })}
    </>
  );
}

/** A page sentence whose *starred* words get the marker; screen readers get it plain. */
export function MarkedTitle({ title }: { title: string }) {
  return (
    <>
      <span className="sr-only">{title.replaceAll("*", "")}</span>
      <span aria-hidden="true"><Words title={title} /></span>
    </>
  );
}

/** Where you are in the loop: a bar of four segments, the ones behind you
 * green, yours blue. Step 4 means just merged: every step is done. */
export function Loop({ step }: { step: NextMove["step"] }) {
  const done = step === 4;
  return (
    <div className="loop-bar">
      <p className="loop-bar-head">
        <span>Your path to a merged PR</span>
        <span className="tabular-nums">{done ? "all done" : `step ${step + 1} of 4`}</span>
      </p>
      <ol className="loop" aria-label={done ? "Merged. The loop starts again." : `Step ${step + 1} of 4: ${STEPS[step].title}`}>
        {STEPS.map((s, i) => {
          const state = i < step ? "done" : i === step ? "now" : "todo";
          return (
            <li key={s.title} className="loop-step" data-s={state} aria-current={state === "now" ? "step" : undefined} title={s.hint}>
              <span aria-hidden="true" className="loop-seg" />
              <span className="loop-label">
                <span aria-hidden="true" className="loop-n">{state === "done" ? "✓" : i + 1}</span>
                {s.title}
                {state === "done" && <span className="sr-only"> (done)</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** `loop`: show where you are in the loop, at the right, level with the line
 * under the headline (left out while you're starting: with nothing saved,
 * checked or opened, there's no progress to show). */
export function MoveHead({ title, lead, mood, step, loop, children }: { title: string; lead: string | null; mood: CatMood; step: NextMove["step"]; loop: boolean; children?: React.ReactNode }) {
  return (
    <header className="app-head home-head">
      <div className="flex min-w-0 items-start gap-4">
        <h1 className="app-h1 home-h1"><MarkedTitle title={title} /></h1>
        <CatFace mood={mood} className={`app-head-cat home-cat hidden sm:block ${TONE_TEXT[CAT[mood].tone]}`} />
      </div>
      <div className="flex flex-wrap items-start justify-between gap-x-10 gap-y-6">
        <div className="min-w-0 flex-1 basis-80">
          {lead && <p className="app-lead">{lead}</p>}
          {children}
        </div>
        {loop && <Loop step={step} />}
      </div>
    </header>
  );
}
