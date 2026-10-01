"""PR watch's rules (alerts.py): which alert each change or wait gives, the
line it reads as, and who has access. Pure: no database, no network."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from holt_server import alerts, pricing, schema

NOW = datetime(2026, 10, 1, 12, 0, tzinfo=UTC)
CAT = pricing.load()


def pr(**kw) -> alerts.Pr:
    values = dict(repo="pallets/click", repo_key="pallets/click", number=2811,
                  title="Fix shell completion", url="https://github.com/pallets/click/pull/2811",
                  state="open", created_at=NOW - timedelta(days=5, hours=2), turn="theirs",
                  turn_at=NOW - timedelta(days=5, hours=2),
                  last_activity_at=NOW - timedelta(days=5, hours=2))
    values.update(kw)
    return alerts.Pr(**values)


def timing(**kw) -> schema.Timing:
    return schema.Timing(**kw)


def kinds(found) -> list[str]:
    return [f.kind for f in found]


# --- what changed -------------------------------------------------------------------------


def test_a_maintainer_reply_is_your_turn():
    at = NOW - timedelta(hours=1)
    new = pr(turn="yours", turn_at=at, first_reply_at=at, reply_by="davidism",
             reply_kind="reply")
    [found] = alerts.events(pr(), new)
    assert (found.kind, found.facts, found.at) == ("reply", {"who": "davidism"}, at)
    assert alerts.line("reply", new.repo, new.number, found.facts) == (
        "Your turn: @davidism replied on click #2811.")


def test_a_request_for_changes_is_your_turn_with_its_own_line():
    at = NOW - timedelta(hours=1)
    new = pr(turn="yours", turn_at=at, first_reply_at=at, reply_by="mkoval",
             reply_kind="changes", review_decision="changes_requested")
    [found] = alerts.events(pr(), new)
    assert found.kind == "changes"
    assert alerts.line(found.kind, new.repo, new.number, found.facts) == (
        "Your turn: @mkoval asked for changes on click #2811.")


def test_your_turn_fires_again_only_when_the_team_speaks_again():
    first = NOW - timedelta(hours=3)
    old = pr(turn="yours", turn_at=first, reply_by="lead", reply_kind="reply")
    assert alerts.events(old, old) == []  # the same read twice: nothing new
    again = pr(turn="yours", turn_at=NOW - timedelta(hours=1), reply_by="lead",
               reply_kind="reply")
    assert kinds(alerts.events(old, again)) == ["reply"]


def test_a_comment_after_a_standing_request_for_changes_is_a_reply():
    asked = pr(turn="yours", turn_at=NOW - timedelta(hours=3), reply_by="mkoval",
               reply_kind="changes")
    # Someone else comments; the request still stands, and it was already told.
    later = pr(turn="yours", turn_at=NOW - timedelta(hours=1), reply_by="mkoval",
               reply_kind="changes")
    [found] = alerts.events(asked, later)
    assert (found.kind, found.facts) == ("reply", {})
    assert alerts.line(found.kind, later.repo, later.number, found.facts) == (
        "Your turn: a reviewer replied on click #2811.")
    # A plain reply turning into a request for changes is news.
    replied = pr(turn="yours", turn_at=NOW - timedelta(hours=3), reply_by="lead",
                 reply_kind="reply")
    assert kinds(alerts.events(replied, later)) == ["changes"]


def test_your_own_move_is_no_alert():
    old = pr(turn="yours", turn_at=NOW - timedelta(hours=3), reply_by="lead",
             reply_kind="reply")
    assert alerts.events(old, pr(turn="theirs", turn_at=NOW - timedelta(hours=1))) == []


def test_an_approval_alerts_once():
    at = NOW - timedelta(hours=1)
    new = pr(turn="theirs", turn_at=at, reply_by="jrios", reply_kind="approved",
             review_decision="approved")
    [found] = alerts.events(pr(), new)
    assert found.kind == "approved"
    assert alerts.line("approved", "dotnet/efcore", 3310, found.facts) == (
        "Approved: @jrios approved efcore #3310.")
    assert alerts.events(new, new) == []
    # A row stored before Holt kept who spoke last: an approval from weeks
    # ago is not news the first time it is read again.
    before = pr(turn="theirs", turn_at=at, review_decision="approved")
    assert alerts.events(before, new) == []
    # The decision turning to approved with nobody's word since your last move.
    [bare] = alerts.events(pr(), pr(review_decision="approved"))
    assert alerts.line("approved", "dotnet/efcore", 3310, bare.facts) == "Approved: efcore #3310."


def test_merged_and_closed():
    [m] = alerts.events(pr(), pr(state="merged", merged_at=NOW, closed_at=NOW))
    assert (m.kind, m.at) == ("merged", NOW)
    assert alerts.line("merged", "kubernetes/kubernetes", 128811, {}) == (
        "Merged: kubernetes #128811.")
    [c] = alerts.events(pr(), pr(state="closed", closed_at=NOW))
    assert c.kind == "closed"
    assert alerts.line("closed", "moment/moment", 6120, {}) == (
        "Closed without merging: moment #6120.")


def test_nothing_for_a_pull_request_holt_wasnt_watching():
    yours = pr(turn="yours", turn_at=NOW, reply_by="lead", reply_kind="reply")
    assert alerts.events(None, yours) == []  # seen for the first time
    assert alerts.events(pr(state="merged"), pr(state="merged")) == []
    # A failed read on either side says nothing changed.
    assert alerts.events(pr(turn="unknown"), yours) == []
    assert alerts.events(pr(), pr(turn="unknown")) == []


# --- the waits ----------------------------------------------------------------------------


def test_no_reply_alerts_only_past_the_slow_mark_never_the_typical_one():
    t = timing(first_reply_half_hours=24.0, first_reply_slow_hours=96.0)
    # Day 3: past the typical wait (a day), inside the slow one (4 days).
    waiting = pr(created_at=NOW - timedelta(days=2, hours=2))
    assert alerts.overdue(waiting, t, NOW) == []
    late = pr(created_at=NOW - timedelta(days=5, hours=2))
    [found] = alerts.overdue(late, t, NOW)
    assert (found.kind, found.at) == ("late_reply", None)
    assert alerts.line(found.kind, "processing/p5.js", 7120, found.facts) == (
        "Day 6, no reply on p5.js #7120. Most get one within 4 days here.")


def test_the_typical_mark_alone_never_alerts():
    t = timing(first_reply_half_hours=24.0)  # the slow mark is under the engine's minimum
    assert alerts.overdue(pr(created_at=NOW - timedelta(days=40)), t, NOW) == []


def test_no_wait_alert_without_the_reports_numbers():
    old = pr(created_at=NOW - timedelta(days=40))
    assert alerts.overdue(old, None, NOW) == []  # no report
    assert alerts.overdue(old, timing(), NOW) == []  # under the minimums


def test_a_reply_ends_the_no_reply_wait():
    t = timing(first_reply_slow_hours=96.0)
    replied = pr(first_reply_at=NOW - timedelta(days=4), turn="yours")
    assert alerts.overdue(replied, t, NOW) == []


def test_waiting_to_merge_past_the_slow_merge_time():
    t = timing(first_reply_slow_hours=96.0, merge_slow_days=14.0)
    replied = dict(first_reply_at=NOW - timedelta(days=18), turn="theirs")
    assert alerts.overdue(pr(created_at=NOW - timedelta(days=10), **replied), t, NOW) == []
    [found] = alerts.overdue(pr(created_at=NOW - timedelta(days=19, hours=5), **replied),
                             t, NOW)
    assert found.kind == "late_merge"
    assert alerts.line(found.kind, "dotnet/efcore", 3310, found.facts) == (
        "Day 20 on efcore #3310. Most merged ones land within 2 weeks here.")
    # Your turn: the wait is on you, not on them.
    mine = pr(created_at=NOW - timedelta(days=19), first_reply_at=NOW - timedelta(days=18),
              turn="yours")
    assert alerts.overdue(mine, t, NOW) == []


@pytest.mark.parametrize(("quiet_days", "fires"), [(24.5, False), (25.2, True), (29.9, True),
                                                   (30.5, False)])
def test_the_stale_bot_warning_comes_five_days_before_the_close(quiet_days, fires):
    t = timing(stale_bot=True, stale_close_days=30)
    quiet = pr(created_at=NOW - timedelta(days=60), first_reply_at=NOW - timedelta(days=50),
               turn="yours", last_activity_at=NOW - timedelta(days=quiet_days))
    found = alerts.overdue(quiet, t, NOW)
    assert kinds(found) == (["stale_soon"] if fires else [])
    if fires:
        assert found[0].at == quiet.last_activity_at  # new activity, a new warning
        assert alerts.line("stale_soon", "EbookFoundation/free-programming-books", 11020,
                           {"quiet": 25, "close": 30}) == (
            "Quiet for 25 days on free-programming-books #11020. The bot here closes at 30.")


def test_a_short_stale_rule_never_warns_before_half_its_days():
    t = timing(stale_bot=True, stale_close_days=7)
    quiet = lambda days: pr(last_activity_at=NOW - timedelta(days=days))  # noqa: E731
    assert alerts.overdue(quiet(3), t, NOW) == []
    assert kinds(alerts.overdue(quiet(4), t, NOW)) == ["stale_soon"]
    # A bot seen closing pull requests, with no day count: nothing to count down to.
    assert alerts.overdue(quiet(40), timing(stale_bot=True), NOW) == []


def test_drafts_get_no_wait_alerts_but_still_get_replies():
    t = timing(first_reply_slow_hours=96.0, stale_bot=True, stale_close_days=30)
    draft = pr(draft=True, created_at=NOW - timedelta(days=40),
               last_activity_at=NOW - timedelta(days=27))
    assert alerts.overdue(draft, t, NOW) == []
    new = pr(draft=True, turn="yours", turn_at=NOW, reply_by="lead", reply_kind="reply")
    assert kinds(alerts.derive(draft, new, t, NOW)) == ["reply"]


def test_an_unread_pull_request_gets_no_wait_alert():
    t = timing(first_reply_slow_hours=96.0)
    assert alerts.overdue(pr(turn="unknown", created_at=NOW - timedelta(days=40)), t, NOW) == []
    assert alerts.overdue(pr(state="merged", created_at=NOW - timedelta(days=40)), t, NOW) == []


def test_each_event_has_one_key():
    late = alerts.Found("late_reply", {"days": 6})
    a = pr()
    assert alerts.dedupe_key("u1", a, late) == alerts.dedupe_key("u1", a, late)
    assert alerts.dedupe_key("u1", a, late) != alerts.dedupe_key("u2", a, late)
    first = alerts.Found("reply", at=NOW)
    second = alerts.Found("reply", at=NOW + timedelta(hours=2))
    assert alerts.dedupe_key("u1", a, first) != alerts.dedupe_key("u1", a, second)


def test_lines_without_a_name_and_a_single_day():
    assert alerts.line("reply", "a/b", 1, {}) == "Your turn: a reviewer replied on b #1."
    assert alerts.line("changes", "a/b", 1, None) == (
        "Your turn: a reviewer asked for changes on b #1.")
    assert alerts.line("stale_soon", "a/b", 1, {"quiet": 1, "close": 6}) == (
        "Quiet for 1 day on b #1. The bot here closes at 6.")


# --- access -------------------------------------------------------------------------------


def user(plan="free", plan_expires_at=None, trial=None):
    return SimpleNamespace(id="u1", plan=plan, plan_expires_at=plan_expires_at,
                           alerts_trial_ends_at=trial)


def test_access_never_turned_on_is_off():
    assert alerts.access(CAT, user(), NOW) == alerts.Access("off")
    assert alerts.access(CAT, None, NOW).state == "off"
    assert not alerts.access(CAT, user(), NOW).on


def test_access_during_and_after_the_taste():
    ends = NOW + timedelta(days=3)
    got = alerts.access(CAT, user(trial=ends), NOW)
    assert (got.state, got.until, got.on) == ("trial", ends, True)
    over = alerts.access(CAT, user(trial=NOW - timedelta(seconds=1)), NOW)
    assert (over.state, over.on) == ("ended", False)
    assert over.until == NOW - timedelta(seconds=1)


def test_access_with_a_pass_and_after_it_lapses():
    until = NOW + timedelta(days=20)
    got = alerts.access(CAT, user("pro", until, trial=NOW - timedelta(days=30)), NOW)
    assert (got.state, got.until, got.on) == ("pro", until, True)
    # The pass ran out after the taste did: ended, on the later date.
    lapsed = alerts.access(
        CAT, user("pro", NOW - timedelta(days=1), trial=NOW - timedelta(days=30)), NOW)
    assert (lapsed.state, lapsed.until) == ("ended", NOW - timedelta(days=1))
    # A lapsed pass with the taste never used: the taste is still theirs to start.
    assert alerts.access(CAT, user("pro", NOW - timedelta(days=1)), NOW).state == "off"


def test_access_while_pr_watch_is_switched_off():
    got = alerts.access(CAT, user("pro", None), NOW, available=False)
    assert (got.state, got.on) == ("unavailable", False)


def test_the_unsubscribe_token_needs_the_servers_secret():
    token = alerts.unsubscribe_token("secret", "u1", "nonce")
    assert token == alerts.unsubscribe_token("secret", "u1", "nonce")
    assert token != alerts.unsubscribe_token("other", "u1", "nonce")
    assert token != alerts.unsubscribe_token("secret", "u2", "nonce")
    assert token != alerts.unsubscribe_token("secret", "u1", "rotated")
    assert "u1" not in token and len(alerts.token_hash(token)) == 64
