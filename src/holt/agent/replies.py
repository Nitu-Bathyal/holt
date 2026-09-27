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

A maintainer is someone GitHub says is one (OWNER, MEMBER or COLLABORATOR on
the comment), or someone the sample shows acting as one: merging a pull
request, or closing somebody else's (both need write or triage access). The
second half matters because GitHub reports a member whose organisation
membership is private as CONTRIBUTOR, so a staff reviewer on a Meta or Rust
repository can look like a stranger by association alone.

Captures made before the association was recorded (the committed fixtures and
the benchmark) keep the old rule: anyone but the author or a bot. That is
decided per comment, by whether the comment carries `author_association`.
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime
from typing import TYPE_CHECKING

from holt.types import EvidenceRecord

if TYPE_CHECKING:
    from holt.agent.signals import Thread

MAINTAINER_ASSOCIATIONS = frozenset({"OWNER", "MEMBER", "COLLABORATOR"})

# A CONTRIBUTOR (someone with work already in the repository) who replied on
# this many other people's pull requests in the sample is reviewing, not
# passing by.
REGULAR_REVIEWER_PRS = 3

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


def acting_maintainers(records: Iterable[EvidenceRecord],
                       regular_prs: int = REGULAR_REVIEWER_PRS) -> frozenset[str]:
    """People the sample shows doing a maintainer's job, whatever GitHub's
    association says: they merged a pull request, closed one somebody else
    opened, or are a CONTRIBUTOR who replied on `regular_prs` or more pull
    requests by other people. Automation is left out."""
    authors: dict[str, str] = {}
    acts: list[tuple[str, str | None, bool]] = []
    talk: list[tuple[str, dict]] = []
    for r in records:
        p = r.payload
        eid = r.evidence_id
        if eid.endswith(":opened"):
            authors[_key(eid)] = p.get("author") or ""
        elif eid.endswith(":merged"):
            acts.append((_key(eid), p.get("merged_by"), bool(p.get("merged_by_is_bot"))))
        elif eid.endswith(":closed"):
            acts.append((_key(eid), p.get("closed_by"), bool(p.get("closed_by_is_bot"))))
        elif ":review:" in eid or ":comment:" in eid:
            talk.append((_key(eid), p))
    found = {
        who for key, who, is_bot in acts
        if who and who != authors.get(key) and not looks_like_automation(who, is_bot)
    }
    reviewed: dict[str, set[str]] = {}
    for key, p in talk:
        who = p.get("author") or ""
        if (p.get("author_association") == "CONTRIBUTOR" and who != authors.get(key)
                and not looks_like_automation(who, bool(p.get("author_is_bot")))):
            reviewed.setdefault(who, set()).add(key)
    found.update(who for who, keys in reviewed.items() if len(keys) >= regular_prs)
    return frozenset(found)


def counts_as_reply(payload: dict, pr_author: str, maintainers: frozenset[str]) -> bool:
    """Whether one comment or review, on a pull request by `pr_author`, is a reply."""
    who = payload.get("author") or ""
    flagged = bool(payload.get("author_is_bot"))
    if who == pr_author:
        return False
    if "author_association" not in payload:
        return not _legacy_bot(who, flagged)
    if looks_like_automation(who, flagged):
        return False
    return payload["author_association"] in MAINTAINER_ASSOCIATIONS or who in maintainers


def attach(threads: dict[str, Thread], records: Iterable[EvidenceRecord]) -> None:
    """Fill each thread's `replies`: (when, who) for every maintainer reply."""
    records = list(records)
    maintainers = acting_maintainers(records)
    for thread in threads.values():
        thread.replies = []
    for r in records:
        if ":review:" not in r.evidence_id and ":comment:" not in r.evidence_id:
            continue
        thread = threads.get(_key(r.evidence_id))
        if thread is not None and counts_as_reply(r.payload, thread.author, maintainers):
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
