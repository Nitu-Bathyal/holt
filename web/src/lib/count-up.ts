// Numbers that count into place (docs/design/EXPRESSIVE.md, patterns 4 and 11).
// A stat's text ("3 of 12", "58%", "2.5 days") splits into words and numbers;
// each number counts from zero, keeping the decimals its final value shows.

export type CountPart = { text: string } | { n: number; decimals: number; final: string };

export function countParts(text: string): CountPart[] {
  return text
    .split(/(\d+(?:\.\d+)?)/)
    .filter((s) => s !== "")
    .map((s) => (/^\d/.test(s) ? { n: Number(s), decimals: s.split(".")[1]?.length ?? 0, final: s } : { text: s }));
}

/** A number `p` (0..1) of the way to its final value, in its final format. */
export function countAt(part: { n: number; decimals: number }, p: number): string {
  const k = Math.max(0, Math.min(1, p));
  return k === 1 ? part.n.toFixed(part.decimals) : (part.n * k).toFixed(part.decimals);
}

/** Ease-out cubic: fast, then settling. */
export const settle = (k: number) => 1 - Math.pow(1 - Math.max(0, Math.min(1, k)), 3);

/**
 * Where a number new to this visitor starts counting from: what they saw last
 * time, or 0 the first time. Null when it hasn't changed, so it stays still.
 */
export function countFrom(prev: number | undefined, value: number): number | null {
  if (prev === value) return null;
  return prev ?? 0;
}

/** A whole number `p` (0..1) of the way from `from` to `to`. */
export function countBetween(from: number, to: number, p: number): number {
  return Math.round(from + (to - from) * settle(p));
}

/** The numbers a visitor has seen (localStorage), read defensively. */
export function parseSeen(raw: string | null): Record<string, number> {
  try {
    const v: unknown = raw ? JSON.parse(raw) : {};
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    return Object.fromEntries(Object.entries(v).filter(([, n]) => typeof n === "number" && Number.isFinite(n))) as Record<string, number>;
  } catch {
    return {};
  }
}
