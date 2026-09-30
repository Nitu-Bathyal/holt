// PROTOTYPE: Holt's two alert emails, "your turn" (sent right away) and the
// daily one (8:00, the rest). Each renders to a subject, a preheader, an HTML
// part and a plain-text part.
//
// For the build: this file is the template to lift. It's pure, with no imports
// and no framework, so the markup can move into the server's mailer as-is
// (ported to its templating) or be rendered here. The rules it keeps:
// - one 600px column of tables, every style inline (Gmail and Outlook drop
//   <style>), MSO conditionals for Outlook on Windows;
// - the <style> block only adds dark mode and phone padding, so a client that
//   strips it still gets the full light design;
// - no images: the wordmark is live text, so blocked images and forced dark
//   mode can't break it;
// - one button per alert; the system font stack (clients don't load web fonts
//   reliably), with the site's monospace for the wordmark;
// - every string escaped, every link absolute.

/** The colour of an alert's rule, as on My PRs: your turn and the stale bot (orange), past normal (blue), good news (green), closed (grey). */
export type EmailTone = "turn" | "late" | "stale" | "good" | "done";

export interface EmailAlert {
  /** The alert's one line: "Day 6, no reply on p5.js #7120. Most get one within 4 days here." */
  line: string;
  /** "processing/p5.js #7120" */
  pr: string;
  /** The PR's title. */
  title: string;
  prUrl: string;
  reportUrl: string;
  tone: EmailTone;
}

export interface EmailFrame {
  /** The address it goes to. */
  to: string;
  /** "Alerts until 14 Oct. Your turn right away, the rest at 8:00." */
  status: string;
  prsUrl: string;
  settingsUrl: string;
  unsubscribeUrl: string;
  homeUrl: string;
}

export interface RenderedEmail {
  subject: string;
  preheader: string;
  html: string;
  text: string;
}

// The site's tokens (web/src/app/globals.css), light and dark.
const C = {
  bg: "#f5f2ec",
  card: "#fffdf8",
  line: "#e2ddd3",
  ink: "#111723",
  muted: "#586071",
  faint: "#6b7180",
  blue: "#1f48cf",
  green: "#0b6a4d",
  onGreen: "#ffffff",
  dark: { bg: "#0d0e0e", card: "#141615", line: "#292b29", ink: "#e7e5dc", muted: "#a3a39b", blue: "#83a9ff", green: "#69c7a6", onGreen: "#0d0e0e" },
};
const RULE: Record<EmailTone, [string, string]> = {
  turn: ["#b23c0b", "#ee925d"],
  stale: ["#b23c0b", "#ee925d"],
  late: ["#1f48cf", "#83a9ff"],
  good: ["#0b6a4d", "#69c7a6"],
  done: ["#c9c4ba", "#3b3e3a"],
};
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function head(subject: string): string {
  const d = C.dark;
  const rules = (Object.keys(RULE) as EmailTone[]).map((t) => `.h-rule-${t} { border-left-color: ${RULE[t][1]} !important; }`).join("\n      ");
  return `<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>${esc(subject)}</title>
  <!--[if mso]><style>table, td, p, a, span { font-family: Arial, sans-serif !important; }</style><![endif]-->
  <style>
    :root { color-scheme: light dark; supported-color-schemes: light dark; }
    @media (max-width: 620px) {
      .h-pad { padding-left: 22px !important; padding-right: 22px !important; }
      .h-outer { padding-left: 0 !important; padding-right: 0 !important; }
    }
    @media (prefers-color-scheme: dark) {
      .h-bg { background: ${d.bg} !important; }
      .h-card { background: ${d.card} !important; border-color: ${d.line} !important; }
      .h-ink { color: ${d.ink} !important; }
      .h-muted { color: ${d.muted} !important; }
      .h-link { color: ${d.blue} !important; }
      .h-cat { color: ${d.blue} !important; }
      .h-divider { border-top-color: ${d.line} !important; }
      .h-btn { background: ${d.green} !important; }
      .h-btn a { color: ${d.onGreen} !important; }
      ${rules}
    }
    [data-ogsc] .h-ink { color: ${d.ink} !important; }
    [data-ogsc] .h-muted { color: ${d.muted} !important; }
    [data-ogsc] .h-link, [data-ogsc] .h-cat { color: ${d.blue} !important; }
    [data-ogsb] .h-bg { background: ${d.bg} !important; }
    [data-ogsb] .h-card { background: ${d.card} !important; }
  </style>
</head>`;
}

