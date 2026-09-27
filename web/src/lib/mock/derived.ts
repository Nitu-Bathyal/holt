// MOCK_API=1 only. The real server derives these fields once, in
// server/holt_server/schema.py; the mock stands in for it with a rough copy so
// mock pages have something to render. The app itself never computes them.
import type { Odds, Report, Stats, Tone, Verdict } from "../types";

const HEADLINE: Record<Verdict, string> = {
  viable: "Worth your time",
  not_viable: "Not worth your time",
  insufficient_evidence: "Not enough evidence",
};
const TONE: Record<Verdict, Tone> = { viable: "good", not_viable: "bad", insufficient_evidence: "warn" };

export function verdictView(verdict: Verdict): { headline: string; tone: Tone } {
  return { headline: HEADLINE[verdict], tone: TONE[verdict] };
}

function odds(verdict: Verdict, s: Stats): Odds | null {
  if (verdict !== "viable" || !s.outsider_attempts) return null;
  const merged = s.outsider_merged / s.outsider_attempts;
  const silent = s.no_reply / s.outsider_attempts;
  const mergeBand = merged >= 0.12 ? 0 : merged >= 0.05 ? 1 : 2;
  const band = Math.max(mergeBand, silent <= 0.25 ? 0 : silent <= 0.5 ? 1 : 2);
  if (band === 2 && mergeBand < 2) return { level: "long", tone: "bad", text: "many outside pull requests here never get a reply, so pick your first one carefully" };
  return [
    { level: "good", tone: "good", text: "most outside pull requests get a reply, and plenty get merged" },
    { level: "fair", tone: "warn", text: "some outside pull requests land; a well-chosen starter issue helps" },
    { level: "long", tone: "bad", text: "most outside pull requests here don't land, so pick your first one carefully" },
  ][band] as Odds;
}

function line(verdict: Verdict, s: Stats, decidedBy: string[]): string {
  const merged = `${s.outsider_merged} of ${s.outsider_attempts}`;
  if (verdict === "viable") return `Outside contributors get merged here: ${merged} of their recent pull requests landed.`;
  if (verdict === "not_viable") return decidedBy.at(-1) ?? `Only ${merged} pull requests from outside contributors were merged.`;
  return "Too few outside contributors have tried recently for Holt to say either way.";
}

type Stored = Omit<Report, "headline" | "tone" | "verdict_line" | "odds" | "rule_codes">;

export function withDerived(r: Stored): Report {
  return { ...r, ...verdictView(r.verdict), rule_codes: [], verdict_line: line(r.verdict, r.stats, r.decided_by), odds: odds(r.verdict, r.stats) };
}
