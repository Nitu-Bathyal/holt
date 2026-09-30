// PROTOTYPE, don't merge. Made-up data for /lab/pr-watch: one student's open
// and finished PRs, the alerts Holt would have made for them, and the email
// that carries them. The repos are real; the PRs, titles and reviewer logins
// are invented.
import { dailyEmail, yourTurnEmail, type EmailAlert, type EmailFrame, type EmailTone, type RenderedEmail } from "@/components/alerts/email/templates";
import { alertLine, type AlertItem, type Access } from "@/components/alerts/types";

export const UNTIL = "14 Oct";
export const EMAIL = "you@example.com";
export const TZ = "Asia/Kolkata";

/** The lab's switch: which of the four access states every part shows. */
export const STATES: { id: Access; label: string }[] = [
  { id: "on", label: "alerts on" },
  { id: "empty", label: "on, nothing yet" },
  { id: "off", label: "not turned on" },
  { id: "ended", label: "ended" },
];

export function isAccess(v: string | undefined): v is Access {
  return STATES.some((s) => s.id === v);
}

export const ALERTS: AlertItem[] = [
  { id: 7, kind: "changes", repo: "pallets/click", number: 2811, facts: { who: "mkoval" }, hoursAgo: 2, read: false },
  { id: 6, kind: "late_reply", repo: "processing/p5.js", number: 7120, facts: { days: 6, slow: 4 }, hoursAgo: 5, read: false },
  { id: 5, kind: "approved", repo: "dotnet/efcore", number: 3310, facts: { who: "jrios" }, hoursAgo: 9, read: false },
  { id: 4, kind: "stale_soon", repo: "EbookFoundation/free-programming-books", number: 11020, facts: { quiet: 25, close: 30 }, hoursAgo: 20, read: false },
  { id: 3, kind: "late_merge", repo: "dotnet/efcore", number: 3310, facts: { days: 20, slow: "2 weeks" }, hoursAgo: 50, read: true },
  { id: 2, kind: "merged", repo: "kubernetes/kubernetes", number: 128811, facts: {}, hoursAgo: 74, read: true },
  { id: 1, kind: "closed", repo: "moment/moment", number: 6120, facts: {}, hoursAgo: 150, read: true },
];

/** The open PRs on My PRs, grouped as engine 6b groups them, with the free "normal here" line. */
export interface MockPr {
  repo: string;
  number: number;
  title: string;
  group: "turn" | "waiting" | "merged" | "closed";
  /** Engine 6b's free line. */
  line: string;
  /** The wait bar: days waited against the repo's slow mark, when there is one. */
  bar?: { days: number; mark: number; late: boolean };
  muted?: boolean;
  /** Has an unread alert. */
  fresh?: boolean;
}

export const PRS: MockPr[] = [
  { repo: "pallets/click", number: 2811, title: "Fix shell completion for nested groups", group: "turn", line: "Your turn: @mkoval asked for changes 2 hours ago.", fresh: true },
  { repo: "processing/p5.js", number: 7120, title: "Add describe() to the textToPoints reference", group: "waiting", line: "Day 6, no reply yet. Most get one within 4 days here.", bar: { days: 6, mark: 4, late: true }, fresh: true },
  { repo: "EbookFoundation/free-programming-books", number: 11020, title: "Add Rust books in Hindi", group: "waiting", line: "Quiet for 25 days. The bot here closes at 30.", bar: { days: 25, mark: 30, late: true }, fresh: true },
  { repo: "dotnet/efcore", number: 3310, title: "Translate DateOnly.DayNumber on SQLite", group: "waiting", line: "Day 20. Most merged ones land within 2 weeks here.", bar: { days: 20, mark: 14, late: true }, fresh: true },
  { repo: "django/django", number: 18342, title: "Fix a typo in the bulk_create() docs", group: "waiting", line: "Day 1. Most get a first reply within 2 days here.", bar: { days: 1, mark: 2, late: false }, muted: true },
  { repo: "kubernetes/kubernetes", number: 128811, title: "kubectl: trim trailing spaces in describe output", group: "merged", line: "Merged 3 days ago" },
  { repo: "moment/moment", number: 6120, title: "Add an Odia locale", group: "closed", line: "Closed 6 days ago" },
];

export const WATCHING = PRS.filter((p) => (p.group === "turn" || p.group === "waiting") && !p.muted).length;

// --- the two emails ----------------------------------------------------------------------

/** "Your turn" goes out right away (within about 15 minutes of Holt noticing); the rest waits for 8:00. */
export type EmailKind = "now" | "daily";
const NOW_KINDS: AlertItem["kind"][] = ["changes", "reply"];

const TONE: Record<AlertItem["kind"], EmailTone> = {
  changes: "turn",
  reply: "turn",
  approved: "good",
  late_reply: "late",
  late_merge: "late",
  stale_soon: "stale",
  stale_marked: "stale",
  merged: "good",
  closed: "done",
};

const FRAME: EmailFrame = {
  to: EMAIL,
  status: `Alerts until ${UNTIL}. Your turn right away, the rest at 8:00.`,
  prsUrl: "https://githolt.com/me/contributions",
  settingsUrl: "https://githolt.com/settings/alerts",
  unsubscribeUrl: "https://githolt.com/alerts/unsubscribe?t=example",
  homeUrl: "https://githolt.com",
};

function toEmail(a: AlertItem): EmailAlert {
  return {
    line: alertLine(a),
    pr: `${a.repo} #${a.number}`,
    title: PRS.find((p) => p.repo === a.repo && p.number === a.number)?.title ?? "",
    prUrl: `https://github.com/${a.repo}/pull/${a.number}`,
    reportUrl: `https://githolt.com/${a.repo}`,
    tone: TONE[a.kind],
  };
}

/** Each email as it would go out today, from the unread alerts. */
export function mockEmail(kind: EmailKind): RenderedEmail {
  const items = ALERTS.filter((a) => !a.read && NOW_KINDS.includes(a.kind) === (kind === "now")).map(toEmail);
  return kind === "now" ? yourTurnEmail(items, FRAME) : dailyEmail(items, FRAME, "Wednesday 1 October");
}
