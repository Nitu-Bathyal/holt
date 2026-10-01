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

export type Fact = { label: string; value: string; /** A date to show as "3 days ago" after `value`. */ since?: string; href?: string };

/** The project in numbers a newcomer can read: who's here, how busy, how alive (the licence, start year and branch are in the report's header). Only what GitHub gave. */
export function projectFacts(a: RepoAbout): Fact[] {
  const out: Fact[] = [];
  if (a.contributors != null) out.push({ label: a.contributors === 1 ? "person has contributed" : "people have contributed", value: compactCount(a.contributors) });
  if (a.open_pull_requests != null) {
    const ever = a.pull_requests != null && a.pull_requests >= a.open_pull_requests ? ` of ${compactCount(a.pull_requests)} ever` : "";
    out.push({ label: a.open_pull_requests === 1 ? `pull request open${ever}` : `pull requests open${ever}`, value: compactCount(a.open_pull_requests) });
  }
  if (a.pushed_at) out.push({ label: "last change", value: "", since: a.pushed_at });
  const rel = a.latest_release;
  if (rel) out.push({ label: "latest release", value: rel.tag, since: rel.published_at ?? undefined, href: rel.url });
  return out;
}

export type HelpLink = { label: string; note: string; url: string };

const HELP: Record<RepoAbout["links"][number]["kind"], { label: string; note: string }> = {
  contributing: { label: "Contributing guide", note: "how this project wants changes sent" },
  docs: { label: "Documentation", note: "how it works and how to set it up" },
  discussions: { label: "GitHub Discussions", note: "ask a question" },
  discord: { label: "Discord chat", note: "talk to the people who work on it" },
  slack: { label: "Slack chat", note: "talk to the people who work on it" },
  gitter: { label: "Gitter chat", note: "talk to the people who work on it" },
  matrix: { label: "Matrix chat", note: "talk to the people who work on it" },
  zulip: { label: "Zulip chat", note: "talk to the people who work on it" },
};

/** Where to read the rules and ask for help: the guide first, then docs, then somewhere to talk, then the project's own site. */
export function helpLinks(a: RepoAbout): HelpLink[] {
  const order = ["contributing", "docs", "discussions", "discord", "slack", "gitter", "matrix", "zulip"];
  const found = [...(a.links ?? [])].sort((x, y) => order.indexOf(x.kind) - order.indexOf(y.kind)).map((l) => ({ ...HELP[l.kind], url: l.url }));
  if (a.homepage && !found.some((l) => l.url === a.homepage)) found.push({ label: siteLabel(a.homepage), note: "the project's own site", url: a.homepage });
  return found;
}

export type Flag = { kind: "archived" | "fork"; text: string; repo?: string };

export function flags(a: RepoAbout): Flag[] {
  const out: Flag[] = [];
  if (a.archived) out.push({ kind: "archived", text: "Archived" });
  if (a.fork_of) out.push({ kind: "fork", text: `Fork of ${a.fork_of}`, repo: a.fork_of });
  else if (a.fork) out.push({ kind: "fork", text: "A fork" });
  return out;
}

export type Ask = Report["asks"][number];

/**
 * What the project asks before a pull request, as one plain instruction each
 * (the server's `asks`, read from a bot's comment, a pull request, CONTRIBUTING
 * or an AI policy), with where Holt read it. Advice only; it never decides.
 */
export function houseRules(asks: Ask[]): { text: string; url: string }[] {
  const said: Record<Ask["code"], (a: Ask) => string> = {
    issue_first: () => "Open an issue and agree on the change before sending a pull request.",
    ticket_first: () => "Get an accepted ticket first: a bot closes pull requests without one.",
    cla: () => "Sign the contributor licence agreement (CLA) when the bot asks.",
    dco: () => "Sign off each commit (git commit -s).",
    ai_disclosure: () => "Say whether you used AI.",
    no_ai_prs: () => "AI-written pull requests are turned down.",
    ok_to_test: () => "A maintainer has to approve before the tests run on your pull request.",
    sig_team: () => "Pull requests go to the team that owns that part of the code.",
    duplicates: () => "Check nobody has already sent the same fix: duplicates are closed.",
    stale_bot: (a) => (a.days ? `A bot closes pull requests that go quiet for ${a.days} days.` : "A bot closes pull requests that go quiet."),
  };
  const seen = new Set<string>();
  return asks.filter((a) => a.code in said && !seen.has(a.code) && seen.add(a.code)).map((a) => ({ text: said[a.code](a), url: a.url }));
}
