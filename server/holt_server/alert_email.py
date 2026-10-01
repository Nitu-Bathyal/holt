"""Holt's two alert emails: "your turn" (sent right away) and the daily one
(8:00, the rest). Each renders to a subject, a preheader, an HTML part and a
plain-text part.

Ported from the web prototype's template (`alerts/email/templates.ts`); a test
keeps the markup the same as what that file renders. It lives here, not in
the web app, because the mailer runs in this process with no request to
render in, and the alert's line is already built here. The rules it keeps:

- one 600px column of tables, every style inline (Gmail and Outlook drop
  <style>), MSO conditionals for Outlook on Windows;
- the <style> block only adds dark mode and phone padding, so a client that
  strips it still gets the full light design;
- no images, no tracking pixel, no link tracking: the wordmark is live text;
- one button per alert; the system font stack, with the site's monospace for
  the wordmark;
- every string escaped (pull request titles are other people's text), every
  link absolute.
"""

from __future__ import annotations

from dataclasses import dataclass

# The colour of an alert's rule, as on My PRs: your turn and the stale bot
# (orange), past normal (blue), good news (green), closed (grey).
TONES = {"changes": "turn", "reply": "turn", "approved": "good", "late_reply": "late",
         "late_merge": "late", "stale_soon": "stale", "merged": "good", "closed": "done"}


@dataclass(frozen=True)
class EmailAlert:
    # The alert's one line: "Day 6, no reply on p5.js #7120. Most get one within 4 days here."
    line: str
    # "processing/p5.js #7120"
    pr: str
    # The pull request's title.
    title: str
    pr_url: str
    report_url: str
    tone: str


@dataclass(frozen=True)
class EmailFrame:
    # The address it goes to.
    to: str
    # "Alerts until 14 Oct. Your turn right away, the rest at 8:00."
    status: str
    prs_url: str
    settings_url: str
    unsubscribe_url: str
    home_url: str


@dataclass(frozen=True)
class RenderedEmail:
    subject: str
    preheader: str
    html: str
    text: str


# The site's tokens (web/src/app/globals.css), light and dark.
BG, CARD, LINE, INK, MUTED, FAINT = "#f5f2ec", "#fffdf8", "#e2ddd3", "#111723", "#586071", "#6b7180"
BLUE, GREEN, ON_GREEN = "#1f48cf", "#0b6a4d", "#ffffff"
DARK = {"bg": "#0d0e0e", "card": "#141615", "line": "#292b29", "ink": "#e7e5dc",
        "muted": "#a3a39b", "blue": "#83a9ff", "green": "#69c7a6", "onGreen": "#0d0e0e"}
# tone -> (light, dark)
RULE = {"turn": ("#b23c0b", "#ee925d"), "stale": ("#b23c0b", "#ee925d"),
        "late": ("#1f48cf", "#83a9ff"), "good": ("#0b6a4d", "#69c7a6"),
        "done": ("#c9c4ba", "#3b3e3a")}
SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace"
CAT = "(=^•ω•^=)"


def esc(s: str) -> str:
    return (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace('"', "&quot;"))


def _head(subject: str) -> str:
    d = DARK
    rules = "\n      ".join(
        f".h-rule-{t} {{ border-left-color: {RULE[t][1]} !important; }}" for t in RULE)
    return f"""<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>{esc(subject)}</title>
  <!--[if mso]><style>table, td, p, a, span {{ font-family: Arial, sans-serif !important; }}</style><![endif]-->
  <style>
    :root {{ color-scheme: light dark; supported-color-schemes: light dark; }}
    @media (max-width: 620px) {{
      .h-pad {{ padding-left: 22px !important; padding-right: 22px !important; }}
      .h-outer {{ padding-left: 0 !important; padding-right: 0 !important; }}
    }}
    @media (prefers-color-scheme: dark) {{
      .h-bg {{ background: {d['bg']} !important; }}
      .h-card {{ background: {d['card']} !important; border-color: {d['line']} !important; }}
      .h-ink {{ color: {d['ink']} !important; }}
      .h-muted {{ color: {d['muted']} !important; }}
      .h-link {{ color: {d['blue']} !important; }}
      .h-cat {{ color: {d['blue']} !important; }}
      .h-divider {{ border-top-color: {d['line']} !important; }}
      .h-btn {{ background: {d['green']} !important; }}
      .h-btn a {{ color: {d['onGreen']} !important; }}
      {rules}
    }}
    [data-ogsc] .h-ink {{ color: {d['ink']} !important; }}
    [data-ogsc] .h-muted {{ color: {d['muted']} !important; }}
    [data-ogsc] .h-link, [data-ogsc] .h-cat {{ color: {d['blue']} !important; }}
    [data-ogsb] .h-bg {{ background: {d['bg']} !important; }}
    [data-ogsb] .h-card {{ background: {d['card']} !important; }}
  </style>
</head>"""


