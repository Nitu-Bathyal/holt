// React's <ViewTransition> drops the errors a browser raises when it skips a
// transition because the tab went hidden, but it matches them by exact
// message. Chrome now says "Transition was aborted because of invalid state.
// Document hidden", which React misses, so switching tabs mid-navigation
// surfaced a "Recoverable InvalidStateError" (the dev overlay; the console in
// production). instrumentation-client.ts rewrites that message to the one
// React knows. Pure, so it runs under `node --test`.

/** The message React (19.2) recognises as a harmless skip. */
export const REACT_SKIP_MESSAGE = "Transition was aborted because of invalid state";

/** A skipped-transition error React would miss, as one it recognises; anything else unchanged. */
export function quietSkip(error: unknown): unknown {
  if (typeof error !== "object" || error === null) return error;
  const { name, message } = error as { name?: unknown; message?: unknown };
  if (name !== "InvalidStateError" || typeof message !== "string") return error;
  if (message === REACT_SKIP_MESSAGE || !message.startsWith(REACT_SKIP_MESSAGE)) return error;
  return { name, message: REACT_SKIP_MESSAGE, cause: error };
}
