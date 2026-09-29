// PROTOTYPE, don't merge. Bits the /lab/history concepts share.
import type { Persona, Pr } from "./data";

/** Shared by the concepts: the page's one sentence, in the app's page-head size. */
export function Head({ title, sub, children }: { title: React.ReactNode; sub?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
      <div className="min-w-0">
        <h1 className="hx-title">{title}</h1>
        {sub && <p className="mt-2 font-mono text-[0.85rem] text-faint">{sub}</p>}
      </div>
      {children}
    </header>
  );
}

export interface ConceptProps {
  persona: Persona;
  prs: Pr[];
  reduced: boolean;
}

