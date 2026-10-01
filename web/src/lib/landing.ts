// How a landing-map area is written, and where it links: a folder gets a
// trailing "/", one file (the engine sends `is_file`) or the repository root
// doesn't; each links to that place on GitHub.
type Area = { path: string; is_file?: boolean };

const ROOT = "(root)";

export function areaLabel(area: Area): string {
  return area.is_file || area.path === ROOT ? area.path : `${area.path}/`;
}

const segments = (path: string) =>
  path
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");

/** The folder or file on GitHub; the repository's front page for its root. */
export function areaHref(repo: string, area: Area): string {
  const base = `https://github.com/${repo}`;
  if (area.path === ROOT || !segments(area.path)) return base;
  return `${base}/${area.is_file ? "blob" : "tree"}/HEAD/${segments(area.path)}`;
}

/** The recent changes to that folder or file, as GitHub lists them. */
export function areaHistoryHref(repo: string, area: Area): string {
  const base = `https://github.com/${repo}/commits/HEAD`;
  return area.path === ROOT || !segments(area.path) ? base : `${base}/${segments(area.path)}`;
}
