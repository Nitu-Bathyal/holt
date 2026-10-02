"""Holt's two alert emails: "your turn" (sent right away) and the daily one
(8:00, the rest). Each renders to a subject, a preheader, an HTML part and a
plain-text part.

Built from the template every Holt email shares (email_kit.py): a heading,
then one item card per alert with the colour of its rule, its line, the pull
request and its title, a button to the pull request and a link to Holt's
report. An email about one pull request has that button solid; one about
several outlines them and ends on the one solid button, to Your pull requests.

They lead with the news: a "your turn" email about one pull request has what
happened as its subject ("@mkoval asked for changes on click #2811"), and its
card then shows the pull request's title.

The wording here is the emails' own, built from the alert's kind and facts:
the bell's line for the same alert is `alerts.line`. The HTML and the text
part say the same thing.

It lives here, not in the web app, because the mailer runs in this process
with no request to render in.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from holt_server import email_kit as kit
from holt_server import schema
from holt_server.email_kit import RenderedEmail, esc

__all__ = ["TONES", "EmailAlert", "EmailFrame", "RenderedEmail", "daily_email", "esc",
           "your_turn_email"]

# The colour of an alert's rule, as on My PRs: your turn and the stale bot
# (orange), past normal (blue), good news (green), closed (grey).
TONES = {"changes": "turn", "reply": "turn", "approved": "good", "late_reply": "late",
         "late_merge": "late", "stale_soon": "stale", "merged": "good", "closed": "done"}

# What the daily email's preview line calls each kind: "one waiting, one approved".
_PREVIEW = {"changes": "needing changes", "reply": "with a new reply", "approved": "approved",
            "late_reply": "waiting", "late_merge": "waiting on a merge",
            "stale_soon": "getting close to stale", "merged": "merged", "closed": "closed"}
_WORDS = ("one", "two", "three", "four", "five", "six", "seven", "eight", "nine")


@dataclass(frozen=True)
class EmailAlert:
    kind: str
    # "processing/p5.js"
    repo: str
    number: int
    # The pull request's title.
    title: str
    pr_url: str
    report_url: str
    # The names and numbers the line is built from (alerts.Found.facts).
    facts: dict[str, Any] = field(default_factory=dict)

    @property
    def pr(self) -> str:
        """"processing/p5.js #7120"."""
        return f"{self.repo} #{self.number}"

    @property
    def name(self) -> str:
        """"p5.js #7120": the repository's name without its owner."""
        return f"{self.repo.rsplit('/', 1)[-1]} #{self.number}"

    @property
    def tone(self) -> str:
        return TONES.get(self.kind, "late")

    @property
    def who(self) -> str:
        return f"@{self.facts['who']}" if self.facts.get("who") else "a reviewer"


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


def _cap(s: str) -> str:
    return s[:1].upper() + s[1:]


def _count(n: int) -> str:
    """"one" to "nine", then digits."""
    return _WORDS[n - 1] if 1 <= n <= len(_WORDS) else str(n)


def _listed(parts: list[str]) -> str:
    """"a", "a and b", "a, b, and c"."""
    if len(parts) < 3:
        return " and ".join(parts)
    return f"{', '.join(parts[:-1])}, and {parts[-1]}"


def _alert_block(a: EmailAlert, lead: str | None, solid: bool, top: int,
                 weight: int = 600) -> str:
    """`lead` is HTML (already escaped). None: the heading already said it,
    so the card leads with the pull request's title."""
    lead, second = (lead, a.title) if lead else (esc(a.title), None)
    title = (f"""
                          <p class="h-muted" style="margin:2px 0 0 0;font-family:{kit.SANS};font-size:14px;line-height:21px;color:{kit.MUTED};">{esc(second)}</p>"""
             if second else "")
    return kit.item(f"""<p class="h-ink" style="margin:0;font-family:{kit.SANS};font-size:17px;line-height:25px;font-weight:{weight};color:{kit.INK};">{lead}</p>
                          <p class="h-muted" style="margin:8px 0 0 0;font-family:{kit.MONO};font-size:13px;line-height:20px;color:{kit.MUTED};">{esc(a.pr)}</p>{title}
                          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
                            <tr>
                              <td style="padding:16px 18px 0 0;">{kit.button(a.pr_url, "open the PR →", solid)}</td>
                              <td style="padding:16px 0 0 0;font-family:{kit.SANS};font-size:14px;line-height:20px;">{kit.link(a.report_url, "Holt's report")}</td>
                            </tr>
                          </table>""", a.tone, top)


def _page(subject: str, preheader: str, heading: str, sub: str | None,
          alerts: list[EmailAlert], leads: list[str | None], tone: str, f: EmailFrame,
          weight: int = 600) -> str:
    one = len(alerts) == 1
    rows = [kit.heading(heading)]
    if sub:
        rows.append(kit.sub(sub))
    rows += [_alert_block(a, lead, one, 28 if i == 0 else 14, weight)
             for i, (a, lead) in enumerate(zip(alerts, leads, strict=True))]
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


def _text(heading: list[str], alerts: list[EmailAlert], lines: list[str | None],
          f: EmailFrame) -> str:
    """`lines` None: the heading said it, and the pull request stands apart
    from its links."""
    out = [*heading, ""] if any(lines) else [*heading]
    for a, line in zip(alerts, lines, strict=True):
        out += [line, f"{a.pr} · {a.title}"] if line else [f"{a.pr} · {a.title}", ""]
        out += [f"Open the PR: {a.pr_url}", f"Holt's report: {a.report_url}", ""]
    out += [f"All your pull requests: {f.prs_url}", "", "--", f.status,
            f"Settings: {f.settings_url}", f"Stop these emails: {f.unsubscribe_url}"]
    return "\n".join(out)


