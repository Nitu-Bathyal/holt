"""What a project asks of a contributor: read only where it is unambiguous."""

from datetime import UTC, datetime, timedelta

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


# --- read from how outside pull requests were closed and labelled (engine 6) ------------

OPENED = datetime(2026, 6, 1, tzinfo=UTC)
TRAC = ("Thank you for your contribution to Django!\n\n<details>\n<summary><strong>❗ Error: "
        "Missing Trac Ticket</strong></summary>\n\nThis PR does not include a valid Trac ticket "
        "reference.\n\n1. Visit https://code.djangoproject.com and find or file the appropriate "
        "ticket for your change.\n")
AI_UNDISCLOSED = ("<summary><strong>❗ Error: AI Tool Usage Not Disclosed</strong></summary>\n"
                  "You must select exactly one checkbox in the AI Assistance Disclosure section.")


def outside_pr(n: int, *, labels=(), title: str = "Fix a thing", closed_by: str | None = None,
               bot: bool = False, after_hours: float = 0.1, comments=()) -> list[EvidenceRecord]:
    """An outside pull request, closed by `closed_by` when given, with `comments`
    as (author, body)."""
    at = lambda h: OPENED + timedelta(hours=h)  # noqa: E731
    out = [EvidenceRecord(f"pr:o/r#{n}:opened", "github", f"{PR}{n}", at(0),
                          {"author": f"user{n}", "author_is_bot": False, "title": title,
                           "labels": list(labels), "author_association": "NONE"})]
    for i, (who, body) in enumerate(comments):
        out.append(EvidenceRecord(f"pr:o/r#{n}:comment:{i}", "github", f"{PR}{n}", at(0.05),
                                  {"author": who, "author_is_bot": who.endswith("[bot]") or who
                                   == "github-actions", "body": body,
                                   "author_association": "NONE"}))
    if closed_by is not None:
        out.append(EvidenceRecord(f"pr:o/r#{n}:closed", "github", f"{PR}{n}", at(after_hours),
                                  {"author": f"user{n}", "merged": False, "closed_by": closed_by,
                                   "closed_by_is_bot": bot, "closer": None}))
    return out


def codes(*prs, docs=()) -> list[str]:
    return [a.code for a in asks.read([r for p in prs for r in p] + list(docs))]


def test_a_bot_closing_for_a_missing_ticket_asks_for_a_ticket_first():
    """django: github-actions closes a pull request with no accepted Trac ticket."""
    prs = [outside_pr(i, closed_by="github-actions", bot=True,
                      comments=[("github-actions", TRAC)]) for i in (1, 2)]
    found = asks.read([r for p in prs for r in p])
    ticket = next(a for a in found if a.code == "ticket_first")
    assert ticket.url.startswith(PR) and ticket.link == "https://code.djangoproject.com"


def test_one_ticket_close_is_not_enough():
    assert "ticket_first" not in codes(outside_pr(1, closed_by="github-actions", bot=True,
                                                  comments=[("github-actions", TRAC)]))


def test_a_person_mentioning_a_ticket_is_not_a_requirement():
    prs = [outside_pr(i, closed_by="maintainer", comments=[("maintainer", TRAC)]) for i in (1, 2)]
    assert "ticket_first" not in codes(*prs)


def test_closes_marked_as_ai_mean_no_ai_written_pull_requests():
    """flask retitles them, ruff labels them, click does both."""
    flask = [outside_pr(i, title=t, closed_by="davidism")
             for i, t in enumerate(["AI junk", "[rejected AI] add a hosting guide"], 1)]
    ruff = [outside_pr(i, labels=["bot:ai-policy-close"], closed_by="astral-bot", bot=True)
            for i in (1, 2)]
    assert codes(*flask) == ["no_ai_prs"]
    assert codes(*ruff) == ["no_ai_prs"]


@pytest.mark.parametrize("label", ["llm-assisted", "assisted: ai", "AI-assisted", "cla: 1.0 no AI",
                                   "maybe-ai"])
def test_labels_that_only_disclose_ai_are_not_a_ban(label):
    """rust and nixpkgs label AI-assisted pull requests and merge them."""
    prs = [outside_pr(i, labels=[label], closed_by="maintainer") for i in (1, 2, 3)]
    assert "no_ai_prs" not in codes(*prs)


