"use client";
// PROTOTYPE: throwaway variant switcher (signed-in home). Never ships.
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

export function PrototypeSwitcher({ variants }: { variants: { key: string; name: string }[] }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const cur = Math.max(0, variants.findIndex((v) => v.key === (sp.get("variant") ?? variants[0].key)));
  const go = (d: number) => {
    const next = new URLSearchParams(sp.toString());
    next.set("variant", variants[(cur + d + variants.length) % variants.length].key);
    router.replace(`${path}?${next}`);
  };
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input,textarea,[contenteditable]")) return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  });
  if (process.env.NODE_ENV === "production") return null;
  const v = variants[cur];
  return (
    <div data-prototype-bar className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full bg-black px-4 py-2 text-[0.8rem] text-white shadow-lg">
      <button type="button" onClick={() => go(-1)} aria-label="previous variant">←</button>
      <span>{v.key} ({v.name})</span>
      <button type="button" onClick={() => go(1)} aria-label="next variant">→</button>
    </div>
  );
}
