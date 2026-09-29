// PROTOTYPE, don't merge. The one visual system for signed-in pages
// (docs/design/DASHBOARD.md): page head, the loop, section head, rows for
// your things, cards for discovery, the wait bar.
import { CatFace } from "@/components/cat-face";
import { RepoAvatar } from "@/components/repo-card/repo-avatar";
import { VerdictPill } from "@/components/report/verdict-pill";
import type { CatMood } from "@/lib/cat";
import { CAT, TONE_TEXT } from "@/lib/cat";
import { span, type LabRepo } from "./data";

/** A headline that lands word by word. Words wrapped in *stars* get the marker. */
export function PageHead({ title, lead, mood, children }: { title: string; lead?: React.ReactNode; mood: CatMood; children?: React.ReactNode }) {
  const words = title.split(/(\*[^*]+\*)/).flatMap((part) =>
    part.startsWith("*") ? part.slice(1, -1).split(" ").map((w) => ({ w, mark: true })) : part.split(" ").filter(Boolean).map((w) => ({ w, mark: false })),
  );
  return (
    <header>
      <div className="dl-head">
        <div className="min-w-0">
          <h1 className="dl-h1" aria-label={title.replaceAll("*", "")}>
            {words.map(({ w, mark }, i) => (
              <span key={i} aria-hidden="true">
                <span className={`dl-word ${mark ? "dl-mark" : ""}`} style={{ "--i": i } as React.CSSProperties}>{w}</span>{" "}
              </span>
            ))}
          </h1>
          {lead && <p className="dl-lead">{lead}</p>}
        </div>
        <CatFace mood={mood} className={`dl-cat hidden sm:block ${TONE_TEXT[CAT[mood].tone]}`} />
      </div>
      {children}
    </header>
  );
}

const STEPS = ["find a repo", "pick an issue", "open a PR", "get it merged"] as const;

/**
 * Where you are in the contribution loop, from the account (never ticked by
 * hand). `at` is the step you're on; 4 means the loop is done (just merged).
 */
export function Loop({ at }: { at: 0 | 1 | 2 | 3 | 4 }) {
  return (
    <ol className="dl-loop" aria-label={at === 4 ? "Merged. The loop starts again." : `Step ${at + 1} of 4: ${STEPS[at]}`}>
      <span className="dl-loop-fill" style={{ "--p": `${Math.min(at, 3) * 25}%` } as React.CSSProperties} aria-hidden="true" />
      {STEPS.map((s, i) => (
        <li key={s} className="dl-step" data-s={i < at ? "done" : i === at ? "now" : "todo"}>
          <span className="dl-dot" aria-hidden="true" />
          <span>{s}</span>
        </li>
      ))}
    </ol>
  );
}

export function SectionHead({ title, count, more }: { title: string; count?: number; more?: { label: string; onClick?: () => void; href?: string } }) {
  return (
    <div className="dl-sh">
      <h2>
        {title}
        {count != null && <span className="ml-2 font-normal text-faint">{count}</span>}
      </h2>
      {more && (more.href ? <a href={more.href} className="dl-quiet">{more.label}</a> : <button type="button" onClick={more.onClick} className="dl-quiet">{more.label}</button>)}
    </div>
  );
}

export function RepoName({ repo, className = "" }: { repo: string; className?: string }) {
  const [owner, name] = repo.split("/");
  return (
    <span className={`font-mono font-semibold tracking-tight ${className}`}>
      <span className="font-normal text-muted">{owner}/</span>
      {name}
    </span>
  );
}

/** One of your things: a state colour on the left, the facts, one action on the right. */
export function Row({ rule, children, action }: { rule: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <li className="dl-row" style={{ "--rule": rule } as React.CSSProperties}>
      <span className="dl-rule" aria-hidden="true" />
      <div className="min-w-0">{children}</div>
      {action && <div className="shrink-0">{action}</div>}
    </li>
  );
}

/** Days waited against this repo's typical first reply: blue while normal, orange once it's past. */
export function WaitBar({ hours, typical }: { hours: number; typical: number }) {
  const max = Math.max(hours, typical) * 1.25;
  const late = hours > typical * 1.5;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
      <div
        className="dl-wait"
        role="img"
        aria-label={`Waited ${span(hours)}. Replies here usually come within ${span(typical)}.`}
        style={{ "--w": `${(hours / max) * 100}%`, "--t": `${(typical / max) * 100}%`, "--c": late ? "var(--orange)" : "var(--blue)" } as React.CSSProperties}
      >
        <span />
        <i />
      </div>
      <span className={`font-mono text-[0.78rem] ${late ? "text-orange" : "text-faint"}`}>
        {span(hours)} · usually {span(typical)}
      </span>
    </div>
  );
}

/** A repo to consider: the verdict, the numbers, why it's here, one issue to start with. */
export function PickCard({ r, i = 0, saved, onSave }: { r: LabRepo; i?: number; saved?: boolean; onSave?: () => void }) {
  const issue = r.issues[0];
  return (
    <article className="dl-card dl-appear h-full" style={{ "--i": i } as React.CSSProperties}>
      <div className="flex items-start gap-3">
        <RepoAvatar repo={r.repo} size={34} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[1rem]">
            <a href={`/${r.repo}`} className="hover:text-blue"><RepoName repo={r.repo} /></a>
          </h3>
          <p className="truncate font-sans text-[0.86rem] text-muted">{r.description}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <VerdictPill headline={r.headline} tone={r.tone} className="px-1.5 py-0.5 text-[0.76rem]" />
        <span className="font-mono text-[0.78rem] text-faint">{r.merged} of {r.attempts} merged · replies in {span(r.replyHours)}</span>
      </div>
      <div className="dl-odds mt-3" aria-hidden="true"><span style={{ width: `${(r.merged / r.attempts) * 100}%` }} /></div>
      {r.why.length > 0 && <p className="mt-3 font-sans text-[0.9rem] text-ink">{r.why.join(", ")}.</p>}
      {issue && (
        <p className="mt-3 border-t border-line pt-3 font-sans text-[0.88rem]">
          <span className="font-mono text-[0.76rem] text-faint">start with </span>
          <span className="text-blue">#{issue.number}</span> {issue.title}
        </p>
      )}
      <div className="mt-auto flex items-center justify-between pt-4">
        <a href={`/${r.repo}`} className="dl-quiet">report →</a>
        {onSave && (
          <button type="button" onClick={onSave} aria-pressed={saved} className={`min-h-9 border px-3 font-mono text-[0.8rem] ${saved ? "border-blue text-blue" : "border-line-strong text-muted hover:text-ink"}`}>
            {saved ? "saved" : "save"}
          </button>
        )}
      </div>
    </article>
  );
}

export function Empty({ mood, text, action }: { mood: CatMood; text: string; action: React.ReactNode }) {
  return (
    <div className="mt-4 flex flex-col items-start gap-3 py-6">
      <CatFace mood={mood} className={`text-[1.5rem] ${TONE_TEXT[CAT[mood].tone]}`} />
      <p className="font-sans text-muted">{text}</p>
      {action}
    </div>
  );
}
