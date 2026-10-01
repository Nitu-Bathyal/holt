"""Holt's account emails: the welcome, a pass's receipt, and the three
"ending" ones (the free days of alerts about to end, ended, and a pass about
to end). Each renders to a subject, a preheader, an HTML part and a
plain-text part.

Built from the template every Holt email shares (email_kit.py): a heading, a
line or two, one solid button, and at most a row of quiet links. The receipt
puts what was bought in an item card, and its footer has no "Stop these
emails": it always goes out.

Pure: account_mail.py decides who gets which and fills in the names and dates.
"""

from __future__ import annotations

from dataclasses import dataclass

from holt_server import email_kit as kit
from holt_server.email_kit import Link, RenderedEmail


@dataclass(frozen=True)
class Frame:
    # The address it goes to.
    to: str
    home_url: str
    # None on the receipt.
    unsubscribe_url: str | None = None


def _email(subject: str, preheader: str, heading: str, tone: str, paras: list[str],
           button: Link, links: list[Link], f: Frame,
           facts: list[tuple[str, str]] | None = None) -> RenderedEmail:
    rows = [kit.heading(heading)]
    if facts:
        rows.append(kit.item(kit.facts(facts), tone, top=24))
    rows += [kit.para(p, 16 if i or facts else 14) for i, p in enumerate(paras)]
    rows.append(kit.button_row(button[1], button[0]))
    if links:
        rows.append(kit.links_row(links))
    footer = [kit.sent_to(f.to)]
    if f.unsubscribe_url:
        footer.insert(0, kit.footer_line(
            kit.footer_link(f.unsubscribe_url, "Stop these emails")))
    html = kit.shell(subject, preheader, f.home_url, tone, rows, footer)
    text = [heading, ""]
    if facts:
        text += [f"{label}: {value}" for label, value in facts] + [""]
    text += [*paras, ""]
    text += [f"{label[0].upper()}{label[1:].removesuffix(' →')}: {href}"
             for label, href in [button, *links]]
    if f.unsubscribe_url:
        text += ["", "--", f"Stop these emails: {f.unsubscribe_url}"]
    return RenderedEmail(subject, preheader, html, "\n".join(text))


def welcome_email(f: Frame, check_url: str, find_url: str,
                  alerts_url: str | None) -> RenderedEmail:
    """Once per account, at its first sign-in. `alerts_url` is None while PR
    watch is switched off on this server."""
    links = [("Find a project", find_url)]
    if alerts_url:
        links.append(("Turn on PR alerts", alerts_url))
    return _email(
        "Welcome to Holt", "Check a repo before you put a weekend into it.",
        "Welcome to Holt", "late",
        ["Holt reads a repository's recent pull requests and tells you if it's worth your "
         "time: whether outsiders get replies, and whether their work gets merged."],
        ("check a repo →", check_url), links, f)


def receipt_email(f: Frame, *, pass_name: str, amount: str, paid_on: str, until: str | None,
                  included: str, payment: str, open_url: str,
                  refunds_url: str) -> RenderedEmail:
    """A paid pass. `until` is None for someone whose Pro has no end."""
    heading = f"Pro until {until}" if until else "Your Holt Pro pass"
    facts = [("Pass", pass_name), ("Paid", f"{amount} on {paid_on}")]
    if until:
        facts.append(("Pro until", until))
    facts += [("Includes", included), ("Payment", payment)]
    return _email(
        f"Holt {heading}" if until else heading, f"{pass_name} pass, {amount}. {included}.",
        heading, "good", ["It doesn't renew."], ("open Holt →", open_url),
        [("Refund policy", refunds_url)], f, facts=facts)


def trial_ending_email(f: Frame, *, day: str, days: int, prs_url: str,
                       pricing_url: str | None) -> RenderedEmail:
    """Two days before the free days of alerts end. `pricing_url` is None
    while no pass is on sale."""
    subject = f"Your PR alerts end on {day}"
    return _email(
        subject, f"The {days} free days are almost over.", subject, "turn",
        [f"The {days} free days are almost over. After that the alerts stop; your pull "
         "requests stay on Holt."],
        ("see your pull requests →", prs_url),
        [("Keep alerts with Holt Pro", pricing_url)] if pricing_url else [], f)


def trial_ended_email(f: Frame, *, day: str, days: int, prs_url: str,
                      pricing_url: str | None) -> RenderedEmail:
    """Once, when the free days of alerts have ended."""
    subject = "Your PR alerts have stopped"
    line = f"The {days} free days ended on {day}."
    return _email(
        subject, line, subject, "done", [f"{line} Your pull requests are still on Holt."],
        ("see your pull requests →", prs_url),
        [("Alerts come with Holt Pro", pricing_url)] if pricing_url else [], f)


def pass_ending_email(f: Frame, *, day: str, open_url: str,
                      pricing_url: str | None) -> RenderedEmail:
    """Three days before a pass ends. Passes don't renew."""
    subject = f"Your Holt Pro pass ends on {day}"
    line = "It doesn't renew. After that you're on the free plan."
    button = ("get another pass →", pricing_url) if pricing_url else ("open Holt →", open_url)
    return _email(subject, line, subject, "turn", [line], button, [], f)
