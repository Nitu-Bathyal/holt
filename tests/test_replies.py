"""Only maintainers' replies count as replies (ticket 04).

Each excluded kind -- the author, GitHub Apps, bots on user accounts, strangers
-- has its own test, and so does each way of being a maintainer. Captures
without `author_association` keep the old rule.
"""

from __future__ import annotations

from datetime import timedelta

import pytest

from holt.agent import replies
from holt.agent.signals import Thread, build_threads, compute
from holt.types import T_CUTOFF, EvidenceRecord

T0 = T_CUTOFF - timedelta(days=30)


def rec(eid, offset_h, author, association="NONE", **extra):
    payload = {"author": author, "author_is_bot": False, **extra}
    if association is not None:
        payload["author_association"] = association
    return EvidenceRecord(eid, "github", "https://x", T0 + timedelta(hours=offset_h), payload)


def opened(n, author="newbie", association="FIRST_TIME_CONTRIBUTOR"):
    return rec(f"pr:a/b#{n}:opened", 0, author, association)


def comment(n, i, offset_h, author, association="NONE", **extra):
    return rec(f"pr:a/b#{n}:comment:{i}", offset_h, author, association, **{"body": "hi", **extra})


def reply_hours(records, n=1):
    return build_threads(records)[f"pr:a/b#{n}"].first_response_hours


# --- who never counts ----------------------------------------------------------


def test_the_author_talking_to_themselves_is_not_a_reply():
    assert reply_hours([opened(1), comment(1, 0, 1, "newbie", "FIRST_TIME_CONTRIBUTOR")]) is None


def test_a_github_app_is_not_a_reply_even_as_a_member():
    records = [opened(1), comment(1, 0, 1, "helper", "MEMBER", author_is_bot=True)]
    assert reply_hours(records) is None


@pytest.mark.parametrize("login", [
    "CLAassistant", "cla-assistant", "coveralls", "bors", "netlify", "vercel",
    "codecov-commenter", "changeset-bot", "llvm-ci", "nixpkgs-review-gha",
    "linux-foundation-easycla", "googlebot", "some-project-bot", "renovate",
])
def test_bots_on_user_accounts_are_not_replies(login):
    records = [opened(1), comment(1, 0, 0.02, login, "NONE")]
    assert reply_hours(records) is None


def test_a_bot_with_collaborator_access_is_still_a_bot():
    """rust-timer posts benchmark results on rust-lang/rust as a COLLABORATOR."""
    assert reply_hours([opened(1), comment(1, 0, 1, "rust-timer", "COLLABORATOR")]) is None


@pytest.mark.parametrize("association", ["NONE", "FIRST_TIMER", "FIRST_TIME_CONTRIBUTOR",
                                         "MANNEQUIN"])
def test_a_strangers_plus_one_is_not_a_reply(association):
    records = [opened(1), comment(1, 0, 2, "passerby", association)]
    assert reply_hours(records) is None


def test_a_contributor_passing_by_is_not_a_reply():
    """CONTRIBUTOR only means they once landed something here."""
    records = [opened(1), comment(1, 0, 2, "alum", "CONTRIBUTOR")]
    assert reply_hours(records) is None


# --- who counts ----------------------------------------------------------------


@pytest.mark.parametrize("association", ["OWNER", "MEMBER", "COLLABORATOR"])
def test_a_maintainer_by_association_is_a_reply(association):
    assert reply_hours([opened(1), comment(1, 0, 3, "keeper", association)]) == 3.0


def test_a_review_counts_like_a_comment():
    records = [opened(1), rec("pr:a/b#1:review:0", 4, "keeper", "MEMBER", state="APPROVED")]
    assert reply_hours(records) == 4.0


def test_someone_who_merged_a_pull_request_is_a_maintainer():
    """A member whose membership is private reads as CONTRIBUTOR."""
    records = [
        opened(1), comment(1, 0, 5, "staff", "CONTRIBUTOR"),
        opened(2, "other"), rec("pr:a/b#2:merged", 9, "other", merged_by="staff"),
    ]
    assert reply_hours(records) == 5.0


def test_someone_who_closed_another_persons_pull_request_is_a_maintainer():
    records = [
        opened(1), comment(1, 0, 5, "triager", "CONTRIBUTOR"),
        opened(2, "other"), rec("pr:a/b#2:closed", 9, "other", closed_by="triager"),
    ]
    assert reply_hours(records) == 5.0


def test_closing_your_own_pull_request_makes_nobody_a_maintainer():
    records = [
        opened(1), comment(1, 0, 5, "other", "CONTRIBUTOR"),
        opened(2, "other"), rec("pr:a/b#2:closed", 9, "other", closed_by="other"),
    ]
    assert reply_hours(records) is None


def test_a_merge_bot_does_not_make_a_maintainer():
    records = [
        opened(2, "other"),
        rec("pr:a/b#2:merged", 9, "other", merged_by="pytorchmergebot", merged_by_is_bot=False),
    ]
    assert replies.maintainers(records) == frozenset()


def review(n, i, offset_h, author, state, association="CONTRIBUTOR"):
    return rec(f"pr:a/b#{n}:review:{i}", offset_h, author, association, state=state, body="")


