// PROTOTYPE, don't merge. Made-up data for /lab/pr-watch: one student's open
// and finished PRs, the alerts Holt would have made for them, and the email
// that carries them. The repos are real; the PRs, titles and reviewer logins
// are invented.
import type { AlertItem, Access } from "@/components/alerts/types";

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

// --- the two emails -----------------------------------------------------------------------

/** "Your turn" goes out right away (within about 15 minutes of Holt noticing); the rest waits for 8:00. */
export type EmailKind = "now" | "daily";
const NOW_KINDS: AlertItem["kind"][] = ["changes", "reply"];

/** What each email would carry today, from the unread alerts. */
export function emailAlerts(kind: EmailKind): AlertItem[] {
  return ALERTS.filter((a) => !a.read && NOW_KINDS.includes(a.kind) === (kind === "now"));
}

const prUrl = (a: AlertItem) => `https://github.com/${a.repo}/pull/${a.number}`;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const FOOTER = `Alerts until ${UNTIL}. Your turn right away, the rest at 8:00.`;

export function emailSubject(kind: EmailKind, items: AlertItem[]): string {
  if (kind === "now") {
    return items.length === 1 ? `Your turn on ${items[0].repo.split("/")[1]} #${items[0].number}` : `Your turn on ${items.length} pull requests`;
  }
  return `${items.length} update${items.length === 1 ? "" : "s"} on your pull requests`;
}

/** The plain-text part: what most mail apps' previews and every screen reader get. */
export function emailText(items: AlertItem[], line: (a: AlertItem) => string): string {
  return [
    ...items.flatMap((a) => [line(a), prUrl(a), ""]),
    "Your pull requests: https://githolt.com/me/contributions",
    "",
    "—",
    FOOTER,
    "Change: https://githolt.com/settings/alerts",
    "Stop these emails: https://githolt.com/alerts/unsubscribe?t=…",
  ].join("\n");
}

/** The HTML part: the text part with links, in one column, no images and no tracking. */
export function emailHtml(kind: EmailKind, items: AlertItem[], line: (a: AlertItem) => string): string {
  const ink = "#111723";
  const faint = "#5f6676";
  const blue = "#1f48cf";
  const rows = items
    .map(
      (a) => `
      <tr><td style="padding:0 0 18px 0;">
        <p style="margin:0;font-size:16px;line-height:1.45;color:${ink};">${esc(line(a))}</p>
        <p style="margin:4px 0 0 0;font-size:14px;line-height:1.4;">
          <a href="${prUrl(a)}" style="color:${blue};">open the PR</a>
          <span style="color:${faint};">&nbsp;·&nbsp;</span>
          <a href="https://githolt.com/${a.repo}" style="color:${blue};">Holt's report</a>
        </p>
      </td></tr>`,
    )
    .join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(emailSubject(kind, items))}</title></head>
<body style="margin:0;padding:0;background:#ffffff;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;">
    <tr><td style="padding:28px 20px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:540px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <tr><td style="padding:0 0 22px 0;font-size:15px;font-weight:700;color:${ink};">Holt</td></tr>
        ${rows}
        <tr><td style="padding:4px 0 28px 0;font-size:15px;">
          <a href="https://githolt.com/me/contributions" style="color:${blue};">Your pull requests</a>
        </td></tr>
        <tr><td style="border-top:1px solid #e3e0d9;padding:16px 0 0 0;font-size:13px;line-height:1.5;color:${faint};">
          ${esc(FOOTER)}<br>
          <a href="https://githolt.com/settings/alerts" style="color:${faint};">Change</a>&nbsp;·&nbsp;<a href="https://githolt.com/alerts/unsubscribe" style="color:${faint};">Stop these emails</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}
