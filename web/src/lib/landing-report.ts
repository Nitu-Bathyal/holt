// The report the landing page replays and quotes: today's cached rules report
// for the example repo, so the landing and the report one click away show the
// same numbers. When the server is slow or has none, the recorded example
// (lib/example-report.ts) stands in.
import "server-only";
import { getReport } from "./api";
import { EXAMPLE_REPORT } from "./example-report";
import type { Report } from "./types";

const TTL_MS = 10 * 60_000;
let held: { report: Report; at: number } | null = null;

export async function landingReport(timeoutMs = 1500): Promise<Report> {
  if (held && Date.now() - held.at < TTL_MS) return held.report;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  const r = await Promise.race([getReport(EXAMPLE_REPORT.repo).catch(() => null), late]);
  clearTimeout(timer);
  if (!r?.ok) return held?.report ?? EXAMPLE_REPORT;
  held = { report: r.data, at: Date.now() };
  return r.data;
}
