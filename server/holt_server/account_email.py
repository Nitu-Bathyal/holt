"""Holt's account emails: the welcome, a pass's confirmation, and the three
"ending" ones (the free days of alerts about to end, ended, and a pass about
to end). Each renders to a subject, a preheader, an HTML part and a
plain-text part.

Built from the template every Holt email shares (email_kit.py): a heading, a
line or two, an item card where there is a list, one solid button, and at
most a row of quiet links. The confirmation's payment details are small
print, and its footer has no "Stop these emails": it always goes out.

The voice is a friend who knows open source: warm, specific, never selling.
An "ending" email says what stops and what stays free.

Pure: account_mail.py decides who gets which and fills in the names and dates.
"""

from __future__ import annotations

from dataclasses import dataclass

from holt_server import email_kit as kit
from holt_server.email_kit import Link, RenderedEmail, esc

# A title, where it goes (or nowhere), and one line about it.
Point = tuple[str, str | None, str]


@dataclass(frozen=True)
class Frame:
    # The address it goes to.
    to: str
    home_url: str
    # None on the confirmation.
    unsubscribe_url: str | None = None


def _label(label: str) -> str:
    """A button's label as the text part says it: "Check a repo"."""
    return f"{label[0].upper()}{label[1:].removesuffix(' →')}"


def _email(subject: str, preheader: str, heading: str, tone: str, paras: list[str],
           button: Link, links: list[Link], f: Frame, *, points: list[Point] | None = None,
           aside: str | None = None, small: list[tuple[str, str]] | None = None) -> RenderedEmail:
    """`small` is the small print: each line as (html, text)."""
    rows = [kit.heading(heading)]
    rows += [kit.para(p, 14 if i == 0 else 16) for i, p in enumerate(paras)]
    if points:
        rows.append(kit.item(kit.points(points), tone, top=24))
    rows.append(kit.button_row(button[1], button[0]))
    if aside:
        rows.append(kit.aside(aside))
    if links:
        rows.append(kit.links_row(links))
    if small:
        rows.append(kit.small_print([html for html, _ in small], top=20 if links else 32))
    footer = [kit.sent_to(f.to)]
    if f.unsubscribe_url:
        footer.insert(0, kit.footer_line(
            kit.footer_link(f.unsubscribe_url, "Stop these emails")))
    html = kit.shell(subject, preheader, f.home_url, tone, rows, footer)
    text = [heading, ""]
    for para in paras:
        text += [para, ""]
    if points:
        for title, href, line in points:
            text += [f"{title}: {line}"] + ([href] if href else [])
        text.append("")
    text += [f"{_label(label)}: {href}" for label, href in [button, *links]]
    if aside:
        text += ["", aside]
    if small:
        text += ["", *[line for _, line in small]]
    if f.unsubscribe_url:
        text += ["", "--", f"Stop these emails: {f.unsubscribe_url}"]
    return RenderedEmail(subject, preheader, html, "\n".join(text))


def welcome_email(f: Frame, check_url: str, find_url: str,
                  alerts_url: str | None) -> RenderedEmail:
    """Once per account, at its first sign-in. `alerts_url` is None while PR
    watch is switched off on this server."""
    points: list[Point] = [
        ("Check a repo", check_url,
         "Swap github.com for githolt.com in any repo's address."),
        ("Find a project", find_url, "Repos that merge first-timers, in your language."),
    ]
    if alerts_url:
        points.append(("Turn on PR alerts", alerts_url,
                       "We'll tell you the moment a maintainer replies on your PR."))
    return _email(
        "Welcome to Holt", "Find out if a repo merges newcomers before you give it a weekend.",
        "Welcome to Holt.", "late",
        ["Holt reads a repo's recent pull requests and tells you if it's worth your time: "
         "do newcomers get replies there, and does their work get merged?",
         "A few things to try:"],
        ("check a repo →", check_url), [], f, points=points,
        aside="Go get merged. The cat's rooting for you.")


def receipt_email(f: Frame, *, pass_name: str, amount: str, paid_on: str, until: str | None,
                  merge_plans: int | None, alerts: bool, payment: str, plan_url: str,
                  alerts_url: str | None, refunds_url: str) -> RenderedEmail:
    """A paid pass. `until` is None for someone whose Pro has no end;
    `merge_plans` is how many a month Pro gives (None: not part of it),
    `alerts` whether PR alerts are; `alerts_url` is None while PR watch is
    switched off on this server."""
    points: list[Point] = []
    if merge_plans:
        points.append((f"{merge_plans} merge plans a month", None,
                       "Your first PR in a repo as numbered steps, with what gets merged "
                       "there and who reviews."))
    if alerts:
        points.append(("PR alerts", None,
                       "We'll tell you the moment a maintainer replies on your PR."))
    yours = " and ".join(title for title, _, _ in points) or "Holt Pro"
    facts = f"{amount} · {pass_name} pass · paid {paid_on} · one-time, no auto-renewal"
    kept = f"Payment ID {payment} (keep it for refunds)"
    return _email(
        "You're on Holt Pro", f"{yours}, until {until}." if until else f"{yours}.",
        "Thanks, you're on Pro.", "good",
        [f"Here's what's yours until {until}." if until else "Here's what's yours."],
        ("make a merge plan →", plan_url) if merge_plans else ("open Holt →", plan_url),
        [("Turn on PR alerts", alerts_url)] if alerts and alerts_url else [], f,
        points=points,
        small=[(esc(facts), facts), (esc(kept), kept),
               (kit.link(refunds_url, "Refund policy"), f"Refund policy: {refunds_url}")])


def trial_ending_email(f: Frame, *, day: str, days: int, prs_url: str,
                       pricing_url: str | None) -> RenderedEmail:
    """Two days before the free days of alerts end. `pricing_url` is None
    while no pass is on sale."""
    subject = f"Your free PR alerts end on {day}"
    return _email(
        subject, "Everything else on Holt stays free.", f"{subject}.", "turn",
        [f"That's the end of your {days} free days. After that, Holt stops watching your open "
         "PRs for maintainer replies.",
         "Reports, Find and your pull requests page stay free."],
        ("see your pull requests →", prs_url),
        [("Keep the alerts with Holt Pro", pricing_url)] if pricing_url else [], f)


def trial_ended_email(f: Frame, *, day: str, days: int, prs_url: str,
                      pricing_url: str | None) -> RenderedEmail:
    """Once, when the free days of alerts have ended."""
    return _email(
        "Your free PR alerts have ended", "Everything else on Holt stays free.",
        f"Your {days} days of PR alerts are up.", "done",
        [f"Holt stopped watching your open PRs for maintainer replies on {day}.",
         "Reports, Find and your pull requests page are still free."],
        ("see your pull requests →", prs_url),
        [("Get the alerts back with Holt Pro", pricing_url)] if pricing_url else [], f)


def pass_ending_email(f: Frame, *, day: str, open_url: str,
                      pricing_url: str | None) -> RenderedEmail:
    """Three days before a pass ends. Passes don't renew."""
    subject = f"Your Holt Pro pass ends on {day}"
    button = ("get another pass →", pricing_url) if pricing_url else ("open Holt →", open_url)
    return _email(
        subject, "It won't renew or charge you again.", f"Your Pro pass ends on {day}.", "turn",
        ["It was a one-time pass, so it won't renew or charge you again.",
         "Your monthly merge plans and PR alerts end with it. Reports, Find and your pull "
         "requests page stay free."],
        button, [], f)