def test_open_pull_requests_marked_as_ai_are_not_closes():
    assert codes(*(outside_pr(i, labels=["rejected AI"]) for i in (1, 2))) == []


@pytest.mark.parametrize("text", [
    "This project does _not_ accept fully AI-generated contributions.",
    "Pull requests suspected of being made in whole or in part through generative AI "
    "without human-review will be closed.",
    "We do not accept pull requests written by AI or LLM tools.",
])
def test_a_written_ban_on_ai_pull_requests(text):
    assert codes(docs=[contributing(text)]) == ["no_ai_prs"]


@pytest.mark.parametrize("text", [
    "You must disclose in the initial issue or pull request that you used AI/LLM.",
    "If AI helped write your contribution, read our AI contributions policy: we expect disclosure.",
    "If you are using an AI tool, you must declare which agent and model were used.",
    "- Disclosure required: Code contributions that are fully or partially LLM-generated.",
])
def test_a_written_rule_to_disclose_ai(text):
    assert codes(docs=[contributing(text)]) == ["ai_disclosure"]


@pytest.mark.parametrize("text", [
    "Please report security vulnerabilities by responsible disclosure.",
    "Holt uses AI to explain its reports.",
    "We require all use of AI in contributions to follow our AI Policy.",
    "AI tools are welcome as an aid, but you must fully understand the code.",
])
def test_other_mentions_of_ai_or_disclosure_ask_nothing(text):
    assert codes(docs=[contributing(text)]) == []


def test_a_ban_outranks_disclosure():
    doc = contributing("We do not accept AI-generated pull requests. Disclose any AI use.")
    assert codes(docs=[doc]) == ["no_ai_prs"]


def test_an_ai_policy_file_is_read_like_contributing():
    doc = EvidenceRecord("repo:o/r:ai_policy", "github",
                         "https://github.com/o/r/blob/abc/AI_POLICY.md", T,
                         {"text": "You must disclose any use of AI tools.", "path": "AI_POLICY.md"})
    found = asks.read([doc])
    assert found == [asks.Ask("ai_disclosure", doc.url)]


def test_a_bot_that_closes_undisclosed_ai_use_asks_for_disclosure():
    prs = [outside_pr(i, closed_by="github-actions", bot=True,
                      comments=[("github-actions", AI_UNDISCLOSED)]) for i in (1, 2)]
    assert codes(*prs) == ["ai_disclosure"]


def test_gated_tests_and_sig_teams():
    """kubernetes: prow labels outside pull requests needs-ok-to-test and sig/<area>."""
    prs = [outside_pr(i, labels=["needs-ok-to-test" if i % 2 else "ok-to-test", "sig/node",
                                 "needs-triage"]) for i in range(1, 7)]
    prs += [outside_pr(i, labels=["sig/apps"]) for i in range(7, 10)]
    assert codes(*prs) == ["ok_to_test", "sig_team"]


def test_a_few_gated_pull_requests_are_not_most():
    prs = [outside_pr(i, labels=["needs-ok-to-test"]) for i in range(1, 4)]
    prs += [outside_pr(i) for i in range(4, 10)]
    assert codes(*prs) == []


def test_many_duplicate_closes():
    dup = [outside_pr(i, closed_by="maintainer",
                      comments=[("maintainer", f"Duplicate of #{100 + i}")]) for i in range(1, 6)]
    assert codes(*dup) == ["duplicates"]
    assert codes(*dup[:4]) == []


def test_the_team_s_own_pull_requests_say_nothing_about_outsiders():
    prs = [outside_pr(i, labels=["needs-ok-to-test"]) for i in range(1, 7)]
    assert asks.read([r for p in prs for r in p], outsider_keys=set()) == []


def test_asks_come_in_order_of_what_blocks_a_pull_request_first():
    prs = [outside_pr(i, closed_by="github-actions", bot=True,
                      comments=[("github-actions", TRAC), ("google-cla", "Sign the CLA")])
           for i in (1, 2)]
    doc = contributing("Please open an issue first. We do not accept AI-generated pull requests.")
    assert codes(*prs, docs=[doc]) == ["ticket_first", "no_ai_prs", "cla", "issue_first"]
