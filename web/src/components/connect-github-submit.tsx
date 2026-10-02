"use client";
// The connect form's button. It locks and says where you're going once
// pressed, so the hop to GitHub never looks like a dead click. Coming back
// with the browser's Back button restores the page mid-redirect, so that
// unlocks it.
import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

export function ConnectSubmit({ viaGitHub }: { viaGitHub: boolean }) {
  const { pending } = useFormStatus();
  const [restored, setRestored] = useState(false);
  const busy = pending && !restored;

  useEffect(() => {
    const unlock = (e: PageTransitionEvent) => e.persisted && setRestored(true);
    window.addEventListener("pageshow", unlock);
    return () => window.removeEventListener("pageshow", unlock);
  }, []);

  return (
    <button type="submit" className="btn-primary disabled:cursor-wait" disabled={busy} aria-busy={busy}>
      {viaGitHub ? (busy ? "opening GitHub…" : "continue to GitHub") : busy ? "connecting…" : "connect GitHub"}
    </button>
  );
}

/** The merge offer's one button. */
export function MergeSubmit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary disabled:cursor-wait" disabled={pending} aria-busy={pending}>
      {pending ? "merging…" : "merge accounts"}
    </button>
  );
}