@pytest.mark.parametrize("state", ["APPROVED", "CHANGES_REQUESTED"])
def test_a_contributor_who_formally_reviews_other_peoples_work_is_a_maintainer(state):
    """Kubernetes approvers and LLVM code owners read as CONTRIBUTOR."""
    records = []
    for n in range(1, replies.REGULAR_REVIEWER_PRS + 1):
        records += [opened(n, f"author{n}"), review(n, 0, n, "approver", state)]
    assert reply_hours(records, 1) == 1.0

    fewer = [r for r in records if not r.evidence_id.startswith("pr:a/b#1:review")]
    assert "approver" not in replies.maintainers(fewer)


def test_a_helpful_regulars_comments_do_not_make_them_a_maintainer():
    """Answering newcomers is kind, but it is not the repository responding."""
    records = []
    for n in range(1, 6):
        records += [opened(n, f"author{n}"), comment(n, 0, 1, "regular", "CONTRIBUTOR"),
                    review(n, 1, 2, "regular", "COMMENTED")]
    assert "regular" not in replies.maintainers(records)
    assert reply_hours(records) is None


def test_reviewing_your_own_pull_requests_makes_nobody_a_maintainer():
    records = []
    for n in range(1, 5):
        records += [opened(n, "alum", "CONTRIBUTOR"), review(n, 0, 1, "alum", "APPROVED")]
    assert "alum" not in replies.maintainers(records)


def test_maintainers_is_the_one_shared_set():
    """Association, merging, closing others' work and formal reviewing; never bots."""
    records = [
        opened(1, "owner", "OWNER"),
        opened(2, "newbie"), comment(2, 0, 1, "member", "MEMBER"),
        comment(2, 1, 2, "rust-timer", "COLLABORATOR"),
        opened(3, "other"), rec("pr:a/b#3:merged", 9, "other", merged_by="merger"),
        opened(4, "other2"), rec("pr:a/b#4:closed", 9, "other2", closed_by="triager"),
        opened(5, "legacy-author", None), rec("pr:a/b#5:comment:0", 1, "legacy", None),
    ]
    assert replies.maintainers(records) == {"owner", "member", "merger", "triager"}


def test_many_comments_on_one_pull_request_do_not_make_a_regular():
    records = [opened(1)] + [comment(1, i, i + 1, "alum", "CONTRIBUTOR") for i in range(5)]
    assert reply_hours(records) is None


def test_a_stranger_commenting_everywhere_is_still_a_stranger():
    """Spam and drive-by review accounts are NONE, however many PRs they hit."""
    records = []
    for n in range(1, 6):
        records += [opened(n, f"author{n}"), comment(n, 0, 1, "drive-by", "NONE")]
    assert reply_hours(records) is None


# --- what the counts become ----------------------------------------------------


def test_a_cla_bot_no_longer_makes_a_repository_look_instant():
    """monicahq/monica: CLAassistant answered within a minute, the maintainer in
    ten hours. The median first reply is the maintainer's."""
    records = []
    for n in (1, 2, 3):
        records += [
            opened(n, f"author{n}"),
            comment(n, 0, 0.01, "CLAassistant", "NONE"),
            comment(n, 1, 10, "asbiin", "OWNER"),
        ]
    assert compute(build_threads(records)).median_first_response_hours == 10.0


def test_a_pull_request_only_bots_and_strangers_answered_was_ignored():
    records = [
        opened(1),
        comment(1, 0, 0.01, "CLAassistant", "NONE"),
        comment(1, 1, 30, "passerby", "NONE", body="+1"),
    ]
    s = compute(build_threads(records))
    assert s.outsider_ignored == 1
    assert s.outsider_answered == 0
    assert s.median_first_response_hours is None


def test_reviewed_share_counts_maintainer_reviews_only():
    records = [
        opened(1), rec("pr:a/b#1:merged", 5, "newbie"),
        comment(1, 0, 1, "coveralls", "NONE"),
        opened(2, "other"), rec("pr:a/b#2:merged", 5, "other"),
        comment(2, 0, 1, "keeper", "MEMBER"),
    ]
    assert compute(build_threads(records)).reviewed_share == 0.5


def test_responses_still_hold_what_everyone_said():
    """The model reads the whole conversation; only the counting changed."""
    records = [opened(1), comment(1, 0, 2, "passerby", "NONE")]
    thread = build_threads(records)["pr:a/b#1"]
    assert [who for _, who, _ in thread.responses] == ["passerby"]
    assert thread.replies == []


# --- older captures ------------------------------------------------------------


def test_captures_without_association_keep_the_old_rule():
    """Committed fixtures predate `author_association`: any non-author human."""
    records = [
        rec("pr:a/b#1:opened", 0, "newbie", None),
        rec("pr:a/b#1:comment:0", 2, "passerby", None),
    ]
    assert reply_hours(records) == 2.0


def test_the_old_rule_still_skips_the_bots_it_always_skipped():
    records = [
        rec("pr:a/b#1:opened", 0, "newbie", None),
        rec("pr:a/b#1:comment:0", 1, "dependabot", None),
        rec("pr:a/b#1:comment:1", 3, "passerby", None),
    ]
    assert reply_hours(records) == 3.0


def test_a_thread_built_by_hand_counts_every_other_voice():
    thread = Thread(key="pr:a/b#1", number=1, author="newbie", author_is_bot=False,
                    opened_at=T0, responses=[(T0 + timedelta(hours=2), "someone", "hi")])
    assert thread.engaged and thread.first_response_hours == 2.0
