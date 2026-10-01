"use client";

import * as Collapsible from "@radix-ui/react-collapsible";
import { ChevronDown } from "lucide-react";
import { useState } from "react";

/**
 * A report section whose body folds away behind its heading. The body stays in
 * the page when folded (hidden, not removed), so its links are still there for
 * search engines and find-in-page.
 */
export function CollapsibleSection({ id, title, note, count, defaultOpen = false, children }: { id: string; title: string; note?: string; count?: number; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} asChild>
      <section aria-labelledby={id} className="border-t border-line pt-5">
        <Collapsible.Trigger className="group flex min-h-11 w-full items-center gap-3 text-left">
          <h2 id={id} className="text-[1.05rem] font-semibold tracking-tight sm:text-[1.15rem]">{title}</h2>
          {count != null && <span className="text-[0.85rem] tabular-nums text-faint">{count}</span>}
          {note && <span className="hidden font-sans text-[0.89rem] text-faint sm:inline">{note}</span>}
          <ChevronDown aria-hidden="true" className="ml-auto size-4 shrink-0 text-muted transition-transform duration-200 group-data-[state=open]:rotate-180" />
        </Collapsible.Trigger>
        <Collapsible.Content forceMount className="data-[state=closed]:hidden">
          <div className="pt-2">{children}</div>
        </Collapsible.Content>
      </section>
    </Collapsible.Root>
  );
}
