// The top bar's repo box (components/shell/quick-check.tsx) and its one hint,
// "Try owner/name…". The box lives in the layout, so it outlives the page it
// was used on: the hint has to go away on its own, not wait for a reload.

/** Whether the hint shows, and the page it belongs to. */
export type HintState = { shown: boolean; path: string };

export type HintEvent =
  | { type: "submit"; valid: boolean }
  /** Typing, pasting or deleting in the box. */
  | { type: "input" }
  /** Focus left the box (its button counts as the box), or Escape. */
  | { type: "leave" }
  /** The page changed under the box. */
  | { type: "route"; path: string };

export function hintState(path: string): HintState {
  return { shown: false, path };
}

export function nextHint(s: HintState, e: HintEvent): HintState {
  switch (e.type) {
    case "submit":
      return s.shown === !e.valid ? s : { ...s, shown: !e.valid };
    case "input":
    case "leave":
      return s.shown ? { ...s, shown: false } : s;
    case "route":
      return e.path === s.path ? s : { shown: false, path: e.path };
  }
}
