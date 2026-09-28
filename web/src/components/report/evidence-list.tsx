import { evidenceLabel, evidenceRef, evidenceTitle } from "@/lib/format";
import { codeSpans } from "@/lib/playbook";
import type { EvidenceItem } from "@/lib/types";

function Item({ e }: { e: EvidenceItem }) {
  const { label, bad } = evidenceLabel(e);
  const { title, quoted } = evidenceTitle(e.text);
  return (
    <li className="grid gap-x-5 gap-y-1 border-b border-line py-3.5 sm:grid-cols-[9.5rem_minmax(0,1fr)_auto] sm:items-baseline">
      <span className={`text-[0.78rem] uppercase tracking-[0.06em] ${bad ? "text-orange" : "text-green"}`}>{label}</span>
      <div className="min-w-0">
        <p className={`font-sans text-[0.95rem] leading-snug ${quoted ? "text-ink" : "text-muted"}`}>
          {codeSpans(title).map(([piece, code], i) =>
            code ? (
              <code key={i} className="bg-panel-2 px-1 text-[0.9em]">
                {piece}
              </code>
            ) : (
              <span key={i}>{piece}</span>
            ),
          )}
        </p>
        {e.quote && <blockquote className="mt-1.5 border-l-2 border-line-strong pl-3 font-sans text-[0.9rem] text-muted">“{e.quote}”</blockquote>}
      </div>
      <a
        href={e.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-9 items-center self-start text-[0.87rem] tabular-nums text-blue hover:underline sm:min-h-0"
      >
        {evidenceRef(e.url)} <span aria-hidden="true">&nbsp;↗</span>
        <span className="sr-only"> on GitHub</span>
      </a>
    </li>
  );
}

export function EvidenceList({ evidence }: { evidence: EvidenceItem[] }) {
  if (!evidence.length) return <p className="font-sans text-muted">No evidence items.</p>;
  const first = evidence.slice(0, 5);
  const rest = evidence.slice(5);
  return (
    <div className="border-t border-line-strong">
      <ul>{first.map((e, i) => <Item key={`${i}:${e.id}`} e={e} />)}</ul>
      {rest.length > 0 && (
        <details className="group">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 py-3 text-[0.88rem] text-green [&::-webkit-details-marker]:hidden">
            <span className="group-open:hidden">Show {rest.length} more</span>
            <span className="hidden group-open:inline">Show fewer</span>
          </summary>
          <ul>{rest.map((e, i) => <Item key={`${i + first.length}:${e.id}`} e={e} />)}</ul>
        </details>
      )}
    </div>
  );
}
