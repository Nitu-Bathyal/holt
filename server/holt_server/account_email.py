"""Holt's account emails: the welcome, a pass's confirmation, and the three
"ending" ones (the free days of alerts about to end, ended, and a pass about
to end). Each renders to a subject, a preheader, an HTML part and a
plain-text part.

Built from the template every Holt email shares (email_kit.py): a heading, a
line or two, an item card where there is a list, one solid button, and at
most a row of quiet links or one quiet sentence. The confirmation's payment
details are small print, and its footer has no "Stop these emails": it always
goes out.

Each email gives its HTML rows and its text part side by side: they say the
same thing.

The voice is a friend who knows open source: warm, specific, never selling.
An "ending" email says what stops and what stays free.

Pure: account_mail.py decides who gets which and fills in the names and dates.
"""

from __future__ import annotations

from dataclasses import dataclass

from holt_server import email_kit as kit
from holt_server.email_kit import Link, RenderedEmail, esc

# A title, where it goes (or nowhere), and one line about it (or "").
Point = tuple[str, str | None, str]


@dataclass(frozen=True)
class Frame:
    # The address it goes to.
    to: str
    home_url: str
    # None on the confirmation.
    unsubscribe_url: str | None = None


def _label(link: Link) -> str:
    """A button as the text part says it: "Check a repo: https://githolt.com"."""
    label, href = link
    return f"{label[0].upper()}{label[1:].removesuffix(' →')}: {href}"


def _paras(paras: list[str]) -> list[str]:
    return [kit.para(p, 14 if i == 0 else 16) for i, p in enumerate(paras)]


def _email(subject: str, preheader: str, heading: str, tone: str, rows: list[str],
           text: list[str], f: Frame) -> RenderedEmail:
    """`rows` are the card's rows under the heading; `text` the text part's
    blocks under it, a blank line between each."""
    footer = [kit.sent_to(f.to)]
    if f.unsubscribe_url:
        footer.insert(0, kit.footer_line(
            kit.footer_link(f.unsubscribe_url, "Stop these emails")))
        text = [*text, f"--\nStop these emails: {f.unsubscribe_url}"]
    html = kit.shell(subject, preheader, f.home_url, tone, [kit.heading(heading), *rows], footer)
    return RenderedEmail(subject, preheader, html, "\n\n".join([heading, *text]))


def welcome_email(f: Frame, check_url: str, find_url: str,
                  alerts_url: str | None) -> RenderedEmail:
    """Once per account, at its first sign-in. `alerts_url` is None while PR
    watch is switched off on this server."""
    # Addresses are in backticks in the text part and plain in the HTML.
    points: list[Point] = [
        ("Check any repo", check_url, "replace `github.com` with `githolt.com` in its address."),
        ("Find projects that welcome first-time contributors, filtered by language.",
         find_url, ""),
    ]
    if alerts_url:
        points.append(("Turn on PR alerts", alerts_url,
                       "we'll let you know when a maintainer replies to one of your PRs."))
    paras = ["Found a repo you like? Before you spend a weekend on a PR, it helps to know how "
             "the repo treats newcomers.",
             "Holt checks a repo's recent PRs so you can get a better idea of what you're "
             "walking into. Whether newcomers actually get replies and whether their work "
             "gets merged.",
             "A couple of places to start:"]
    last = "Or just pick a repo and see what Holt finds."
    aside = "Go get merged. The cat's rooting for you."
    return _email(
        "Welcome to Holt", "Before you spend your weekend on a repo, see how it treats newcomers.",
        "Welcome to Holt.", "late",
        [*_paras(paras),
         kit.item(kit.points([(title, href, line.replace("`", ""))
                              for title, href, line in points]), "late", top=24),
         kit.para(last, 24), kit.button_row(check_url, "check a repo →", top=20),
         kit.aside(aside)],
        [*paras,
         *[f"{title}: {line}\n{href}" if line else f"{title}\n{href}"
           for title, href, line in points],
         last, aside], f)


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
                       "Get your first PR in a repo broken down into numbered steps, based "
                       "on what actually gets merged there and who reviews it."))
    if alerts:
        points.append(("PR alerts", None,
                       "We'll let you know when a maintainer replies to one of your PRs."))
    live = f"Your pass is live through {until}." if until else "Your pass is live."
    paras = [live, *(["Here's what you've got:"] if points else [])]
    if not points:
        preheader = f"Your Pro {live.removeprefix('Your ')}"
    elif until:
        preheader = f"Your Pro pass is live. Here's what you get through {until}."
    else:
        preheader = "Your Pro pass is live. Here's what you get."
    button = ("make a merge plan →", plan_url) if merge_plans else ("open Holt →", plan_url)
    links = [("Turn on PR alerts", alerts_url)] if alerts and alerts_url else []
    facts = f"{amount} · {pass_name} pass · paid {paid_on} · one-time, no auto-renewal"
    kept = f"Payment ID {payment} (keep it for refunds)"
    return _email(
        "You're on Holt Pro", preheader, "You're on Pro.", "good",
        [*_paras(paras),
         *([kit.item(kit.points(points), "good", top=24)] if points else []),
         kit.button_row(button[1], button[0]),
         *([kit.links_row(links)] if links else []),
         kit.small_print([esc(facts), esc(kept), kit.link(refunds_url, "Refund policy")],
                         top=20 if links else 32)],
        [*paras, *[f"{title}. {line}" for title, _, line in points],
         "\n".join(_label(link) for link in [button, *links]),
         "\n".join([facts, kept, f"Refund policy: {refunds_url}"])], f)