/** Shown in the inbox list after the subject, then hidden; the spacer stops the body leaking in after it. */
function preheaderHtml(text: string): string {
  const spacer = "&#847;&zwnj;&nbsp;".repeat(60);
  return `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${C.bg};opacity:0;">${esc(text)}${spacer}</div>`;
}

function button(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
                <tr>
                  <td class="h-btn" bgcolor="${C.green}" style="background:${C.green};mso-padding-alt:11px 20px;">
                    <a href="${esc(href)}" style="display:inline-block;padding:11px 20px;font-family:${SANS};font-size:15px;line-height:20px;font-weight:600;color:${C.onGreen};text-decoration:none;">${esc(label)}</a>
                  </td>
                </tr>
              </table>`;
}

function alertBlock(a: EmailAlert, line: string, last: boolean): string {
  return `<tr>
          <td class="h-pad" style="padding:0 40px ${last ? 36 : 30}px 40px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
              <tr>
                <td class="h-rule-${a.tone}" style="border-left:3px solid ${RULE[a.tone][0]};padding:2px 0 2px 18px;">
                  <p class="h-ink" style="margin:0 0 6px 0;font-family:${SANS};font-size:17px;line-height:25px;font-weight:600;color:${C.ink};">${esc(line)}</p>
                  <p class="h-muted" style="margin:0 0 18px 0;font-family:${SANS};font-size:14px;line-height:21px;color:${C.muted};">${esc(a.pr)} · ${esc(a.title)}</p>
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
                    <tr>
                      <td style="padding:0 20px 0 0;">
              ${button(a.prUrl, "open the PR →")}
                      </td>
                      <td style="font-family:${SANS};font-size:14px;line-height:20px;">
                        <a class="h-link" href="${esc(a.reportUrl)}" style="color:${C.blue};text-decoration:underline;">Holt's report</a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>`;
}

