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
  opening pull requests that never carry the label.

Automation is never on the team. Captures made before the association was
recorded give this nothing to go on, and the callers keep their old rules for
them.
"""

from __future__ import annotations

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
