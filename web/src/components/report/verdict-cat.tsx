"use client";

// The cat on a report that just finished (docs/design/EXPRESSIVE.md, pattern
// 4): still thinking as the answer lands, then it reacts to the verdict. With
// reduced motion it shows the verdict's face straight away.
import { useEffect, useState } from "react";
import type { CatMood } from "@/lib/cat";
import { prefersReducedMotion } from "@/lib/motion";
import { ReactiveCat } from "../reactive-cat";

export function VerdictCat({ mood, className }: { mood: CatMood; className?: string }) {
  const [now, setNow] = useState<CatMood>("thinking");
  useEffect(() => {
    const t = window.setTimeout(() => setNow(mood), prefersReducedMotion() ? 0 : 560);
    return () => clearTimeout(t);
  }, [mood]);
  return <ReactiveCat mood={now} className={className} />;
}
