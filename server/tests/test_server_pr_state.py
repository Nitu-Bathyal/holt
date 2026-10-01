"""Where an open pull request stands (pr_state.py): the project's first reply,
the last activity, and whose turn it is. No network."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from holt_server import pr_state

OPENED = datetime(2026, 9, 1, tzinfo=UTC)


def at(day: float) -> str:
    return (OPENED + timedelta(days=day)).isoformat().replace("+00:00", "Z")


def said(who, day, association="NONE", bot=False):
    return {"author": {"__typename": "Bot" if bot else "User", "login": who},
            "authorAssociation": association, "createdAt": at(day)}


def review(who, day, state="COMMENTED", association="NONE"):
    return {"author": {"__typename": "User", "login": who},
            "authorAssociation": association, "state": state, "submittedAt": at(day)}


def node(comments=(), reviews=(), pushed=None, decision=None, author="me"):
    comments, reviews = list(comments), list(reviews)
    return {"id": "PR_1", "reviewDecision": decision, "author": {"login": author},
            "firstComments": {"nodes": comments[:5]}, "comments": {"nodes": comments[-5:]},
            "firstReviews": {"nodes": reviews[:5]}, "reviews": {"nodes": reviews[-5:]},
            "commits": {"nodes": [{"commit": {"committedDate": at(pushed)}}]
                        if pushed is not None else []}}


def derive(**kw):
    return pr_state.derive(node(**kw), OPENED)


def test_nothing_after_opening_is_their_turn():
    s = derive(pushed=0)
    assert s.turn == "theirs" and s.turn_at == OPENED
    assert s.first_reply_at is None
    assert s.last_activity_at == OPENED


def test_a_maintainer_reply_after_your_push_is_your_turn():
    s = derive(pushed=0, comments=[said("lead", 1, "MEMBER")])
    assert s.turn == "yours"
    assert s.turn_at == OPENED + timedelta(days=1)
    assert s.first_reply_at == OPENED + timedelta(days=1)


def test_your_comment_last_is_their_turn():
    s = derive(comments=[said("lead", 1, "OWNER"), said("me", 2, "CONTRIBUTOR")])
    assert s.turn == "theirs"
    assert s.turn_at == OPENED + timedelta(days=2)
    assert s.first_reply_at == OPENED + timedelta(days=1)  # the reply still happened


def test_a_push_after_the_review_is_their_turn():
    s = derive(reviews=[review("lead", 1, "CHANGES_REQUESTED", "MEMBER")], pushed=3,
               decision="CHANGES_REQUESTED")
    assert s.turn == "theirs"
    assert s.review_decision == "changes_requested"


def test_changes_requested_is_your_turn():
    s = derive(pushed=0, reviews=[review("lead", 2, "CHANGES_REQUESTED", "COLLABORATOR")],
               decision="CHANGES_REQUESTED")
    assert s.turn == "yours" and s.review_decision == "changes_requested"


def test_an_approval_leaves_the_merge_with_them():
    s = derive(pushed=0, reviews=[review("lead", 2, "APPROVED", "MEMBER")], decision="APPROVED")
    assert s.turn == "theirs"
    assert s.turn_at == OPENED + timedelta(days=2)
    assert s.first_reply_at == OPENED + timedelta(days=2)
    assert s.review_decision == "approved"


def test_bots_are_neither_replies_nor_activity():
    s = derive(pushed=0, comments=[said("github-actions", 1, "NONE", bot=True),
                                   said("CLAassistant", 1, "NONE"),
                                   said("k8s-ci-robot", 2, "CONTRIBUTOR")])
    assert s.turn == "theirs"
    assert s.first_reply_at is None
    assert s.last_activity_at == OPENED


def test_a_bot_on_a_team_account_is_still_a_bot():
    s = derive(comments=[said("project-bot", 1, "MEMBER")])
    assert s.turn == "theirs" and s.first_reply_at is None


def test_your_own_comments_are_never_a_reply():
    s = derive(comments=[said("me", 1, "OWNER")])  # e.g. you were made a collaborator
    assert s.first_reply_at is None and s.turn == "theirs"


def test_a_strangers_plus_one_is_activity_not_a_reply():
    s = derive(pushed=0, comments=[said("passerby", 4, "CONTRIBUTOR")])
    assert s.turn == "theirs" and s.first_reply_at is None
    assert s.last_activity_at == OPENED + timedelta(days=4)


def test_a_reviewer_who_takes_a_side_is_team_whatever_github_calls_them():
    # Private org members read as CONTRIBUTOR; their verdicts and comments count.
    s = derive(pushed=0, reviews=[review("staff", 1, "APPROVED", "CONTRIBUTOR")],
               comments=[said("staff", 3, "CONTRIBUTOR")])
    assert s.turn == "yours" and s.first_reply_at == OPENED + timedelta(days=1)


def test_the_first_reply_is_the_earliest_of_comments_and_reviews():
    s = derive(comments=[said("lead", 5, "MEMBER")],
               reviews=[review("other", 2, "COMMENTED", "COLLABORATOR")])
    assert s.first_reply_at == OPENED + timedelta(days=2)


def test_logins_match_whatever_the_case():
    s = derive(author="Me", comments=[said("me", 3, "CONTRIBUTOR"), said("LEAD", 2, "MEMBER")])
    assert s.turn == "theirs"


def test_pending_reviews_and_overlapping_pages_are_skipped():
    n = node(pushed=0, comments=[said("lead", 1, "MEMBER")])
    n["reviews"]["nodes"].append({"author": {"login": "lead"}, "authorAssociation": "MEMBER",
                                  "state": "PENDING", "submittedAt": None})
    s = pr_state.derive(n, OPENED)
    assert s.turn == "yours" and s.first_reply_at == OPENED + timedelta(days=1)


def test_reads_in_batches_of_100():
    class Gql:
        def __init__(self):
            self.calls = []

        def query(self, q, timeout, ids):
            self.calls.append(ids)
            return {"nodes": [{"id": i} for i in ids] + [None]}

    gql = Gql()
    got = pr_state.read(gql, [f"PR_{i}" for i in range(230)], 5.0)
    assert [len(c) for c in gql.calls] == [100, 100, 30]
    assert len(got) == 230


def test_who_spoke_last_and_what_they_said():
    replied = derive(pushed=0, comments=[said("lead", 1, "MEMBER")])
    assert (replied.reply_by, replied.reply_kind) == ("lead", "reply")
    # A request for changes stands when someone comments after it.
    asked = derive(pushed=0, reviews=[review("Lead", 1, "CHANGES_REQUESTED", "MEMBER")],
                   comments=[said("other", 2, "COLLABORATOR")])
    assert (asked.turn, asked.reply_by, asked.reply_kind) == ("yours", "Lead", "changes")
    # Until an approval.
    approved = derive(pushed=0, reviews=[review("lead", 1, "CHANGES_REQUESTED", "MEMBER"),
                                         review("lead", 2, "APPROVED", "MEMBER")])
    assert (approved.turn, approved.reply_by, approved.reply_kind) == (
        "theirs", "lead", "approved")


def test_nobody_spoke_last_when_you_did():
    s = derive(comments=[said("lead", 1, "OWNER"), said("me", 2, "CONTRIBUTOR")])
    assert (s.reply_by, s.reply_kind) == (None, None)
    # An old request for changes doesn't outlive your push.
    pushed = derive(pushed=3, reviews=[review("lead", 1, "CHANGES_REQUESTED", "MEMBER")])
    assert (pushed.turn, pushed.reply_by, pushed.reply_kind) == ("theirs", None, None)