def _did(a: EmailAlert) -> str:
    return "asked for changes" if a.kind == "changes" else "replied"


def _turn_summary(alerts: list[EmailAlert]) -> tuple[str, str]:
    """The heading and the preview line of a "your turn" email about several
    pull requests: "Two maintainers replied to your pull requests." and "Two
    maintainers replied. One asked for changes, and one left a reply." """
    n = len(alerts)
    names = {a.facts.get("who") for a in alerts}
    if len(names) == 1 and None not in names:
        # One person on all of them.
        heading = f"{alerts[0].who} replied to {_count(n)} of your pull requests."
        lead = heading
    elif n == 2:
        heading, lead = "Two maintainers replied to your pull requests.", "Two maintainers replied."
    else:
        heading = f"Maintainers replied to {_count(n)} of your pull requests."
        lead = heading
    did = {"changes": "asked for changes", "reply": "left a reply"}
    kinds = list(dict.fromkeys(a.kind for a in alerts))
    if len(kinds) == 1:
        what = f"{'Both' if n == 2 else f'All {_count(n)}'} {did[kinds[0]]}."
    else:
        what = _cap(", and ".join(
            f"{_count(sum(a.kind == k for a in alerts))} {did[k]}" for k in kinds)) + "."
    return heading, f"{lead} {what}"


def your_turn_email(alerts: list[EmailAlert], f: EmailFrame) -> RenderedEmail:
    """"Your turn": a maintainer replied or asked for changes. One email for
    everything one check found. It leads with the news."""
    if len(alerts) == 1:
        a = alerts[0]
        # "@mkoval asked for changes on click #2811"
        subject = _cap(f"{a.who} {_did(a)} on {a.name}")
        preheader = f"Your turn. {a.title}"
        heading = _cap(f"{a.who} {_did(a)} on your PR.")
        sub = "Looks like it's your turn:"
        return RenderedEmail(subject, preheader,
                             _page(subject, preheader, heading, sub, alerts, [None], "turn", f),
                             _text([heading, "", sub], alerts, [None], f))
    subject = f"{len(alerts)} of your PRs need a look"
    heading, preheader = _turn_summary(alerts)
    if len(alerts) == 2:
        lines = [f"First up, {alerts[0].who} {_did(alerts[0])}:",
                 f"And {alerts[1].who} {_did(alerts[1])} here:"]
    else:
        lines = [_cap(f"{a.who} {_did(a)}:") for a in alerts]
    return RenderedEmail(subject, preheader,
                         _page(subject, preheader, heading, None, alerts,
                               [esc(line) for line in lines], "turn", f),
                         _text([heading], alerts, lines, f))


def _daily_line(a: EmailAlert) -> tuple[str, str]:
    """One pull request's line in the daily email, as the short name it leads
    with and the rest: ("p5.js #7120", " is on day 6 with no reply yet. Most
    PRs here get one within 4 days.")."""
    f = a.facts
    wait = schema.wait_phrase(float(f.get("slow_hours") or 0))
    if a.kind in ("changes", "reply"):
        rest = f" is waiting on you. {_cap(a.who)} {_did(a)}."
    elif a.kind == "approved":
        rest = f" was approved by {a.who}." if f.get("who") else " was approved."
    elif a.kind == "late_reply":
        rest = f" is on day {f.get('days')} with no reply yet. Most PRs here get one within {wait}."
    elif a.kind == "late_merge":
        rest = f" is on day {f.get('days')}. Most merged PRs here land within {wait}."
    elif a.kind == "stale_soon":
        quiet = f.get("quiet")
        rest = (f" has been quiet for {quiet} day{'' if quiet == 1 else 's'}. "
                f"The bot closes PRs here after {f.get('close')}.")
    elif a.kind == "merged":
        rest = " was merged."
    elif a.kind == "closed":
        rest = " was closed without merging."
    else:
        rest = " has an update."
    return a.name, rest


def _daily_preview(alerts: list[EmailAlert]) -> str:
    """"4 updates: one waiting, one getting close to stale, one approved,
    and one closed." Each kind once, in the order the email has them."""
    labels = [_PREVIEW.get(a.kind, "changed") for a in alerts]
    parts = [f"{_count(labels.count(label))} {label}" for label in dict.fromkeys(labels)]
    n = len(alerts)
    return f"{n} update{'' if n == 1 else 's'}: {_listed(parts)}."


def daily_email(alerts: list[EmailAlert], f: EmailFrame, date: str) -> RenderedEmail:
    """The daily email: everything that wasn't sent right away. Not sent when
    there's nothing. `date` is the reader's day: "Wednesday 1 October"."""
    subject = "Here's what happened on your PRs today"
    preheader = _daily_preview(alerts)
    heading = "Here's where your pull requests stand"
    lines = [_daily_line(a) for a in alerts]
    # The short name is the line's one bold part, so the rest is regular.
    leads = [f'<strong style="font-weight:600;">{esc(name)}</strong>{esc(rest)}'
             for name, rest in lines]
    return RenderedEmail(subject, preheader,
                         _page(subject, preheader, heading, date, alerts, leads, "late", f,
                               weight=400),
                         _text([f"{heading}, {date}."], alerts,
                               [name + rest for name, rest in lines], f))
