"use client";

import * as Tooltip from "@radix-ui/react-tooltip";

/**
 * A short plain-English explanation on hover or keyboard focus, around
 * `children` in a focusable block (`className` styles it). The block is made
 * here, not passed in: a server component's element arrives in a client
 * component unresolved, and Radix's `asChild` can't attach to it, which made
 * the whole report fall back to rendering in the browser.
 */
export function Tip({ text, className, children }: { text: string; className?: string; children: React.ReactNode }) {
  return (
    <Tooltip.Provider delayDuration={200} skipDelayDuration={100}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <div tabIndex={0} className={className}>
            {children}
          </div>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side="left"
            align="center"
            sideOffset={8}
            collisionPadding={12}
            className="z-50 max-w-[15rem] border border-line-strong bg-panel px-2.5 py-1.5 font-sans text-[0.8rem] leading-snug text-ink shadow-soft"
          >
            {text}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
