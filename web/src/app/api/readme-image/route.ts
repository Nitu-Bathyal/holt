// README images that live somewhere other than GitHub (a project's own CDN, a
// sponsor badge). The page's Content-Security-Policy only lets the browser load
// images from this site and GitHub, so the page asks here, and the server
// fetches the image. It is not an open relay: it only fetches an address that
// the repository's own README names (read from the stored report), and only
// what lib/safe-fetch.ts allows (public https addresses, images, 5 MB).
import { NextResponse } from "next/server";
import { getReport } from "@/lib/api";
import { readmeNamesImage } from "@/lib/readme-md";
import { isValidRepo } from "@/lib/repo";
import { fetchImage } from "@/lib/safe-fetch";

export const runtime = "nodejs";

const gone = (status: number) => new NextResponse(null, { status, headers: { "cache-control": "public, max-age=300" } });

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const repo = q.get("repo") ?? "";
  const raw = q.get("u") ?? "";
  const [owner, name, ...extra] = repo.split("/");
  if (extra.length || !owner || !name || !isValidRepo(owner, name) || raw.length > 2000) return gone(400);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return gone(400);
  }
  const report = await getReport(repo);
  const readme = report.ok ? report.data.about?.readme : null;
  if (!readme || !readmeNamesImage(readme, repo, url.toString())) return gone(404);

  const got = await fetchImage(url);
  if (!got.ok) return gone(502);
  return new NextResponse(new Uint8Array(got.body), {
    headers: {
      "content-type": got.type,
      "cache-control": "public, max-age=86400",
      "x-content-type-options": "nosniff",
      // An SVG opened on its own can't run anything or load anything.
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "content-disposition": "inline",
    },
  });
}
