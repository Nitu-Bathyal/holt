import type { CatMood } from "@/lib/cat";
import type { Tone } from "@/lib/types";

export const TONE: Record<Tone | "neutral", { text: string; bg: string; border: string; soft: string }> = {
  good: { text: "text-green", bg: "bg-green", border: "border-green", soft: "bg-green/10" },
  bad: { text: "text-orange", bg: "bg-orange", border: "border-orange", soft: "bg-orange/10" },
  warn: { text: "text-amber", bg: "bg-amber", border: "border-amber", soft: "bg-amber/10" },
  neutral: { text: "text-blue", bg: "bg-blue", border: "border-blue", soft: "bg-blue/10" },
};

/** The cat's face for a verdict, by the tone the server gave it: pleased at
 * Worth your time, unsure at a Long shot, sad at Not worth your time, and a
 * plain face where Holt can't say (Not enough evidence, Personal project). */
export const TONE_MOOD: Record<Tone, CatMood> = {
  good: "celebrating",
  warn: "thinking",
  bad: "heartbroken",
  neutral: "ready",
};