def _preheader(text: str) -> str:
    """Shown in the inbox list after the subject, then hidden; the spacer
    stops the body leaking in after it."""
    spacer = "&#847;&zwnj;&nbsp;" * 60
    return (f'<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;'
            f'line-height:1px;color:{BG};opacity:0;">{esc(text)}{spacer}</div>')


def _button(href: str, label: str) -> str:
    return f"""<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
                <tr>
                  <td class="h-btn" bgcolor="{GREEN}" style="background:{GREEN};mso-padding-alt:11px 20px;">
                    <a href="{esc(href)}" style="display:inline-block;padding:11px 20px;font-family:{SANS};font-size:15px;line-height:20px;font-weight:600;color:{ON_GREEN};text-decoration:none;">{esc(label)}</a>
                  </td>
                </tr>
              </table>"""


def _alert_block(a: EmailAlert, line: str, last: bool) -> str:
    return f"""<tr>
          <td class="h-pad" style="padding:0 40px {36 if last else 30}px 40px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
              <tr>
                <td class="h-rule-{a.tone}" style="border-left:3px solid {RULE[a.tone][0]};padding:2px 0 2px 18px;">
                  <p class="h-ink" style="margin:0 0 6px 0;font-family:{SANS};font-size:17px;line-height:25px;font-weight:600;color:{INK};">{esc(line)}</p>
                  <p class="h-muted" style="margin:0 0 18px 0;font-family:{SANS};font-size:14px;line-height:21px;color:{MUTED};">{esc(a.pr)} · {esc(a.title)}</p>
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
                    <tr>
                      <td style="padding:0 20px 0 0;">
              {_button(a.pr_url, "open the PR →")}
                      </td>
                      <td style="font-family:{SANS};font-size:14px;line-height:20px;">
                        <a class="h-link" href="{esc(a.report_url)}" style="color:{BLUE};text-decoration:underline;">Holt's report</a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>"""


