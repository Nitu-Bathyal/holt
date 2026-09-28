"use client";

// "Check your PR against this repo" on a report page. It asks whether
// pre-flight is on after the report renders, and shows nothing when it's off
// (or the answer doesn't come).
import Link from "next/link";
import { useEffect, useState } from "react";
import { preflightHref } from "@/lib/preflight";

export function PreflightLink({ repo }: { repo: string }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/preflight")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((body: { available?: boolean } | null) => {
        if (!cancelled) setOn(body?.available === true);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  if (!on) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border border-dashed border-line-strong p-4" data-preflight-link>
      <p className="font-sans text-[0.95rem] text-muted">Already opened a pull request here, or about to?</p>
      <Link href={preflightHref({ repo })} prefetch={false} className="bracket-link">[ check your PR against this repo → ]</Link>
    </div>
  );
}
