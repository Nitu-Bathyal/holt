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
