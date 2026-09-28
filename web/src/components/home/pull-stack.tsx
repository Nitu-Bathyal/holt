"use client";

// A repo's pull requests on the home's row, as one card. Several to the same
// repo stack like a deck; the button spreads them into a list in place.
import Link from "next/link";
import { useId, useState } from "react";
import { STATE_LABEL } from "@/lib/contributions";
import { shortDate, timeAgo } from "@/lib/format";
import { pullCountLine, type PullGroup } from "@/lib/home";
import type { ContributionPR } from "@/lib/types";
import { VerdictPill } from "../report/verdict-pill";

const STATE_TEXT: Record<ContributionPR["state"], string> = { open: "text-blue", merged: "text-green", closed: "text-faint" };

function when(p: ContributionPR): string {
  if (p.state === "open") return `opened ${timeAgo(p.created_at)}`;
  return shortDate(p.merged_at ?? p.closed_at ?? p.created_at);
}

export function PullStack({ g }: { g: PullGroup }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const [owner, name] = g.repo.split("/");
  const latest = g.pulls[0];
  const deck = g.pulls.length > 1;
  const verdict = g.pulls.find((p) => p.verdict)?.verdict;

  return (
    <li className={`relative w-[17.5rem] shrink-0 snap-start sm:w-[19rem] ${open ? "self-start" : ""} ${deck ? "pb-2 pr-2" : ""}`}>
      {deck && !open && (
        // The deck's edges: one sheet per extra pull request, up to two.
        <span aria-hidden="true">
          {g.pulls.length > 2 && <span className="absolute inset-0 left-2 top-2 border border-line bg-panel-2" />}
          <span className="absolute inset-0 bottom-1 left-1 right-1 top-1 border border-line-strong bg-panel-2" />
        </span>
      )}
      <article className={`relative flex h-full flex-col border border-line-strong bg-panel p-4 shadow-soft`}>
        <h3 className="truncate text-[1rem] font-semibold leading-tight tracking-tight">
          <Link href={`/${g.repo}`} className="hover:text-blue">
            <span className="text-muted">{owner}/</span>
            {name}
          </Link>
        </h3>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          {verdict && <VerdictPill headline={verdict.headline} tone={verdict.tone} className="shrink-0 px-1.5 py-0.5 text-[0.68rem]" />}
          <span className="text-[0.72rem] text-faint">{pullCountLine(g)}</span>
        </div>

        {!open && (
          <p className="mt-3 border-t border-dashed border-line pt-2.5 font-sans text-[0.84rem] leading-snug">
            <a href={latest.url} target="_blank" rel="noopener noreferrer" className="line-clamp-2 font-semibold text-ink hover:text-blue">
              <span className="font-mono text-[0.78rem] font-normal text-blue">#{latest.number}</span> {latest.title}
              <span className="sr-only"> (opens GitHub)</span>
            </a>
            <span className={`mt-1 block font-mono text-[0.72rem] ${STATE_TEXT[latest.state]}`}>
              {STATE_LABEL[latest.state]}, {when(latest)}
            </span>
          </p>
        )}

        {deck && (
          <div id={listId} className={`grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
            <ol className="min-h-0 overflow-hidden" inert={!open}>
              {g.pulls.map((p) => (
                <li key={p.url} className="border-t border-dashed border-line py-2.5 font-sans text-[0.84rem] leading-snug first:mt-3">
                  <a href={p.url} target="_blank" rel="noopener noreferrer" className="line-clamp-2 text-ink hover:text-blue">
                    <span className="font-mono text-[0.78rem] text-blue">#{p.number}</span> {p.title}
                    <span className="sr-only"> (opens GitHub)</span>
                  </a>
                  <span className={`mt-0.5 block font-mono text-[0.72rem] ${STATE_TEXT[p.state]}`}>
                    {STATE_LABEL[p.state]}, {when(p)}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {deck && (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen((o) => !o)}
            className="mt-auto inline-flex min-h-11 items-center self-start pt-2 text-[0.78rem] text-green hover:underline"
          >
            {open ? "[ fold them up ]" : `[ show all ${g.pulls.length} ]`}
          </button>
        )}
      </article>
    </li>
  );
}
