"use client";

import { useEffect, useState } from "react";

/**
 * A thin bar under the site header that appears once the report's own header
 * has scrolled away: the repo, its verdict and Save, so the answer stays in
 * view. Put `<StickySentinel />` right under the real header; the bar shows
 * when that leaves the screen.
 */
export function ReportStickyBar({ repo, verdict, children }: { repo: string; verdict?: string; children?: React.ReactNode }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = document.getElementById("report-header-end");
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setShown(!e.isIntersecting && e.boundingClientRect.top < 0), { rootMargin: "-60px 0px 0px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div
      aria-hidden={!shown}
      inert={!shown}
      className={`fixed inset-x-0 top-[60px] z-30 border-b border-line bg-header transition-[opacity,transform] duration-200 ${shown ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-2 opacity-0"}`}
    >
      <div className="report-wide flex min-h-11 items-center gap-3 text-[0.9rem]">
        <span className="min-w-0 truncate font-semibold">{repo}</span>
        {verdict && <span className="hidden shrink-0 font-sans text-muted sm:inline">{verdict}</span>}
        <span className="ml-auto flex shrink-0 items-center gap-2">{children}</span>
      </div>
    </div>
  );
}

export function StickySentinel() {
  return <div id="report-header-end" aria-hidden="true" className="h-px" />;
}
