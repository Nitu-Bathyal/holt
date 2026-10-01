// The home's head (the dashboard plan): the next move as one sentence
// that lands word by word, the cat reacting to it, one fact, the one primary
// action, and the loop with where you are lit.
import { CatFace } from "@/components/cat-face";
import { CAT, TONE_TEXT, type CatMood } from "@/lib/cat";
import type { NextMove } from "@/lib/home";

const STEPS = ["find a repo", "pick an issue", "open a PR", "get it merged"] as const;

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

/** Where you are in the loop: four numbered segments, the ones behind you filled. Step 4 means just merged: every step is done. */
export function Loop({ step }: { step: NextMove["step"] }) {
  return (
    <ol className="loop" aria-label={step === 4 ? "Merged. The loop starts again." : `Step ${step + 1} of 4: ${STEPS[step]}`}>
      {STEPS.map((s, i) => (
        <li key={s} className="loop-step" data-s={i < step ? "done" : i === step ? "now" : "todo"}>
          <span aria-hidden="true" className="loop-seg" />
          <span className="loop-label">
            <span aria-hidden="true" className="loop-n">{i + 1}</span> {s}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** `aside`: sits level with the headline, at the right (the repo box). */
export function MoveHead({ title, lead, mood, step, aside, children }: { title: string; lead: string | null; mood: CatMood; step: NextMove["step"]; aside?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <header className="app-head home-head">
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
        <div className="flex min-w-0 items-start gap-4">
          <div className="min-w-0">
            <h1 className="app-h1 home-h1"><MarkedTitle title={title} /></h1>
            {lead && <p className="app-lead">{lead}</p>}
          </div>
          <CatFace mood={mood} className={`app-head-cat home-cat hidden sm:block ${TONE_TEXT[CAT[mood].tone]}`} />
        </div>
        {aside && <div className="w-full sm:w-80 lg:w-96">{aside}</div>}
      </div>
      {children}
      <Loop step={step} />
    </header>
  );
}
