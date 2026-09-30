// "About this repo" on a report: what the project is and how big and alive it
// is (the server's `about`, API.md). Pure, so it can be tested without React.
import type { Report } from "./types";

export type RepoAbout = NonNullable<Report["about"]>;

/** 91234 -> "91k", 1234 -> "1.2k", 1250000 -> "1.3M". */
export function compactCount(n: number): string {
  for (const [size, unit] of [[1e6, "M"], [1e3, "k"]] as const) {
    if (n >= size * 0.9995) {
      const v = n / size;
      const shown = v < 9.95 ? Math.floor(v * 10 + 0.5) / 10 : Math.floor(v + 0.5);
      if (shown >= 1000 && unit === "k") continue;
      return `${shown}${unit}`;
    }
  }
  return String(n);
}

export type AboutNumber = { value: string; label: string };

/** Stars, forks and open issues, the ones GitHub gave. */
export function aboutNumbers(a: RepoAbout): AboutNumber[] {
  const out: AboutNumber[] = [];
  const add = (n: number | null | undefined, one: string, many: string) => {
    if (n != null) out.push({ value: compactCount(n), label: n === 1 ? one : many });
  };
  add(a.stars, "star", "stars");
  add(a.forks, "fork", "forks");
  add(a.open_issues, "open issue", "open issues");
  return out;
}

/** 0.42 -> "42%", 0.004 -> "<1%". */
export function share(s: number): string {
  const p = Math.round(s * 100);
  return p === 0 ? "<1%" : `${p}%`;
}

/** "https://www.example.org/docs/" -> "example.org/docs". */
export function siteLabel(url: string): string {
  try {
    const u = new URL(url);
    return (u.host.replace(/^www\./, "") + u.pathname).replace(/\/+$/, "");
  } catch {
    return url;
  }
}

const plain = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** The README's line, unless it only repeats the description. */
export function readmeShown(a: RepoAbout): string | null {
  const line = a.readme_line;
  if (!line) return null;
  const d = a.description ? plain(a.description) : "";
  return d && (plain(line) === d || d.includes(plain(line))) ? null : line;
}

export type Flag = { kind: "archived" | "fork"; text: string; repo?: string };

export function flags(a: RepoAbout): Flag[] {
  const out: Flag[] = [];
  if (a.archived) out.push({ kind: "archived", text: "Archived" });
  if (a.fork_of) out.push({ kind: "fork", text: `Fork of ${a.fork_of}`, repo: a.fork_of });
  else if (a.fork) out.push({ kind: "fork", text: "A fork" });
  return out;
}
