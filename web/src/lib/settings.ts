// The settings sections, each at its own address, and where old /settings#…
// links now land. Links used to be anchors on one long page; people bookmarked
// them and emails carry them, so they keep working.

export const SETTINGS = "/settings";

export const SECTIONS = [
  { id: "profile", href: "/settings/profile", label: "Profile", title: "Your profile", blurb: "Languages, time and experience. Your picks start here." },
  { id: "plan", href: "/settings/plan", label: "Plan", title: "Plan", blurb: "Your pass, merge plans left and purchases." },
  { id: "accounts", href: "/settings/accounts", label: "Accounts", title: "Connected accounts", blurb: "How you sign in, and your GitHub connection." },
  { id: "privacy", href: "/settings/privacy", label: "Privacy", title: "Privacy and data", blurb: "Statistics, what Holt keeps, and deleting it." },
  { id: "display", href: "/settings/display", label: "Display", title: "Display", blurb: "Motion on the site." },
  // Only while PR watch is switched on (sectionsFor).
  { id: "alerts", href: "/settings/alerts", label: "Alerts", title: "Alerts", blurb: "The bell and email for your pull requests." },
] as const;

export type SectionId = (typeof SECTIONS)[number]["id"];

/** The sections to list: Alerts only where PR watch is switched on (API.md, "PR watch"). */
export function sectionsFor(alerts: boolean) {
  return SECTIONS.filter((s) => alerts || s.id !== "alerts");
}

export function section(id: SectionId) {
  return SECTIONS.find((s) => s.id === id)!;
}

export const PROFILE_SETTINGS = section("profile").href;
export const PLAN_SETTINGS = section("plan").href;
export const ACCOUNT_SETTINGS = section("accounts").href;
export const PRIVACY_SETTINGS = section("privacy").href;
export const DISPLAY_SETTINGS = section("display").href;
export const ALERT_SETTINGS = section("alerts").href;

/** Connecting GitHub: the form in Accounts. /connect lands here (lib/shell.ts, RETIRED). */
export const CONNECT_GITHUB = `${ACCOUNT_SETTINGS}#github`;

export type ConnectError = "adult" | "taken" | "link" | "unavailable" | "save";

/** Back to the connect form, saying what went wrong. */
export function connectFailed(error: ConnectError): string {
  return `${ACCOUNT_SETTINGS}?connect=${error}#github`;
}

// Old anchors. An anchor that still exists inside a section (#purchases) is kept.
const BY_HASH: Record<string, { to: string; keep?: boolean }> = {
  profile: { to: PROFILE_SETTINGS },
  credits: { to: PLAN_SETTINGS },
  byok: { to: PLAN_SETTINGS },
  plan: { to: PLAN_SETTINGS },
  purchases: { to: PLAN_SETTINGS, keep: true },
  github: { to: ACCOUNT_SETTINGS },
  connect: { to: ACCOUNT_SETTINGS },
  stats: { to: PRIVACY_SETTINGS },
  privacy: { to: PRIVACY_SETTINGS },
};

// Old notices in the query string, from forms and payment flows that ended on /settings.
const BY_QUERY: [string, string][] = [
  ["profile", PROFILE_SETTINGS],
  ["github", ACCOUNT_SETTINGS],
  ["subscribed", PLAN_SETTINGS],
  ["cancelled", PLAN_SETTINGS],
];

/**
 * Where an old /settings link belongs, or null to stay on the overview.
 * `hash` and `search` are as in `location` ("#profile", "?subscribed=1"), leading
 * character optional. The query string travels along so notices still show.
 */
export function legacySettingsHref(hash: string, search: string): string | null {
  const h = hash.replace(/^#/, "").toLowerCase();
  const q = new URLSearchParams(search.replace(/^\?/, ""));
  const qs = q.size ? `?${q}` : "";
  const byHash = BY_HASH[h];
  if (byHash) return `${byHash.to}${qs}${byHash.keep ? `#${h}` : ""}`;
  const byQuery = BY_QUERY.find(([key]) => q.has(key));
  return byQuery ? `${byQuery[1]}${qs}` : null;
}