def _page(subject: str, preheader: str, heading: str, sub: str | None, blocks: str,
          f: EmailFrame) -> str:
    sub_row = f"""
                <tr>
                  <td class="h-pad" style="padding:0 40px 28px 40px;">
                    <p class="h-muted" style="margin:0;font-family:{SANS};font-size:15px;line-height:22px;color:{MUTED};">{esc(sub)}</p>
                  </td>
                </tr>""" if sub else ""
    return f"""<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
{_head(subject)}
<body class="h-bg" style="margin:0;padding:0;background:{BG};-webkit-text-size-adjust:100%;">
  {_preheader(preheader)}
  <table role="presentation" class="h-bg" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="{BG}" style="border-collapse:collapse;background:{BG};">
    <tr>
      <td class="h-outer" align="center" style="padding:0 16px;">
        <!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;max-width:600px;">
          <tr>
            <td class="h-pad" style="padding:36px 40px 22px 40px;">
              <a href="{esc(f.home_url)}" style="text-decoration:none;font-family:{MONO};font-size:16px;line-height:20px;">
                <span class="h-cat" style="color:{BLUE};letter-spacing:-1px;">{CAT}</span>&nbsp;&nbsp;<span class="h-ink" style="color:{INK};font-weight:700;">holt</span>
              </a>
            </td>
          </tr>
          <tr>
            <td>
              <table role="presentation" class="h-card" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="{CARD}" style="border-collapse:separate;background:{CARD};border:1px solid {LINE};">
                <tr>
                  <td class="h-pad" style="padding:36px 40px {6 if sub else 28}px 40px;">
                    <h1 class="h-ink" style="margin:0;font-family:{SANS};font-size:24px;line-height:31px;font-weight:700;letter-spacing:-0.3px;color:{INK};">{esc(heading)}</h1>
                  </td>
                </tr>{sub_row}
                {blocks}
                <tr>
                  <td class="h-pad" style="padding:0 40px 32px 40px;">
                    <p class="h-divider" style="margin:0;padding-top:22px;border-top:1px solid {LINE};font-family:{SANS};font-size:15px;line-height:22px;">
                      <a class="h-link" href="{esc(f.prs_url)}" style="color:{BLUE};text-decoration:underline;">All your pull requests</a>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td class="h-pad" style="padding:24px 40px 40px 40px;font-family:{SANS};font-size:13px;line-height:20px;">
              <p class="h-muted" style="margin:0 0 6px 0;color:{FAINT};">{esc(f.status)}</p>
              <p class="h-muted" style="margin:0 0 6px 0;color:{FAINT};">
                <a class="h-muted" href="{esc(f.settings_url)}" style="color:{FAINT};text-decoration:underline;">Settings</a>&nbsp;&nbsp;·&nbsp;&nbsp;<a class="h-muted" href="{esc(f.unsubscribe_url)}" style="color:{FAINT};text-decoration:underline;">Stop these emails</a>
              </p>
              <p class="h-muted" style="margin:0;color:{FAINT};">Sent to {esc(f.to)} by Holt, githolt.com</p>
            </td>
          </tr>
        </table>
        <!--[if mso]></td></tr></table><![endif]-->
      </td>
    </tr>
  </table>
</body>
</html>"""


def _text(heading: str, alerts: list[EmailAlert], lines: list[str], f: EmailFrame) -> str:
    out = [heading, ""]
    for a, line in zip(alerts, lines, strict=True):
        out += [line, f"{a.pr} · {a.title}", f"Open the PR: {a.pr_url}",
                f"Holt's report: {a.report_url}", ""]
    out += [f"All your pull requests: {f.prs_url}", "", "--", f.status,
            f"Settings: {f.settings_url}", f"Stop these emails: {f.unsubscribe_url}"]
    return "\n".join(out)


def _turn_line(a: EmailAlert) -> str:
    """Drops "Your turn: ", which the heading already says."""
    return a.line.removeprefix("Your turn: ")


def your_turn_email(alerts: list[EmailAlert], f: EmailFrame) -> RenderedEmail:
    """"Your turn": a maintainer replied or asked for changes. One email for
    everything one check found."""
    if len(alerts) == 1:
        subject = f"Your turn on {alerts[0].pr.split('/')[1]}"
    else:
        subject = f"Your turn on {len(alerts)} pull requests"
    lines = [_turn_line(a) for a in alerts]
    preheader = " ".join(lines)
    blocks = "\n        ".join(_alert_block(a, line, i == len(alerts) - 1)
                               for i, (a, line) in enumerate(zip(alerts, lines, strict=True)))
    return RenderedEmail(subject, preheader,
                         _page(subject, preheader, subject, None, blocks, f),
                         _text(subject, alerts, lines, f))


def daily_email(alerts: list[EmailAlert], f: EmailFrame, date: str) -> RenderedEmail:
    """The daily email: everything that wasn't sent right away. Not sent when
    there's nothing. `date` is the reader's day: "Wednesday 1 October"."""
    subject = f"{len(alerts)} update{'' if len(alerts) == 1 else 's'} on your pull requests"
    lines = [a.line for a in alerts]
    preheader = " ".join(lines)
    blocks = "\n        ".join(_alert_block(a, a.line, i == len(alerts) - 1)
                               for i, a in enumerate(alerts))
    return RenderedEmail(subject, preheader,
                         _page(subject, preheader, "Your pull requests", date, blocks, f),
                         _text(f"Your pull requests, {date}", alerts, lines, f))
