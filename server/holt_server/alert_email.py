"""Holt's two alert emails: "your turn" (sent right away) and the daily one
(8:00, the rest). Each renders to a subject, a preheader, an HTML part and a
plain-text part.

Built from the template every Holt email shares (email_kit.py): a heading,
then one item card per alert with the colour of its rule, its line, the pull
request and its title, a button to the pull request and a link to Holt's
report. An email about one pull request has that button solid; one about
several outlines them and ends on the one solid button, to My PRs.

It lives here, not in the web app, because the mailer runs in this process
with no request to render in, and the alert's line is already built here.
"""

from __future__ import annotations

from dataclasses import dataclass

from holt_server import email_kit as kit
from holt_server.email_kit import RenderedEmail, esc

__all__ = ["TONES", "EmailAlert", "EmailFrame", "RenderedEmail", "daily_email", "esc",
           "your_turn_email"]

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


def _alert_block(a: EmailAlert, line: str, solid: bool, top: int) -> str:
    return kit.item(f"""<p class="h-ink" style="margin:0;font-family:{kit.SANS};font-size:17px;line-height:25px;font-weight:600;color:{kit.INK};">{esc(line)}</p>
                          <p class="h-muted" style="margin:8px 0 0 0;font-family:{kit.MONO};font-size:13px;line-height:20px;color:{kit.MUTED};">{esc(a.pr)}</p>
                          <p class="h-muted" style="margin:2px 0 0 0;font-family:{kit.SANS};font-size:14px;line-height:21px;color:{kit.MUTED};">{esc(a.title)}</p>
                          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
                            <tr>
                              <td style="padding:16px 18px 0 0;">{kit.button(a.pr_url, "open the PR →", solid)}</td>
                              <td style="padding:16px 0 0 0;font-family:{kit.SANS};font-size:14px;line-height:20px;">{kit.link(a.report_url, "Holt's report")}</td>
                            </tr>
                          </table>""", a.tone, top)


def _page(subject: str, preheader: str, heading: str, sub: str | None,
          alerts: list[EmailAlert], lines: list[str], tone: str, f: EmailFrame) -> str:
    one = len(alerts) == 1
    rows = [kit.heading(heading)]
    if sub:
        rows.append(kit.sub(sub))
    rows += [_alert_block(a, line, one, 28 if i == 0 else 14)
             for i, (a, line) in enumerate(zip(alerts, lines, strict=True))]
    if one:
        rows.append(kit.links_row([("All your pull requests", f.prs_url)]))
    else:
        rows.append(kit.button_row(f.prs_url, "see all your pull requests →"))
    footer = [kit.footer_line(esc(f.status)),
              kit.footer_line(kit.footer_link(f.settings_url, "Settings")
                              + "&nbsp;&nbsp;&nbsp;&nbsp;"
                              + kit.footer_link(f.unsubscribe_url, "Stop these emails")),
              kit.sent_to(f.to)]
    return kit.shell(subject, preheader, f.home_url, tone, rows, footer)


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
    return RenderedEmail(subject, preheader,
                         _page(subject, preheader, subject, None, alerts, lines, "turn", f),
                         _text(subject, alerts, lines, f))


def daily_email(alerts: list[EmailAlert], f: EmailFrame, date: str) -> RenderedEmail:
    """The daily email: everything that wasn't sent right away. Not sent when
    there's nothing. `date` is the reader's day: "Wednesday 1 October"."""
    subject = f"{len(alerts)} update{'' if len(alerts) == 1 else 's'} on your pull requests"
    lines = [a.line for a in alerts]
    preheader = " ".join(lines)
    return RenderedEmail(subject, preheader,
                         _page(subject, preheader, "Your pull requests", date, alerts, lines,
                               "late", f),
                         _text(f"Your pull requests, {date}", alerts, lines, f))
