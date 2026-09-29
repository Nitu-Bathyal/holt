"use client";
// PROTOTYPE, don't merge. Concept B, "changelog": you, released. Every first
// (first merge, a new repo, a new language, a merge faster than that repo's
// usual, a round number) is a release; the merged PRs between ride along.
// The version reads back: 1.6.10 is six repos, ten merged.
import { useEffect, useState } from "react";
import { CatFace } from "@/components/cat-face";
import type { Pr } from "./data";
import { day, duration, inOctober, releases, since, url, version, type Note, type Release } from "./facts";
import { Head, type ConceptProps } from "./ui";

export function Changelog({ persona, prs, reduced }: ConceptProps) {
  const list = releases(prs, persona.repos, !!persona.before);
  const waiting = prs.filter((x) => x.state === "open").sort((a, b) => Date.parse(b.opened) - Date.parse(a.opened));
  const v = version(prs);

  return (
    <section>
      <Head title={<>{persona.login} <Version to={v} reduced={reduced} /></>} sub={`since ${since()}`} />

      <ol className="hx-log">
        {waiting.length > 0 && (
          <li className="hx-rel hx-rel-open">
            <div className="hx-rel-head">
              <h2 className="hx-ver">Unreleased</h2>
              <span className="text-faint">{waiting.length} waiting</span>
            </div>
            <ul className="hx-prs">
              {waiting.map((x) => <PrLine key={`${x.repo}#${x.number}`} pr={x} note={`waiting since ${day(x.opened)}`} />)}
            </ul>
          </li>
        )}
        {list.map((r) => <ReleaseItem key={r.version} r={r} persona={persona} />)}
      </ol>

      {persona.before && (
        <p className="mt-8 font-sans text-[0.9rem] text-muted">
          Before this: your first merged PR, <a className="hx-link" href={`https://github.com/${persona.before.repo}/pull/${persona.before.number}`}>{persona.before.repo}#{persona.before.number}</a>, {day(persona.before.date)}.
        </p>
      )}
    </section>
  );
}

function ReleaseItem({ r, persona }: { r: Release; persona: ConceptProps["persona"] }) {
  const [open, setOpen] = useState(false);
  const first = r.notes.some((n) => n.kind === "first");
  const october = inOctober(r.pr);
  return (
    <li className={`hx-rel ${first ? "hx-rel-first" : ""}`}>
      <div className="hx-rel-head">
        <h2 className="hx-ver">[{r.version}]</h2>
        <span className="text-faint">{day(r.pr.done!)}</span>
        {october && <span className="hx-tag hx-tag-hf">Hacktoberfest</span>}
        {first && <CatFace mood="celebrating" className="ml-auto text-[1.05rem]" />}
      </div>
      <ul className="hx-notes">
        {r.notes.map((n, i) => <li key={i}>{noteText(n, r.pr, !!persona.before)}</li>)}
      </ul>
      <ul className="hx-prs">
        <PrLine pr={r.pr} />
        {open && r.also.map((x) => <PrLine key={`${x.repo}#${x.number}`} pr={x} note={day(x.done!)} />)}
      </ul>
      {r.also.length > 0 && (
        <button type="button" className="hx-more mt-1" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "fewer" : `+ ${r.also.length} more merged`}
        </button>
      )}
    </li>
  );
}

function noteText(n: Note, pr: Pr, before: boolean): React.ReactNode {
  switch (n.kind) {
    case "first": return before ? "First merge of the year." : "First PR merged.";
    case "repo": return `First merge in ${pr.repo}.`;
    case "language": return `First ${n.language} PR merged.`;
    case "faster": return `Merged in ${duration(n.took)}. It usually takes ${duration(n.typical)}.`;
    case "odds": return `${n.inTen} in 10 outside PRs get merged here. Yours did.`;
    case "count": return `${n.n} PRs merged.`;
    case "holt": return "Checked on Holt first.";
  }
}

function PrLine({ pr, note }: { pr: Pr; note?: string }) {
  return (
    <li>
      <a href={url(pr)} className="hx-link">{pr.repo}#{pr.number}</a>{" "}
      <span className="font-sans text-muted">{pr.title}</span>
      {note && <span className="ml-2 text-faint">{note}</span>}
    </li>
  );
}

/** The version counts up to where you are: the one moment on this page. */
function Version({ to, reduced }: { to: string; reduced: boolean }) {
  const [shown, setShown] = useState(reduced ? to : to.replace(/\d+$/, "0"));
  useEffect(() => {
    if (reduced) return;
    const [head, patch] = [to.replace(/\d+$/, ""), Number(to.match(/\d+$/)![0])];
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / 900);
      setShown(`${head}${Math.round(patch * (1 - (1 - k) ** 3))}`);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, reduced]);
  return (
    <span className="hx-version" aria-label={`version ${to}`}>
      <span aria-hidden="true" style={{ minWidth: `${to.length + 1}ch` }}>v{shown}</span>
    </span>
  );
}
