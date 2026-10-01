// The text of a repository's contributing guide, for the report's Contributing
// tab. It is not an open relay: it only reads the guide that the stored report
// links to, and only through GitHub's contents API (lib/contributing.ts). An
// optional GITHUB_TOKEN lifts GitHub's limit of 60 unsigned requests an hour.
import { NextResponse } from "next/server";
import { getReport } from "@/lib/api";
import { contributingFileUrl, MAX_CONTRIBUTING_BYTES } from "@/lib/contributing";
import { isValidRepo } from "@/lib/repo";

export const runtime = "nodejs";

const gone = (status: number) => new NextResponse(null, { status, headers: { "cache-control": "public, max-age=300" } });

export async function GET(req: Request) {
  const repo = new URL(req.url).searchParams.get("repo") ?? "";
  const [owner, name, ...extra] = repo.split("/");
  if (extra.length || !owner || !name || !isValidRepo(owner, name)) return gone(400);

  const report = await getReport(repo);
  const link = report.ok ? report.data.about?.links?.find((l) => l.kind === "contributing")?.url : null;
  const file = link ? contributingFileUrl(link, repo) : null;
  if (!file) return gone(404);

  let text: string;
  try {
    const token = process.env.GITHUB_TOKEN;
    const res = await fetch(file, {
      headers: { Accept: "application/vnd.github.raw", "X-GitHub-Api-Version": "2022-11-28", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      signal: AbortSignal.timeout(8000),
      next: { revalidate: 3600 },
    });
    if (!res.ok) return gone(res.status === 404 ? 404 : 502);
    text = (await res.text()).slice(0, MAX_CONTRIBUTING_BYTES);
  } catch {
    return gone(502);
  }
  return new NextResponse(text, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600", "x-content-type-options": "nosniff" },
  });
}