def _ending(subject: str, preheader: str, heading: str, tone: str, paras: list[str],
            prs_url: str, offer: tuple[str, str, str] | None, f: Frame) -> RenderedEmail:
    """An email about the free days of alerts. `offer` is its last sentence
    while a pass is on sale: what comes before the link, the link's words,
    and where it goes."""
    button = ("see your pull requests →", prs_url)
    rows = [*_paras(paras), kit.button_row(button[1], button[0])]
    text = [*paras, _label(button)]
    if offer:
        before, label, href = offer
        rows.append(kit.closing(f"{esc(before)} {kit.link(href, label)}."))
        text.append(f"{before} {label}:\n{href}")
    return _email(subject, preheader, heading, tone, rows, text, f)


def trial_ending_email(f: Frame, *, day: str, days: int, prs_url: str,
                       pricing_url: str | None) -> RenderedEmail:
    """Two days before the free days of alerts end. `pricing_url` is None
    while no pass is on sale."""
    subject = f"Your free PR alerts end on {day}"
    return _ending(
        subject, "Your alerts are ending. Your Holt account isn't.", f"{subject}.", "turn",
        [f"You've had {days} days of alerts. After that, Holt will stop watching your open PRs "
         "for maintainer replies.",
         "Everything else is still yours. Reports, Find, and your pull requests page stay free."
         if pricing_url else
         "No worries. Reports, Find, and your pull requests page are still free."],
        prs_url,
        ("If you want to keep the alerts running,", "Holt Pro has you covered", pricing_url)
        if pricing_url else None, f)


def trial_ended_email(f: Frame, *, day: str, days: int, prs_url: str,
                      pricing_url: str | None) -> RenderedEmail:
    """Once, when the free days of alerts have ended."""
    return _ending(
        "Your free PR alerts have ended",
        "Your alerts are gone, but the rest of Holt is still free.",
        f"Your {days} days of PR alerts are up.", "done",
        [f"As of {day}, Holt has stopped watching your open PRs for maintainer replies.",
         "The rest of Holt is still free: Reports, Find, and your pull requests page."
         if pricing_url else
         "The rest is still free. Reports, Find, and your pull requests page."],
        prs_url,
        ("Want the alerts back?", "Get them with Holt Pro", pricing_url) if pricing_url else None,
        f)


def pass_ending_email(f: Frame, *, day: str, open_url: str,
                      pricing_url: str | None) -> RenderedEmail:
    """Three days before a pass ends. Passes don't renew."""
    subject = f"Your Holt Pro pass ends on {day}"
    if pricing_url:
        paras = ["Nothing will renew and you won't be charged again. It was a one-time pass.",
                 "Your merge plans and PR alerts will end with the pass. Reports, Find, and "
                 "your pull requests page will keep working as usual."]
        button = ("get another pass →", pricing_url)
        # The button, as the text part says it.
        last = f"If you want another pass:\n{pricing_url}"
    else:
        paras = ["No renewal, no surprise charge. It was a one-time pass.",
                 "Your merge plans and PR alerts will end with it. Reports, Find, and your "
                 "pull requests page will keep working."]
        button = ("open Holt →", open_url)
        last = _label(button)
    return _email(
        subject, "Your pass is ending soon. No renewal, no surprise charge.",
        f"Your Pro pass ends on {day}.", "turn",
        [*_paras(paras), kit.button_row(button[1], button[0])], [*paras, last], f)
