"""Who is on the project's team, as the evidence shows it.

One answer, shared: an outsider is anyone not on the team (`signals`), and a
reply only counts when someone on the team gave it. If the two disagreed, a
report could say an outsider's pull request was answered by another outsider.

GitHub's author association is the start: OWNER, MEMBER and COLLABORATOR have
write access or own the repository. It is not enough on its own, because
GitHub shows MEMBER only for *public* organisation membership: most of
PyTorch's engineers, and Google's on material-components, read CONTRIBUTOR. So
the sample also counts people it shows doing a maintainer's job:

- merging a pull request, their own included, or closing somebody else's
  (both need write or triage access; closing your own doesn't);
- formally reviewing (approving, or asking for changes on) at least
  REGULAR_REVIEWER_PRS other people's pull requests while reading CONTRIBUTOR;
- in a project that labels every outside pull request (see OUTSIDE_LABELS),
  opening pull requests that never carry the label;
- where a merge bot or a company's internal sync lands pull requests, so no
  person ever merges one on GitHub (pytorch, react-native): telling the merge
  bot to land somebody else's pull request ("@pytorchbot merge"), approving
  somebody else's pull request that then landed that way, or being named by the
  sync bot as the one who imported, exported or merged it ("@vzaidman merged
  this pull request in ...").

Automation is never on the team. Captures made before the association was
recorded give this nothing to go on, and the callers keep their old rules for
them.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Iterable

from holt.types import EvidenceRecord

MAINTAINER_ASSOCIATIONS = frozenset({"OWNER", "MEMBER", "COLLABORATOR"})

# Approving or requesting changes on this many other people's pull requests is
# reviewing, not passing by. A plain comment does not count: anyone can leave
# one, and a helpful regular is still an outsider.
REGULAR_REVIEWER_PRS = 3
FORMAL_REVIEW_STATES = frozenset({"APPROVED", "CHANGES_REQUESTED"})

# Labels some projects put on every pull request from outside the company that
# runs them: PyTorch's bot adds "open source", EF Core's triage adds
# "community-contribution". Where a project does that consistently, the pull
# requests it leaves unmarked are its own staff's. "Consistently" is at least
# OUTSIDE_LABEL_MIN pull requests and OUTSIDE_LABEL_SHARE of those from
# non-members: react-native's "Contributor" label, on 7 of 156, is not a policy.
OUTSIDE_LABELS = frozenset({
    "open source", "community-contribution", "community contribution",
    "external contribution", "external-contribution", "external contributor",
})
OUTSIDE_LABEL_MIN = 10
OUTSIDE_LABEL_SHARE = 0.5

# How a pull request that landed through a bot says so (`landing_detection.VIA`
# keys). Landing "by hand" or "as the label says" names nobody who pressed a
# button, so it doesn't count here.
BOT_LANDINGS = frozenset({"merge_bot", "internal_sync"})

# A command or approval from someone GitHub calls a first-timer, or someone
# with no history in the repository at all, is a bystander's.
_KNOWN_TO_THE_REPO = MAINTAINER_ASSOCIATIONS | {"CONTRIBUTOR"}

# A person telling a merge bot to land a pull request: "@pytorchbot merge",
# "@pytorchmergebot merge -i", "/merge", "/land". At the start of a line, so a
# sentence that mentions the command doesn't count. The mention must be a bot
# (checked in code): "@alice merge this please" asks a person.
_MERGE_COMMAND = re.compile(r"^\s*(?:@([\w\[\]-]+)\s+|/)(?:merge|land)\b", re.I | re.M)

# A sync bot naming the employee who carried a pull request across: meta-codesync
# and facebook-github-bot ("@Abbondanzo has **exported** this pull request. If
# you are a Meta employee...", "@vzaidman has **imported** this pull request",
# "@vzaidman merged this pull request in react/react-native@<sha>"), semgrep-ci
# ("@liukatkat has imported this pull request. Semgrep employees can find
# it..."). Only a bot's word counts: anyone can type the sentence.
_SYNC_NAMES = re.compile(
    r"@([\w-]+) (?:has \**(?:imported|exported)\** this pull request|"
    r"merged this pull request in )", re.I)

Automation = Callable[[str, bool], bool]


def _default_automation(login: str, flagged: bool) -> bool:
    # Imported here: signals imports this module.
    from holt.agent.signals import looks_like_bot

    return looks_like_bot(login, flagged)


def _key(evidence_id: str) -> str:
    return ":".join(evidence_id.split(":")[:2])


def maintainers(records: Iterable[EvidenceRecord],
                is_automation: Automation | None = None) -> frozenset[str]:
    """Logins the evidence shows are on the project's team (see the module).

    `is_automation(login, flagged_as_bot)` decides who is a bot; by default the
    same test `signals` applies to pull request authors.
    """
    is_bot = is_automation or _default_automation
    authors: dict[str, str] = {}
    opened: list[dict] = []
    acts: list[tuple[str, str | None, bool, bool]] = []
    reviews: list[tuple[str, dict]] = []
    team: set[str] = set()

    records = list(records)
    for r in records:
        p, eid = r.payload, r.evidence_id
        who = p.get("author") or ""
        if p.get("author_association") in MAINTAINER_ASSOCIATIONS and who:
            team.add(who)
        if eid.endswith(":opened"):
            authors[_key(eid)] = who
            opened.append(p)
        elif eid.endswith(":merged"):
            acts.append((_key(eid), p.get("merged_by"), bool(p.get("merged_by_is_bot")), True))
        elif eid.endswith(":closed"):
            acts.append((_key(eid), p.get("closed_by"), bool(p.get("closed_by_is_bot")), False))
        elif ":review:" in eid:
            reviews.append((_key(eid), p))

    # Merging needs write access, so merging your own pull request counts too
    # (astral's and llvm's committers read CONTRIBUTOR and merge their own
    # work); closing your own doesn't, anyone can.
    team.update(
        who for key, who, flagged, merge in acts
        if who and (merge or who != authors.get(key)) and not is_bot(who, flagged)
    )

    reviewed: dict[str, set[str]] = {}
    for key, p in reviews:
        who = p.get("author") or ""
        if (p.get("author_association") == "CONTRIBUTOR"
                and p.get("state") in FORMAL_REVIEW_STATES
                and who != authors.get(key)
                and not is_bot(who, bool(p.get("author_is_bot")))):
            reviewed.setdefault(who, set()).add(key)
    team.update(who for who, keys in reviewed.items() if len(keys) >= REGULAR_REVIEWER_PRS)

    team |= _unmarked_staff(opened, is_bot)
    team |= _bot_landers(records, authors, is_bot)
    return frozenset(w for w in team if not is_bot(w, False))


def _unmarked_staff(opened: list[dict], is_bot: Automation) -> set[str]:
    """Non-members never marked as outside contributors, where a project marks them.

    By author, not by pull request: one that a triager has not labelled yet
    does not make a contributor staff when their others carry the label.
    """
    candidates = [
        p for p in opened
        if "labels" in p and "author_association" in p
        and p["author_association"] not in MAINTAINER_ASSOCIATIONS
        and not is_bot(p.get("author") or "", bool(p.get("author_is_bot")))
    ]
    marked = {
        p.get("author") for p in candidates
        if any(label.lower() in OUTSIDE_LABELS for label in p["labels"] or ())
    }
    marked_prs = sum(1 for p in candidates if p.get("author") in marked)
    if marked_prs < max(OUTSIDE_LABEL_MIN, OUTSIDE_LABEL_SHARE * len(candidates)):
        return set()
    return {p.get("author") or "" for p in candidates} - marked


def _bot_landers(records: list[EvidenceRecord], authors: dict[str, str],
                 is_bot: Automation) -> set[str]:
    """People who land pull requests through a merge bot or an internal sync.

    Where a bot does the merging, the maintainer's part is the command or the
    approval that let it. Both count only on somebody else's pull request that
    then landed through the bot: pytorch's bot also takes "merge" from an
    author whose pull request a maintainer approved, and anyone can approve.
    """
    # Imported here: landing_detection imports this module. It is given no team:
    # a bot's landing is read from the bot's own records, never from who is on it.
    from holt.agent import landing_detection

    landed = {
        key for key, closure in landing_detection.classify(records, frozenset()).items()
        if closure.outcome == landing_detection.LANDED and closure.how in BOT_LANDINGS
    }
    found: set[str] = set()
    for r in records:
        eid, p = r.evidence_id, r.payload
        if not eid.startswith("pr:") or not (":comment:" in eid or ":review:" in eid):
            continue
        who = p.get("author") or ""
        body = p.get("body") or ""
        if is_bot(who, bool(p.get("author_is_bot"))):
            found.update(m.group(1) for m in _SYNC_NAMES.finditer(body))
            continue
        key = _key(eid)
        if (key not in landed or who == authors.get(key)
                or p.get("author_association") not in _KNOWN_TO_THE_REPO):
            continue
        if ":review:" in eid:
            if p.get("state") == "APPROVED":
                found.add(who)
        elif any(m.group(1) is None or is_bot(m.group(1), False)
                 for m in _MERGE_COMMAND.finditer(body)):
            found.add(who)
    return found