function page(subject: string, preheader: string, heading: string, sub: string | null, blocks: string, f: EmailFrame): string {
  const cat = "(=^•ω•^=)";
  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
${head(subject)}
<body class="h-bg" style="margin:0;padding:0;background:${C.bg};-webkit-text-size-adjust:100%;">
  ${preheaderHtml(preheader)}
  <table role="presentation" class="h-bg" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.bg}" style="border-collapse:collapse;background:${C.bg};">
    <tr>
      <td class="h-outer" align="center" style="padding:0 16px;">
        <!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;max-width:600px;">
          <tr>
            <td class="h-pad" style="padding:36px 40px 22px 40px;">
              <a href="${esc(f.homeUrl)}" style="text-decoration:none;font-family:${MONO};font-size:16px;line-height:20px;">
                <span class="h-cat" style="color:${C.blue};letter-spacing:-1px;">${cat}</span>&nbsp;&nbsp;<span class="h-ink" style="color:${C.ink};font-weight:700;">holt</span>
              </a>
            </td>
          </tr>
          <tr>
            <td>
              <table role="presentation" class="h-card" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.card}" style="border-collapse:separate;background:${C.card};border:1px solid ${C.line};">
                <tr>
                  <td class="h-pad" style="padding:36px 40px ${sub ? 6 : 28}px 40px;">
                    <h1 class="h-ink" style="margin:0;font-family:${SANS};font-size:24px;line-height:31px;font-weight:700;letter-spacing:-0.3px;color:${C.ink};">${esc(heading)}</h1>
                  </td>
                </tr>${sub ? `
                <tr>
                  <td class="h-pad" style="padding:0 40px 28px 40px;">
                    <p class="h-muted" style="margin:0;font-family:${SANS};font-size:15px;line-height:22px;color:${C.muted};">${esc(sub)}</p>
                  </td>
                </tr>` : ""}
                ${blocks}
                <tr>
                  <td class="h-pad" style="padding:0 40px 32px 40px;">
                    <p class="h-divider" style="margin:0;padding-top:22px;border-top:1px solid ${C.line};font-family:${SANS};font-size:15px;line-height:22px;">
                      <a class="h-link" href="${esc(f.prsUrl)}" style="color:${C.blue};text-decoration:underline;">All your pull requests</a>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td class="h-pad" style="padding:24px 40px 40px 40px;font-family:${SANS};font-size:13px;line-height:20px;">
              <p class="h-muted" style="margin:0 0 6px 0;color:${C.faint};">${esc(f.status)}</p>
              <p class="h-muted" style="margin:0 0 6px 0;color:${C.faint};">
                <a class="h-muted" href="${esc(f.settingsUrl)}" style="color:${C.faint};text-decoration:underline;">Settings</a>&nbsp;&nbsp;·&nbsp;&nbsp;<a class="h-muted" href="${esc(f.unsubscribeUrl)}" style="color:${C.faint};text-decoration:underline;">Stop these emails</a>
              </p>
              <p class="h-muted" style="margin:0;color:${C.faint};">Sent to ${esc(f.to)} by Holt, githolt.com</p>
            </td>
          </tr>
        </table>
        <!--[if mso]></td></tr></table><![endif]-->
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function textPart(heading: string, sub: string | null, alerts: EmailAlert[], line: (a: EmailAlert) => string, f: EmailFrame): string {
  return [
    heading,
    ...(sub ? [sub] : []),
    "",
    ...alerts.flatMap((a) => [line(a), `${a.pr} · ${a.title}`, `Open the PR: ${a.prUrl}`, `Holt's report: ${a.reportUrl}`, ""]),
    `All your pull requests: ${f.prsUrl}`,
    "",
    "--",
    f.status,
    `Settings: ${f.settingsUrl}`,
    `Stop these emails: ${f.unsubscribeUrl}`,
  ].join("\n");
}

/** Drops "Your turn: ", which the heading already says. */
const turnLine = (a: EmailAlert) => a.line.replace(/^Your turn: /, "");

/** "Your turn": a maintainer replied or asked for changes. One email for everything one check found. */
export function yourTurnEmail(alerts: EmailAlert[], f: EmailFrame): RenderedEmail {
  const one = alerts.length === 1;
  const subject = one ? `Your turn on ${alerts[0].pr.split("/")[1]}` : `Your turn on ${alerts.length} pull requests`;
  const preheader = alerts.map(turnLine).join(" ");
  const blocks = alerts.map((a, i) => alertBlock(a, turnLine(a), i === alerts.length - 1)).join("\n        ");
  return { subject, preheader, html: page(subject, preheader, subject, null, blocks, f), text: textPart(subject, null, alerts, turnLine, f) };
}

/** The daily email: everything that wasn't sent right away. Not sent when there's nothing. */
export function dailyEmail(alerts: EmailAlert[], f: EmailFrame, date: string): RenderedEmail {
  const subject = `${alerts.length} update${alerts.length === 1 ? "" : "s"} on your pull requests`;
  const preheader = alerts.map((a) => a.line).join(" ");
  const blocks = alerts.map((a, i) => alertBlock(a, a.line, i === alerts.length - 1)).join("\n        ");
  return { subject, preheader, html: page(subject, preheader, "Your pull requests", date, blocks, f), text: textPart(`Your pull requests, ${date}`, null, alerts, (a) => a.line, f) };
}
