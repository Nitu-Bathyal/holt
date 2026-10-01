"use client";
// The way back from a report to the list you opened it from (Your repos, or
// the home's list). A row's click remembers its page, tab included, for this
// tab only; the report shows "← Your repos" when it is that row's repo. A
// shared or typed-in report link has nothing remembered, so shows nothing.
import Link from "next/link";
import { useSyncExternalStore } from "react";

const KEY = "holt-back-to";

/** Where each list lives, by pathname. */
const LABELS: Record<string, string> = { "/me/repos": "Your repos", "/me": "Home" };

/** Remember the page this row was opened from. Call it on the row link's click. */
export function rememberBack(repo: string) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ repo: repo.toLowerCase(), href: location.pathname + location.search }));
  } catch {}
}

function read(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

const noop = () => () => {};

export function BackLink({ repo }: { repo: string }) {
  const raw = useSyncExternalStore(noop, read, () => null);
  if (!raw) return null;
  let back: { repo?: string; href?: string };
  try {
    back = JSON.parse(raw);
  } catch {
    return null;
  }
  if (back.repo !== repo.toLowerCase() || !back.href) return null;
  const label = LABELS[back.href.split("?")[0]];
  if (!label) return null;
  return (
    <Link href={back.href} className="mb-4 inline-flex min-h-11 items-center text-[0.82rem] text-muted hover:text-blue sm:min-h-0">
      ← {label}
    </Link>
  );
}
