"""What a project asks of a contributor: read only where it is unambiguous."""

from datetime import UTC, datetime

import pytest

from holt.agent import asks
from holt.types import EvidenceRecord

T = datetime(2026, 9, 1, tzinfo=UTC)
PR = "https://github.com/o/r/pull/"


def comment(pr: int, author: str) -> EvidenceRecord:
    return EvidenceRecord(f"pr:o/r#{pr}:comment:1", "github", f"{PR}{pr}", T,
                          {"author": author, "body": "hi"})


def contributing(text: str) -> EvidenceRecord:
    return EvidenceRecord("repo:o/r:contributing", "github",
                          "https://github.com/o/r/blob/abc/CONTRIBUTING.md", T,
                          {"text": text, "path": "CONTRIBUTING.md"})


@pytest.mark.parametrize("login", ["linux-foundation-easycla", "google-cla", "meta-cla",
                                   "python-cla-bot", "CLAassistant", "cla-bot[bot]"])
def test_cla_bots(login):
    assert asks.is_cla_bot(login)


@pytest.mark.parametrize("login", ["cclauss", "clarfonthey", "claude", "anuclaks", "", None])
def test_people_are_not_cla_bots(login):
    assert not asks.is_cla_bot(login)


def test_a_cla_bot_on_an_outside_pull_request():
    found = asks.read([comment(7, "google-cla")], {"pr:o/r#7"})
    assert found == [asks.Ask("cla", f"{PR}7")]
    # Greeting only the team's own pull requests says nothing about outsiders.
    assert asks.read([comment(7, "google-cla")], {"pr:o/r#8"}) == []


def test_contributing_asks_for_a_sign_off_and_an_issue_first():
    doc = contributing("We use the Developer Certificate of Origin.\n"
                       "For anything big, please open an issue first so we can talk.")
    assert [a.code for a in asks.read([doc])] == ["dco", "issue_first"]


def test_a_licence_heading_is_not_a_cla_to_sign():
    """free-programming-books: the heading only means "you agree to the licence"."""
    doc = contributing("## Contributor License Agreement\n\nBy contributing, you agree "
                       "to the LICENSE of this repository.")
    assert asks.read([doc]) == []


def test_loose_mentions_of_issues_are_not_an_ask():
    doc = contributing("Found a bug? Check the existing issues. Discussions are welcome.")
    assert asks.read([doc]) == []
