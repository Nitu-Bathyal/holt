"""Pull requests that landed without the merge button, and mirrors and forks.

Each detection path is pinned on a real pull request from the golden
recordings (golden/recordings), so a test fails if the path stops recognising
the thing it was written for. No network.
"""

from __future__ import annotations

from dataclasses import replace
from functools import cache

import pytest

from golden import golden
from holt.agent import landing_detection as ld
from holt.agent.findings import Findings
from holt.agent.pipeline import analyze_without_model
from holt.agent.signals import build_threads, compute
from holt.agent.verdict import classify as decide
from holt.agent.verdict import rule_codes
from holt.report import Verdict
from holt.types import EvidenceRecord


@cache
def recording(repo: str) -> tuple[EvidenceRecord, ...]:
    return tuple(golden.read_recording(repo)[1])


def closure(repo: str, number: int) -> ld.Closure:
    return ld.classify(recording(repo))[f"pr:{repo}#{number}"]


def thread_records(repo: str, number: int) -> list[EvidenceRecord]:
    prefix = f"pr:{repo}#{number}:"
    return [r for r in recording(repo) if r.evidence_id.startswith(prefix)]


# --- each way a pull request lands off the button ----------------------------


def test_a_merge_bot_closing_with_a_commit_is_a_landing():
    # pytorchmergebot lands the change as a commit on main; the commit closes
    # the pull request, which GitHub then shows as closed.
    c = closure("pytorch/pytorch", 198476)
    assert (c.outcome, c.how) == (ld.LANDED, "merge_bot")
    assert "pytorchmergebot" in c.why
    assert c.evidence_id.endswith(":closed")


def test_an_internal_sync_closing_with_a_commit_is_a_landing():
    # meta-codesync: Meta imports the pull request, lands it internally, and
    # syncs the commit back out.
    c = closure("react/react-native", 58461)
    assert (c.outcome, c.how) == (ld.LANDED, "internal_sync")
    assert c.via == ld.VIA["internal_sync"]


def test_gerrit_landings_are_read_from_gopherbots_notice():
    c = closure("golang/go", 80153)
    assert (c.outcome, c.how) == (ld.LANDED, "gerrit")
    assert c.why == ("gopherbot wrote: “This PR is being closed because "
                     "golang.org/cl/794361 has been merged.”")
    assert ":comment:" in c.evidence_id


def test_mailing_list_landings_are_read_from_gitgitgadget():
    c = closure("git/git", 2217)
    assert (c.outcome, c.how) == (ld.LANDED, "mailing_list")


def test_reaching_seen_or_next_on_the_mailing_list_is_not_landing():
    records = [
        r for r in thread_records("git/git", 2217)
        if "integrated into master" not in (r.payload.get("body") or "")
        and "merged into upstream" not in (r.payload.get("body") or "")
    ]
    assert ld.classify(records)["pr:git/git#2217"].outcome == ld.CLOSED


def test_a_maintainers_merged_to_comment_is_a_landing():
    # OpenSSL pushes the commits itself and closes with "Merged to 3.4. Thank you!"
    c = closure("openssl/openssl", 32767)
    assert (c.outcome, c.how) == (ld.LANDED, "comment")
    assert "jogme" in c.why and "Merged to 3.4" in c.why


def test_a_person_closing_with_their_own_commit_is_a_landing():
    # material-components-android: the Copybara commit closes the pull request
    # under the name of the maintainer who approved it internally.
    c = closure("material-components/material-components-android", 4266)
    assert (c.outcome, c.how) == (ld.LANDED, "commit")


def test_a_merged_label_is_a_landing_when_nothing_else_is_known():
    # A pytorch landing as an older capture, or one whose close event was
    # crowded out of the timeline window, sees it: no closer, no bot comment,
    # only the "Merged" label.
    records = []
    for r in thread_records("pytorch/pytorch", 198482):
        if ":comment:" in r.evidence_id or ":review:" in r.evidence_id:
            continue
        if r.evidence_id.endswith(":closed"):
            r = replace(r, payload={**r.payload, "closer": None, "closed_by": None})
        records.append(r)
    c = ld.classify(records)["pr:pytorch/pytorch#198482"]
    assert (c.outcome, c.how) == (ld.LANDED, "label")
    assert "Merged" in c.why


