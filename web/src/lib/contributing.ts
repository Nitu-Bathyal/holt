// The contributing guide, shown beside the README on a report. The report only
// carries the guide's GitHub address (`about.links`, kind "contributing"), so
// the page asks /api/contributing for the text, which reads it through GitHub's
// contents API (raw.githubusercontent.com is blocked on some networks). Pure,
// so it can be tested without a network.

/** Longest guide shown; a longer one is cut here (the full file is a click away). */
export const MAX_CONTRIBUTING_BYTES = 200_000;

/**
 * GitHub's contents-API address for a contributing guide GitHub linked, or
 * null when the link isn't a Markdown or text file in this repository (a guide
 * on the project's own site, or in another format, can't be shown here, so the
 * tab isn't offered).
 * "https://github.com/o/r/blob/main/.github/CONTRIBUTING.md" ->
 * "https://api.github.com/repos/o/r/contents/.github/CONTRIBUTING.md?ref=main".
 */
export function contributingFileUrl(link: string, repo: string): string | null {
  let u: URL;
  try {
    u = new URL(link);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.hostname !== "github.com") return null;
  const [owner, name, blob, ref, ...path] = u.pathname.split("/").filter(Boolean);
  if (`${owner}/${name}`.toLowerCase() !== repo.toLowerCase() || blob !== "blob" || !ref || !path.length) return null;
  const file = path[path.length - 1];
  if (!/\.(md|markdown|txt)$/i.test(file) && !/^contributing$/i.test(file)) return null;
  return `https://api.github.com/repos/${owner}/${name}/contents/${path.join("/")}?ref=${encodeURIComponent(ref)}`;
}
