// The one "is there a report?" checker per server process, for the proxy
// (lib/report-known.ts). It asks the API server for the free report and reads
// only the status; the server answers from its own kept copy.
import { isValidRepo } from "./repo";
import { reportKnownChecker } from "./report-known";

const BASE = (process.env.HOLT_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");

async function probe(repo: string): Promise<boolean> {
  const [owner, name, ...rest] = repo.split("/");
  if (rest.length || !owner || !name || !isValidRepo(owner, name)) return false;
  if (process.env.MOCK_API === "1") {
    const mock = await import("./mock/server");
    return (await mock.getReport(repo, "rules", 7)).ok;
  }
  const res = await fetch(`${BASE}/v1/reports/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, {
    headers: { "X-Holt-Internal-Key": process.env.HOLT_INTERNAL_KEY || "", Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(1500),
  });
  await res.body?.cancel();
  return res.ok;
}

export const reportKnown = reportKnownChecker({ probe });