def test_a_github_merge_stays_a_merge():
    c = closure("pallets/flask", next(
        int(r.evidence_id.split("#")[1].split(":")[0]) for r in recording("pallets/flask")
        if r.evidence_id.endswith(":merged")
    ))
    assert c.outcome == ld.MERGED and c.how == ""


# --- what is not a landing ---------------------------------------------------


def test_landed_then_reverted_is_not_a_landing():
    # Closed by meta-codesync's commit and labelled Merged, then Reverted.
    assert closure("react/react-native", 58486).outcome == ld.CLOSED


def test_a_revert_notice_alone_undoes_the_landing():
    records = []
    for r in thread_records("react/react-native", 58486):
        if r.evidence_id.endswith(":opened"):
            labels = [n for n in r.payload["labels"] if n != "Reverted"]
            r = replace(r, payload={**r.payload, "labels": labels})
        records.append(r)
    assert ld.classify(records)["pr:react/react-native#58486"].outcome == ld.CLOSED


def test_closed_in_favour_of_another_pull_request_is_not_a_landing():
    # "Closing in favor of #32852": the work went in, but through someone else's PR.
    assert closure("openssl/openssl", 32849).outcome == ld.CLOSED


def test_a_repository_that_closes_by_hand_has_no_landings():
    closures = ld.classify(recording("pallets/flask"))
    assert not [c for c in closures.values() if c.outcome == ld.LANDED]


def test_commit_references_alone_are_not_landings():
    # openssl #32798 was closed as already done elsewhere; commits mention it.
    assert closure("openssl/openssl", 32798).outcome == ld.CLOSED


@pytest.mark.parametrize("body", [
    "Merged to 3.4. Thank you!",
    "merged to master, thank you",
    "## Merged onto master\n\ncd19b150f3 crypto: fix",
    "Merged (only the last commit) to 3.5. Thank you!",
    "Thanks! Merged to master.",
    "Merged in 2639771ab195bd4e82c11c451c8d6092919c03fe",
    "Landed in 95cb57e57d47e7a4840f5bb44f77f39b39ee6320",
    "This was merged already.",
    "Merged directly",
    "Merged manually due to github web interface glitch.",
    "Merged",
    "Looks good.\nPushed to master and 3.6. Thanks for the reviews.",
])
def test_ways_a_maintainer_says_it_landed(body):
    assert ld._said_landed(body)


@pytest.mark.parametrize("body", [
    "Once merged, Maestro will create a new codeflow PR",
    "I think this should be merged to 3.x as well",
    "Hi @neomantra, I've merged #1626 and the changes will be available soon",
    "Merged in #1234 instead",
    "This was superseded, merged elsewhere",
    "When will this be merged?",
    "This PR cannot be merged until you sign the Contributor License Agreement",
    "Please rebase to pick up the fixes merged in: #3650",
    "Picked rather than merged because the branch had moved on",
])
def test_ways_of_mentioning_merging_that_are_not_a_landing(body):
    assert ld._said_landed(body) is None


def test_a_stranger_saying_merged_does_not_land_anything():
    records = [r for r in thread_records("openssl/openssl", 32767)
               if ":comment:" not in r.evidence_id]
    opened = next(r for r in records if r.evidence_id.endswith(":opened"))
    stranger = EvidenceRecord(
        "pr:openssl/openssl#32767:comment:99", "github", opened.url, opened.timestamp,
        {"author": "passer-by", "author_association": "NONE", "body": "Merged to 3.4!"},
    )
    assert ld.classify([*records, stranger])["pr:openssl/openssl#32767"].outcome == ld.CLOSED


# --- the counts and the report ------------------------------------------------


def test_landings_count_as_merges_everywhere_downstream():
    threads = build_threads(recording("golang/go"))
    landed = [t for t in threads.values() if t.landed_via]
    assert len(landed) == 52 and all(t.merged and not t.closed_unmerged for t in landed)
    assert {t.landed_via for t in landed} == {"gerrit"}
    assert compute(threads).outsider_merged > 0


