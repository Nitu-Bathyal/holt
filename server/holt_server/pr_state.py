"""Where a user's open pull request stands: has the project replied, when did
anything last happen, and whose turn is it. My PRs shows it; PR watch
(Holt Pro) will alert on it.

After the contributions search, the open pull requests are read again by node
ID, 100 per query (`nodes(ids:)`): the review decision, the first and last few
comments and reviews (who, as what, when) and the last commit's time. That is
five small connections per pull request, so GitHub charges 1 point for up to
20 open pull requests and about 5 per 100: 1 point per refresh for nearly
every user.

Who counts as "the project" follows the engine's reply rule (`holt.agent.
replies`), without its sample: not the author, not automation, and someone
GitHub calls an owner, member or collaborator, or who approved or asked for
changes on this pull request (only people with a say do that; staff with a
private membership read as CONTRIBUTOR). A stranger's "+1" is activity, not a
reply.

PR watch (watch.py) reads the same query every half hour, which is why it
also asks whether the pull request is still open.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from holt.agent.replies import looks_like_automation

BATCH = 100

_PERSON = "author { __typename login } authorAssociation"
STATE = f"""
query($ids:[ID!]!) {{
  rateLimit {{ remaining resetAt }}
  nodes(ids:$ids) {{
    ... on PullRequest {{
      id reviewDecision state isDraft mergedAt closedAt
      author {{ login }}
      firstComments: comments(first:5) {{ nodes {{ {_PERSON} createdAt }} }}
      comments(last:5) {{ nodes {{ {_PERSON} createdAt }} }}
      firstReviews: reviews(first:5) {{ nodes {{ {_PERSON} state submittedAt }} }}
      reviews(last:5) {{ nodes {{ {_PERSON} state submittedAt }} }}
      commits(last:1) {{ nodes {{ commit {{ committedDate }} }} }}
    }}
  }}
}}
"""

TEAM = frozenset({"OWNER", "MEMBER", "COLLABORATOR"})
# A review that takes a side: only people with a say in the repository give one
# that counts, so its author is on the team whatever GitHub calls them.
_VERDICTS = frozenset({"APPROVED", "CHANGES_REQUESTED"})
DECISIONS = {"APPROVED": "approved", "CHANGES_REQUESTED": "changes_requested",
             "REVIEW_REQUIRED": "review_required"}


@dataclass
class PrState:
    turn: str = "unknown"  # yours | theirs | unknown
    # When the turn last changed hands: the project's last word when it's
    # yours, your last push or comment when it's theirs.
    turn_at: datetime | None = None
    first_reply_at: datetime | None = None
    last_activity_at: datetime | None = None
    review_decision: str | None = None  # approved | changes_requested | review_required
    # The team member who spoke last after the author's last move, and what
    # that was: changes (a review asking for them, still standing) | approved
    # | reply. None when the author acted last.
    reply_by: str | None = None
    reply_kind: str | None = None


def _when(value: Any) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


def _said(node: dict[str, Any]) -> Iterable[dict[str, Any]]:
    """Every comment and review, once each (the first and last few overlap)."""
    seen = set()
    for field, kind in (("firstComments", "comment"), ("comments", "comment"),
                        ("firstReviews", "review"), ("reviews", "review")):
        for item in ((node.get(field) or {}).get("nodes") or []):
            if not item:
                continue
            at = _when(item.get("createdAt") or item.get("submittedAt"))
            if at is None:  # a pending review, not submitted yet
                continue
            author = item.get("author") or {}
            who = str(author.get("login") or "")
            key = (kind, who.lower(), at, item.get("state"))
            if key in seen:
                continue
            seen.add(key)
            yield {"at": at, "who": who, "bot": author.get("__typename") == "Bot",
                   "association": item.get("authorAssociation"), "state": item.get("state")}


def derive(node: dict[str, Any], opened: datetime) -> PrState:
    """One pull request's state from its `STATE` node. Opening it is the
    author's first move, so with nothing after it, it's the project's turn."""
    author = str((node.get("author") or {}).get("login") or "").lower()
    said = [s for s in _said(node)
            if not looks_like_automation(s["who"], s["bot"]) and s["who"]]
    judges = {s["who"].lower() for s in said
              if s["state"] in _VERDICTS and s["who"].lower() != author}
    mine = [opened]
    team: list[tuple[datetime, str | None, str]] = []
    others = []
    for s in said:
        who = s["who"].lower()
        if who == author:
            mine.append(s["at"])
        elif s["association"] in TEAM or who in judges:
            team.append((s["at"], s["state"], s["who"]))
        else:
            others.append(s["at"])
    for c in ((node.get("commits") or {}).get("nodes") or []):
        if at := _when(((c or {}).get("commit") or {}).get("committedDate")):
            mine.append(at)
    last_mine = max(mine)
    after = sorted((t for t in team if t[0] > last_mine), key=lambda t: t[0])
    decision = DECISIONS.get(str(node.get("reviewDecision") or ""))
    # A reviewer approving after your last move leaves the merge to them.
    if after and after[-1][1] != "APPROVED":
        turn, turn_at = "yours", after[-1][0]
    else:
        turn, turn_at = "theirs", max([last_mine, *(t[0] for t in after)])
    reply_by, reply_kind = _last_word(after)
    return PrState(
        turn=turn, turn_at=turn_at,
        first_reply_at=min((t[0] for t in team), default=None),
        last_activity_at=max([*mine, *(t[0] for t in team), *others]),
        review_decision=decision, reply_by=reply_by, reply_kind=reply_kind)


def _last_word(after: list[tuple[datetime, str | None, str]]) -> tuple[str | None, str | None]:
    """(who, what) of the team's word since the author's last move; `after`
    is oldest first. A request for changes stands until an approval, so a
    comment after it doesn't turn it into a plain reply."""
    if not after:
        return None, None
    _, state, who = after[-1]
    if state == "APPROVED":
        return who, "approved"
    asked = [t for t in after if t[1] == "CHANGES_REQUESTED"]
    if asked:
        return asked[-1][2], "changes"
    return who, "reply"


def read(gql, ids: list[str], timeout: float) -> dict[str, dict[str, Any]]:
    """Node ID -> its `STATE` node, BATCH per query. Blocking."""
    out: dict[str, dict[str, Any]] = {}
    for i in range(0, len(ids), BATCH):
        data = gql.query(STATE, timeout=timeout, ids=ids[i:i + BATCH])
        for node in data.get("nodes") or []:
            if node and node.get("id"):
                out[node["id"]] = node
    return out
