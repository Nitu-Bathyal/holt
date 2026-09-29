// The settings sections, each at its own address, and where old /settings#…
// links now land. Links used to be anchors on one long page; people bookmarked
// them and emails carry them, so they keep working.

export const SETTINGS = "/settings";

export const SECTIONS = [
  { id: "profile", href: "/settings/profile", label: "Profile", title: "Your profile", blurb: "Languages, time and experience. Your picks start here." },
  { id: "ai-reports", href: "/settings/ai-reports", label: "AI reports", title: "AI reports and plan", blurb: "Free reports left, the weekly claim, your plan and purchases." },
  { id: "accounts", href: "/settings/accounts", label: "Accounts", title: "Connected accounts", blurb: "How you sign in, and your GitHub connection." },
  { id: "privacy", href: "/settings/privacy", label: "Privacy", title: "Privacy and data", blurb: "Statistics, what Holt keeps, and deleting it." },
  { id: "display", href: "/settings/display", label: "Display", title: "Display", blurb: "Motion on the site." },
] as const;

export type SectionId = (typeof SECTIONS)[number]["id"];

export function section(id: SectionId) {
  return SECTIONS.find((s) => s.id === id)!;
}

export const PROFILE_SETTINGS = section("profile").href;
export const AI_SETTINGS = section("ai-reports").href;
export const ACCOUNT_SETTINGS = section("accounts").href;
export const PRIVACY_SETTINGS = section("privacy").href;
export const DISPLAY_SETTINGS = section("display").href;

// Old anchors. Anchors that still exist inside a section (#plan, #purchases) are kept.
const BY_HASH: Record<string, { to: string; keep?: boolean }> = {
  profile: { to: PROFILE_SETTINGS },
  credits: { to: AI_SETTINGS },
  byok: { to: AI_SETTINGS },
  plan: { to: AI_SETTINGS, keep: true },
  purchases: { to: AI_SETTINGS, keep: true },
  github: { to: ACCOUNT_SETTINGS },
  connect: { to: ACCOUNT_SETTINGS },
  stats: { to: PRIVACY_SETTINGS },
  privacy: { to: PRIVACY_SETTINGS },
};

// Old notices in the query string, from forms and payment flows that ended on /settings.
const BY_QUERY: [string, string][] = [
  ["profile", PROFILE_SETTINGS],
  ["github", ACCOUNT_SETTINGS],
  ["claimed", AI_SETTINGS],
  ["subscribed", AI_SETTINGS],
  ["cancelled", AI_SETTINGS],
  ["error", AI_SETTINGS],
];

/**
 * Where an old /settings link belongs, or null to stay on the overview.
 * `hash` and `search` are as in `location` ("#profile", "?claimed=1"), leading
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