@pytest.mark.parametrize(("repo", "how"), [
    ("golang/go", "through Gerrit"),
    ("react/react-native", "internal code sync"),
    ("pytorch/pytorch", "merge bot"),
    ("openssl/openssl", "by hand"),
])
def test_the_report_says_how_the_merges_landed(repo, how):
    cutoff, _ = golden.read_recording(repo)
    assessment, trace = analyze_without_model(
        repo, golden.RecordingProvider(repo), as_of=cutoff, min_age_hours=None)
    line = next(r for r in assessment.rules if getattr(r, "code", "") == "landed_off_button")
    assert how in line and "closed rather than merged" in line
    assert "_" not in line  # no internal names reach the reader
    # Said after the rule that decided the verdict, not instead of it.
    assert rule_codes(assessment.rules)[-1] == "landed_off_button"
    assert assessment.verdict == Verdict.VIABLE
    assert trace.signals.outsider_merged >= 2


def test_no_line_when_every_merge_used_the_button():
    cutoff, _ = golden.read_recording("pallets/flask")
    assessment, _ = analyze_without_model(
        "pallets/flask", golden.RecordingProvider("pallets/flask"), as_of=cutoff)
    assert "landed_off_button" not in rule_codes(assessment.rules)


# --- mirrors and forks ---------------------------------------------------------


def meta(repo: str) -> dict:
    return next(r.payload for r in recording(repo) if r.evidence_id.endswith(":meta"))


def test_a_github_flagged_mirror_says_where_contributions_go():
    line = ld.elsewhere(meta("v8/v8"), outsider_merged=0)
    assert line.startswith("GitHub marks this repository as a mirror")
    assert "Contributions happen at https://chromium.googlesource.com/v8/v8.git." in line


def test_a_flagged_mirror_is_decisive_in_rules_mode():
    cutoff, _ = golden.read_recording("v8/v8")
    assessment, _ = analyze_without_model(
        "v8/v8", golden.RecordingProvider("v8/v8"), as_of=cutoff)
    assert assessment.verdict == Verdict.NOT_VIABLE
    assert rule_codes(assessment.rules) == ["elsewhere"]
    assert assessment.bottom_line.startswith("Not worth your time. GitHub marks")
    assert any(c.evidence_id == "repo:v8/v8:meta" for c in assessment.claims)


def test_a_self_described_mirror_with_nothing_landed_is_caught():
    line = ld.elsewhere(meta("mirror/busybox"), outsider_merged=0)
    assert line and "describes itself as a mirror" in line


def test_a_self_described_mirror_that_merges_outsiders_is_not():
    # git/git calls itself a "Source Code Mirror", but GitGitGadget lands work.
    assert ld.elsewhere(meta("git/git"), outsider_merged=9) is None


@pytest.mark.parametrize("description", [
    "Mirror your Android screen to your computer",
    "A tool that mirrors files between machines",
    "Fast package mirroring",
])
def test_mirror_as_a_verb_is_not_a_mirror(description):
    assert ld.elsewhere({"description": description}, outsider_merged=0) is None


def test_a_fork_with_nothing_landed_points_upstream():
    line = ld.elsewhere({"is_fork": True, "parent": "pallets/flask"}, outsider_merged=0)
    assert "fork of pallets/flask" in line and "https://github.com/pallets/flask" in line


def test_a_fork_that_merges_outsiders_is_its_own_project():
    assert ld.elsewhere({"is_fork": True, "parent": "a/b"}, outsider_merged=3) is None


def test_the_elsewhere_finding_decides_before_the_arithmetic():
    findings = Findings()
    findings.add("contribute_elsewhere", "This repository is a fork of a/b.", ("repo:x/y:meta",))
    signals = compute(build_threads(recording("pallets/flask")))
    verdict, rules = decide(findings, signals)
    assert verdict == Verdict.NOT_VIABLE
    assert rule_codes(rules) == ["elsewhere"] and rules[0] == "This repository is a fork of a/b."
