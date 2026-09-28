"use client";
// The "Continue with …" buttons. Once one is pressed, every button locks and
// the pressed one says where you're going, so a slow redirect never looks like
// a dead click (or invites a second one). Coming back with the browser's Back
// button restores a page from the cache mid-redirect, so that unlocks them.
import { useEffect, useState } from "react";

export interface Provider {
  id: string;
  name: string;
  icon: React.ReactNode;
  /** A server action that starts sign-in, or null when this provider isn't set up here. */
  action: (() => Promise<void>) | null;
}

const BASE = "flex min-h-13 w-full items-center justify-center gap-3 border px-4 text-[1rem] font-semibold";
// GitHub is where Holt's audience already lives, so it gets the filled button.
const LOOK: Record<string, string> = {
  github: "border-ink bg-ink text-bg hover:not-disabled:bg-ink/85",
  google: "border-line-strong bg-panel text-ink hover:not-disabled:border-blue",
};
const MOTION = "transition-[background-color,border-color,scale] duration-(--dur-fast) ease-(--ease-out) active:not-disabled:scale-[0.99] disabled:cursor-wait disabled:opacity-70";

export function ProviderButtons({ providers }: { providers: Provider[] }) {
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    const unlock = (e: PageTransitionEvent) => e.persisted && setPending(null);
    window.addEventListener("pageshow", unlock);
    return () => window.removeEventListener("pageshow", unlock);
  }, []);

  return (
    <div className="space-y-3" aria-busy={pending !== null}>
      {providers.map((p) =>
        p.action ? (
          <form key={p.id} action={p.action} onSubmit={() => setPending(p.id)}>
            <button
              type="submit"
              disabled={pending !== null}
              data-umami-event="sign-in"
              data-umami-event-provider={p.id}
              className={`${BASE} ${LOOK[p.id] ?? LOOK.google} ${MOTION}`}
            >
              {pending === p.id ? <Spinner /> : p.icon}
              <span>{pending === p.id ? `Opening ${p.name}…` : `Continue with ${p.name}`}</span>
            </button>
          </form>
        ) : (
          <p key={p.id} className={`${BASE} border-dashed border-line-strong font-normal text-faint`}>
            {p.icon}
            <span>{p.name} sign-in isn&apos;t set up here</span>
          </p>
        ),
      )}
      <p role="status" className="sr-only">
        {pending ? `Opening ${providers.find((p) => p.id === pending)?.name} to sign you in.` : ""}
      </p>
    </div>
  );
}

function Spinner() {
  return (
    <svg viewBox="0 0 24 24" className="size-5 motion-safe:animate-spin" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
