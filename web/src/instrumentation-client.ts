// Runs in the browser before the app hydrates (Next's instrumentation-client).
// Wraps document.startViewTransition so a transition skipped because the tab
// went hidden rejects with the message React knows to ignore (lib/view-transition.ts).
import { quietSkip } from "@/lib/view-transition";

type VT = { ready: Promise<void>; finished: Promise<void>; updateCallbackDone: Promise<void> };

const start = typeof document !== "undefined" ? document.startViewTransition : undefined;
if (start) {
  document.startViewTransition = function (this: Document, ...args: Parameters<typeof start>) {
    const t = start.apply(this, args);
    for (const key of ["ready", "finished", "updateCallbackDone"] as const) {
      const p = (t as unknown as VT)[key];
      if (!p) continue;
      const q = p.catch((e: unknown) => Promise.reject(quietSkip(e)));
      // Like the browser's own, a rejection nobody listens for isn't an error.
      q.catch(() => {});
      Object.defineProperty(t, key, { value: q, configurable: true });
    }
    return t;
  } as typeof document.startViewTransition;
}
