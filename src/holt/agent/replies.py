"""Who counts as replying to a pull request, and when it first got a reply.

A newcomer asking "will anyone answer me?" means someone who can get their work
in. So a reply is a comment or review by a maintainer of the repository, and
nothing else counts:

- not the pull request's own author, talking to themselves;
- not automation. GitHub marks only real GitHub Apps as bots, and plenty of
  automation posts from ordinary user accounts: CLAassistant answers every pull
  request on monicahq/monica within a minute, which made a CLA check look like
  the fastest maintainers in the golden set;
- not strangers. A "+1" or "any update?" from another user is not an answer.

Who is a maintainer is `people.maintainers()`, the same team the outsider
count uses, so a person is never a maintainer for replies and an outsider for
merges. `build_threads` works it out once, with this module's
`looks_like_automation` as the bot test.

Captures made before the association was recorded (the committed fixtures and
the benchmark) keep the old rule: anyone but the author or a bot. That is
decided per comment, by whether the comment carries `author_association`.
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime
from typing import TYPE_CHECKING

from holt.agent import people
from holt.types import EvidenceRecord

if TYPE_CHECKING:
    from holt.agent.signals import Thread

# Automation on user accounts that the generic patterns below miss, each seen
# replying in the golden set or in the audit. Matched as substrings, so they
# are all long or odd enough not to hit a person's login.
_AUTOMATION_HINTS = (
    # The same list signals.looks_like_bot uses for pull request authors.
    "dependabot", "renovate", "greenkeeper", "imgbot", "allcontributors",
    "codecov", "sonarcloud", "netlify", "vercel", "mergify", "stale",
    # CLA and licence checks.
    "claassistant", "cla-assistant", "easycla", "cla-checker", "google-cla", "meta-cla",
    # Coverage, CI, previews and benchmarks.
    "coveralls", "sonarqube", "deepsource", "gitguardian", "codspeed", "changeset-bot",
    "github-actions", "pre-commit-ci", "rust-timer", "rust-highfive", "nixpkgs-review-gha",
    "dangerbot",
)
# Automation with short logins (merge bots, Copilot), matched exactly.
_AUTOMATION_LOGINS = frozenset({"bors", "homu", "copilot"})
# CI and GitHub Actions accounts: llvm-ci, some-project-gha.
_AUTOMATION_SUFFIXES = ("[bot]", "bot", "-ci", "-gha")


def looks_like_automation(login: str | None, flagged: bool = False) -> bool:
    """True for a GitHub App, or a user account that is plainly a bot."""
    if flagged:
        return True
    low = (login or "").lower()
    if low in _AUTOMATION_LOGINS or low.endswith(_AUTOMATION_SUFFIXES) or "-bot" in low:
        return True
    return any(hint in low for hint in _AUTOMATION_HINTS)


def _legacy_bot(login: str | None, flagged: bool) -> bool:
    # Imported here: signals imports this module.
    from holt.agent.signals import looks_like_bot

    return looks_like_bot(login or "", flagged)


def _key(evidence_id: str) -> str:
    return ":".join(evidence_id.split(":")[:2])


def counts_as_reply(payload: dict, pr_author: str, staff: frozenset[str]) -> bool:
    """Whether one comment or review, on a pull request by `pr_author`, is a reply.

    `staff` is `people.maintainers()` over the same evidence.
    """
    who = payload.get("author") or ""
    flagged = bool(payload.get("author_is_bot"))
    if who == pr_author:
        return False
    if "author_association" not in payload:
        return not _legacy_bot(who, flagged)
    if looks_like_automation(who, flagged):
        return False
    return who in staff


def attach(threads: dict[str, Thread], records: Iterable[EvidenceRecord],
           staff: frozenset[str] | None = None) -> None:
    """Fill each thread's `replies`: (when, who) for every maintainer reply.

    `staff` is the team `build_threads` found; worked out here when not given.
    """
    records = list(records)
    if staff is None:
        staff = people.maintainers(records, is_automation=looks_like_automation)
    for thread in threads.values():
        thread.replies = []
    for r in records:
        if ":review:" not in r.evidence_id and ":comment:" not in r.evidence_id:
            continue
        thread = threads.get(_key(r.evidence_id))
        if thread is not None and counts_as_reply(r.payload, thread.author, staff):
            thread.replies.append((r.timestamp, r.payload.get("author") or ""))


def _reply_times(thread: Thread) -> list[datetime]:
    if thread.replies is not None:
        return [when for when, _ in thread.replies]
    # A thread built by hand, not by build_threads: every non-author response.
    return [when for when, who, _ in thread.responses if who != thread.author]


def first_reply_hours(thread: Thread) -> float | None:
    """Hours from opening until a maintainer first replied, or None if nobody did."""
    times = _reply_times(thread)
    if not times:
        return None
    return (min(times) - thread.opened_at).total_seconds() / 3600


def answered(thread: Thread) -> bool:
    return bool(_reply_times(thread))
