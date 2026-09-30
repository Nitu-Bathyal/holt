"""The stale bot: how many quiet days before a bot closes a pull request.

Read from the project's own config at the commit the report read (the
provider fetches it with README and CONTRIBUTING, see
`github_graphql.STALE_CANDIDATES`):

- actions/stale in a workflow: `days-before-pr-stale` / `days-before-stale`
  (default 60) plus `days-before-pr-close` / `days-before-close` (default 7),
  and `exempt-pr-labels`;
- probot's `.github/stale.yml`: `daysUntilStale` plus `daysUntilClose`
  (60 and 7 by default), overridden by its `pulls:` section, and
  `exemptLabels`.

A bot marks a quiet pull request stale, then closes it if nothing happens, so
the quiet days before a close are the two added up. A config that never closes
pull requests (-1, `false`, `only: issues`) or only closes labelled ones is no
rule here.

Where no config is found but outside pull requests were closed later by a bot
with no reply (`rates.STALE`), a bot still closes quiet pull requests: that is
said, without a day count. Never touches the verdict.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass
from typing import TYPE_CHECKING

from holt.agent import rates

if TYPE_CHECKING:
    from holt.agent.signals import Thread
    from holt.types import EvidenceRecord

ACTIONS_DEFAULT_STALE, ACTIONS_DEFAULT_CLOSE = 60, 7
PROBOT_DEFAULT_STALE, PROBOT_DEFAULT_CLOSE = 60, 7
# Stale closes seen before "a bot closes quiet pull requests" is said with no config.
MIN_STALE_CLOSES = 2


@dataclass(frozen=True, slots=True)
class StaleRule:
    # Quiet days before a pull request is closed; None when only the closes
    # show there is a bot.
    days: int | None
    # The config file, or the newest pull request the bot closed.
    url: str
    exempt_labels: tuple[str, ...] = ()


def _value(text: str, key: str) -> str | None:
    m = re.search(rf"^[ \t-]*{re.escape(key)}[ \t]*:[ \t]*(.*?)[ \t]*(?:#.*)?$", text, re.M)
    if m is None:
        return None
    return m.group(1).strip().strip("'\"")


def _int(value: str | None) -> int | None:
    if value is None or not re.fullmatch(r"-?\d+(?:\.\d+)?", value):
        return None
    return int(float(value))


def _labels(value: str | None) -> tuple[str, ...]:
    return tuple(x.strip() for x in (value or "").split(",") if x.strip())


def parse_actions(text: str) -> StaleRule | None:
    """actions/stale's rule for pull requests, from a workflow's text."""
    at = re.search(r"uses:\s*['\"]?actions/stale@", text or "")
    if at is None:
        return None
    step = text[at.end():]
    # To the next step's `uses:`, if any: its inputs aren't this one's.
    if nxt := re.search(r"^\s*-?\s*uses:", step, re.M):
        step = step[:nxt.start()]

    def pick(pr_key: str, key: str, default: int) -> int | None:
        for k in (pr_key, key):
            if (raw := _value(step, k)) is not None:
                return _int(raw)
        return default

    days_stale = pick("days-before-pr-stale", "days-before-stale", ACTIONS_DEFAULT_STALE)
    days_close = pick("days-before-pr-close", "days-before-close", ACTIONS_DEFAULT_CLOSE)
    if days_stale is None or days_close is None or days_stale < 0 or days_close < 0:
        return None
    if _labels(_value(step, "only-pr-labels") or _value(step, "only-labels")):
        return None
    exempt = _value(step, "exempt-pr-labels") or _value(step, "exempt-labels")
    return StaleRule(days_stale + days_close, "", _labels(exempt))


def _probot_sections(text: str) -> tuple[str, str]:
    """(top-level lines, the `pulls:` section dedented)."""
    top, pulls, inside = [], [], False
    for line in (text or "").splitlines():
        if re.match(r"^pulls\s*:", line):
            inside = True
            continue
        if inside and line[:1] in (" ", "\t"):
            pulls.append(line.strip())
            continue
        inside = False
        if line[:1] not in (" ", "\t"):
            top.append(line)
    return "\n".join(top), "\n".join(pulls)


def _probot_list(text: str, key: str) -> tuple[str, ...]:
    m = re.search(rf"^{key}[ \t]*:[ \t]*(.*)$((?:\n[ \t]+-.*)*)", text, re.M)
    if m is None:
        return ()
    inline = m.group(1).strip()
    if inline.startswith("["):
        return tuple(x.strip(" '\"") for x in inline.strip("[]").split(",") if x.strip(" '\""))
    return tuple(line.strip()[1:].strip(" '\"") for line in m.group(2).splitlines() if line.strip())


def parse_probot(text: str) -> StaleRule | None:
    """probot/stale's rule for pull requests, from .github/stale.yml."""
    top, pulls = _probot_sections(text)
    if (_value(top, "only") or "").lower() == "issues":
        return None

    def pick(key: str, default: int) -> int | None:
        raw = _value(pulls, key) if _value(pulls, key) is not None else _value(top, key)
        if raw is None:
            return default
        return _int(raw)  # `false` (never) reads as None

    days_stale = pick("daysUntilStale", PROBOT_DEFAULT_STALE)
    days_close = pick("daysUntilClose", PROBOT_DEFAULT_CLOSE)
    if days_stale is None or days_close is None or days_stale < 0 or days_close < 0:
        return None
    return StaleRule(days_stale + days_close, "", _probot_list(text, "exemptLabels"))


PARSERS = {"actions": parse_actions, "probot": parse_probot}


def read(records: Iterable[EvidenceRecord], outsiders: Iterable[Thread]) -> StaleRule | None:
    """The stale bot's rule for pull requests here, or None if none was found.

    `outsiders` are the outside pull requests (signals.outsider_threads): their
    closes stand in for a config Holt couldn't read.
    """
    records = list(records)
    configs = sorted((r for r in records if r.evidence_id.startswith("repo:")
                      and ":stale:" in r.evidence_id), key=lambda r: r.evidence_id)
    for r in configs:
        parse = PARSERS.get(r.payload.get("kind") or "")
        rule = parse(r.payload.get("text") or "") if parse else None
        if rule is not None:
            return StaleRule(rule.days, r.url, rule.exempt_labels)
    stale = sorted((t for t in outsiders
                    if t.closed_unmerged and not t.merged and not t.engaged
                    and rates.closure(t) == rates.STALE),
                   key=lambda t: t.opened_at, reverse=True)
    if len(stale) < MIN_STALE_CLOSES:
        return None
    url = {r.evidence_id: r.url for r in records if r.evidence_id.endswith(":opened")}
    return StaleRule(None, url.get(f"{stale[0].key}:opened") or "")
