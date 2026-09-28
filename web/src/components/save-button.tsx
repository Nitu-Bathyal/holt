"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { signInToSave, wantsSave, withoutSave } from "@/lib/saved";

const FAILED = "That didn't save. Please try again.";

function Bookmark({ filled, drop }: { filled: boolean; drop: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={`size-4 shrink-0 ${drop ? "save-drop" : ""}`} fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 3.5h12a.5.5 0 0 1 .5.5v16.2a.3.3 0 0 1-.48.24L12 16l-6.02 4.44a.3.3 0 0 1-.48-.24V4a.5.5 0 0 1 .5-.5Z" />
    </svg>
  );
}

/**
 * Save a repo to come back to later (API.md, "Saved repos"). `saved` is null
 * when signed out: pressing it then explains saving and offers sign-in, which
 * comes back here and saves it. The toggle is optimistic; a failure puts it
 * back and says so.
 */
export function SaveButton({ repo, saved: initial, className = "" }: { repo: string; saved: boolean | null; className?: string }) {
  const [saved, setSaved] = useState(Boolean(initial));
  const [error, setError] = useState("");
  const [fresh, setFresh] = useState(false);
  const [asking, setAsking] = useState(false);
  // Requests go one after another, so a quick save-unsave-save lands in order.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const latest = useRef(0);
  const signedIn = initial !== null;

  function send(next: boolean) {
    const seq = ++latest.current;
    setSaved(next);
    setFresh(next);
    setError("");
    queue.current = queue.current.then(async () => {
      let ok = false;
      let message = FAILED;
      try {
        const res = await fetch(`/api/saved/${repo.split("/").map(encodeURIComponent).join("/")}`, { method: next ? "PUT" : "DELETE" });
        ok = res.ok;
        if (!ok) message = (await res.json().catch(() => null))?.error?.message || FAILED;
      } catch {
        // offline: the message below
      }
      // A newer click decides what shows; only the last one reports a failure.
      if (!ok && seq === latest.current) {
        setSaved(!next);
        setFresh(false);
        setError(message);
      }
    });
  }

  // Back from "sign in to save": finish what they started, once.
  const handled = useRef(false);
  useEffect(() => {
    if (handled.current || !signedIn || !wantsSave(window.location.search, repo)) return;
    handled.current = true;
    window.history.replaceState(window.history.state, "", withoutSave(window.location.pathname, window.location.search) + window.location.hash);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a one-off action on arrival, not derived state
    if (!initial) send(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const label = saved ? "saved" : "save";
  const button = (
    <button
      type="button"
      aria-pressed={signedIn ? saved : undefined}
      aria-expanded={signedIn ? undefined : asking}
      aria-label={`${saved ? "Saved" : "Save"} ${repo} for later`}
      onClick={() => (signedIn ? send(!saved) : setAsking((a) => !a))}
      data-umami-event={signedIn ? (saved ? "unsave-repo" : "save-repo") : "save-repo-signed-out"}
      className={`inline-flex min-h-11 items-center gap-2 border px-3 text-[0.8rem] transition-colors ${
        saved ? "border-blue bg-blue/10 text-blue" : "border-line-strong bg-panel text-muted hover:border-ink hover:text-ink"
      }`}
    >
      <Bookmark filled={saved} drop={saved && fresh} />
      {label}
    </button>
  );

  if (!signedIn) {
    return (
      <span className={`relative inline-flex shrink-0 ${className}`}>
        {button}
        {asking && <SignInPrompt repo={repo} onClose={() => setAsking(false)} />}
      </span>
    );
  }

  return (
    <span className={`inline-flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 ${className}`}>
      {button}
      {fresh && !error && (
        <Link href="/me/saved" className="hidden text-[0.75rem] text-faint hover:text-blue sm:inline">
          see your saved repos
        </Link>
      )}
      <span role="status" className={error ? "basis-full text-[0.75rem] text-orange" : "sr-only"}>
        {error || (fresh ? `${repo} saved` : "")}
      </span>
    </span>
  );
}

/** Signed out: what saving is, and one step to do it. */
function SignInPrompt({ repo, onClose }: { repo: string; onClose: () => void }) {
  const pathname = usePathname();
  const box = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLAnchorElement>(null);
  const titleId = useId();
  const [search, setSearch] = useState("");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the query string is only known in the browser
    setSearch(window.location.search);
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onDown = (e: PointerEvent) => {
      if (box.current && !box.current.parentElement?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [onClose]);

  return (
    <div
      ref={box}
      role="dialog"
      aria-labelledby={titleId}
      className="absolute right-0 top-full z-30 mt-2 w-[min(20rem,calc(100vw-2rem))] border border-line-strong bg-panel p-4 text-left shadow-card"
    >
      <p id={titleId} className="text-[0.92rem] font-semibold">Keep this one for later</p>
      <p className="mt-1.5 font-sans text-[0.85rem] leading-snug text-muted">
        Sign in with GitHub or Google and {repo} goes on your saved list, ready when you have time. It&apos;s free.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Link ref={first} href={signInToSave(pathname, search, repo)} prefetch={false} className="btn-primary bg-blue" data-umami-event="save-repo-sign-in">
          sign in to save
        </Link>
        <button type="button" onClick={onClose} className="min-h-11 text-[0.8rem] text-faint hover:text-ink">
          not now
        </button>
      </div>
    </div>
  );
}
