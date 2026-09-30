"""The stale bot: how many quiet days before a bot closes a pull request.

Read from the project's own config (actions/stale in a workflow, or probot's
.github/stale.yml) at the commit the report read; failing that, from the
closes engine 6 already sees (rates.STALE), with no day count.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from holt.agent import stale
from holt.agent.signals import build_threads, outsider_threads
from holt.types import EvidenceRecord

NOW = datetime(2026, 9, 25, 12, tzinfo=UTC)

ACTIONS = """\
name: Close stale
on:
  schedule:
    - cron: '0 0 * * *'
jobs:
  stale:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/stale@v9
        with:
          repo-token: ${{ secrets.GITHUB_TOKEN }}
          days-before-stale: 60
          days-before-close: 7
          exempt-pr-labels: 'pinned, security'
"""


def test_actions_stale_adds_the_stale_and_close_days():
    rule = stale.parse_actions(ACTIONS)
    assert rule is not None
    assert rule.days == 67
    assert rule.exempt_labels == ("pinned", "security")


def test_actions_stale_pull_request_inputs_win_over_the_shared_ones():
    text = ACTIONS.replace("days-before-close: 7",
                           "days-before-close: 7\n          days-before-pr-stale: 30\n"
                           "          days-before-pr-close: 14")
    assert stale.parse_actions(text).days == 44


def test_actions_stale_defaults_are_60_and_7():
    text = "steps:\n  - uses: actions/stale@v8\n    with:\n      stale-issue-message: hi\n"
    assert stale.parse_actions(text).days == 67


def test_actions_stale_that_never_closes_pull_requests_is_no_rule():
    for line in ("days-before-close: 7\n          days-before-pr-close: -1",
                 "days-before-close: -1",
                 "days-before-close: 7\n          days-before-pr-stale: -1"):
        text = ACTIONS.replace("days-before-close: 7", line)
        assert stale.parse_actions(text) is None, line


def test_actions_stale_limited_to_labelled_pull_requests_is_no_rule():
    text = ACTIONS.replace("days-before-close: 7",
                           "days-before-close: 7\n          only-pr-labels: 'waiting-for-author'")
    assert stale.parse_actions(text) is None


def test_a_workflow_without_actions_stale_is_no_rule():
    assert stale.parse_actions("steps:\n  - uses: actions/checkout@v4\n") is None
    # dessant/lock-threads locks closed threads; it closes nothing.
    assert stale.parse_actions("steps:\n  - uses: dessant/lock-threads@v5\n") is None


def test_probot_stale():
    text = "daysUntilStale: 60\ndaysUntilClose: 7\nexemptLabels:\n  - pinned\n  - security\n"
    rule = stale.parse_probot(text)
    assert rule.days == 67
    assert rule.exempt_labels == ("pinned", "security")


def test_probot_stale_pulls_section_overrides():
    text = "daysUntilStale: 60\ndaysUntilClose: 7\npulls:\n  daysUntilStale: 30\n"
    assert stale.parse_probot(text).days == 37


def test_probot_stale_for_issues_only_or_never_closing_is_no_rule():
    assert stale.parse_probot("daysUntilStale: 60\nonly: issues\n") is None
    assert stale.parse_probot("daysUntilStale: 60\ndaysUntilClose: false\n") is None
    assert stale.parse_probot("daysUntilStale: 60\npulls:\n  daysUntilClose: false\n") is None


def test_probot_stale_defaults():
    assert stale.parse_probot("# all defaults\nmarkComment: >\n  quiet\n").days == 67


def _config(kind: str, path: str, text: str, i: int = 0) -> EvidenceRecord:
    return EvidenceRecord(f"repo:a/b:stale:{i}", "github",
                          f"https://github.com/a/b/blob/abc/{path}", NOW - timedelta(days=1),
                          {"kind": kind, "path": path, "text": text, "commit_oid": "abc"})


def _closed_by_stale_bot(n: int) -> list[EvidenceRecord]:
    opened = NOW - timedelta(days=200 - n)
    url = f"https://github.com/a/b/pull/{n}"
    return [
        EvidenceRecord(f"pr:a/b#{n}:opened", "github", url, opened,
                       {"author": f"user{n}", "author_is_bot": False,
                        "author_association": "NONE"}),
        EvidenceRecord(f"pr:a/b#{n}:closed", "github", url, opened + timedelta(days=90),
                       {"author": f"user{n}", "merged": False, "closed_by": "stale[bot]",
                        "closed_by_is_bot": True, "closer": None}),
    ]


def _read(records):
    threads = build_threads(records)
    return stale.read(records, outsider_threads(threads))


def test_read_uses_the_config_and_links_it():
    rule = _read([_config("actions", ".github/workflows/stale.yml", ACTIONS)])
    assert rule.days == 67
    assert rule.url == "https://github.com/a/b/blob/abc/.github/workflows/stale.yml"


def test_read_skips_a_config_that_closes_no_pull_requests():
    records = [_config("actions", ".github/workflows/stale.yml",
                       ACTIONS.replace("days-before-close: 7", "days-before-close: -1")),
               _config("probot", ".github/stale.yml", "daysUntilStale: 30\n", 1)]
    rule = _read(records)
    assert rule.days == 37 and rule.url.endswith(".github/stale.yml")


def test_read_falls_back_to_stale_closes_with_no_day_count():
    records = _closed_by_stale_bot(1) + _closed_by_stale_bot(2)
    rule = _read(records)
    assert rule is not None and rule.days is None
    assert rule.url == "https://github.com/a/b/pull/2"  # the newest


def test_one_stale_close_is_not_a_pattern():
    assert _read(_closed_by_stale_bot(1)) is None


def test_nothing_found_is_none():
    assert _read([]) is None
