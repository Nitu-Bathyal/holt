"""Catalogue detection from diff shape: registries and lists, no model.

The free report used to call is-a-dev/register "worth your time", because on
every count Holt makes a registry looks healthy. These tests pin the three
entry shapes, the cases that must not count, and the golden-set result: the
catalogues are flagged and no software project is.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from golden import golden
from holt.agent import repo_kind_rules as rk
from holt.agent.pipeline import analyze_without_model
from holt.agent.verdict import rule_codes
from holt.evidence.fixtures import FixtureProvider
from holt.report import Verdict
from holt.types import EvidenceRecord, Window

T0 = datetime(2026, 3, 1, tzinfo=UTC)  # before the fixture provider's cutoff
REPO = "o/r"


def pr(n: int, files: list[str], title: str = "Change", additions: int = 5,
       deletions: int = 0, association: str = "NONE", author: str | None = None,
       merged: bool = True, reviewed: bool = False) -> list[EvidenceRecord]:
    key = f"pr:{REPO}#{n}"
    who = author or f"person{n}"
    records = [EvidenceRecord(
        evidence_id=f"{key}:opened", source="github", url=f"https://github.com/{REPO}/pull/{n}",
        timestamp=T0 + timedelta(hours=n),
        payload={"author": who, "author_association": association, "author_is_bot": False,
                 "title": title, "files": files, "changed_files": len(files),
                 "additions": additions, "deletions": deletions},
    )]
    if reviewed:
        records.append(EvidenceRecord(
            evidence_id=f"{key}:comment:1", source="github", url=records[0].url,
            timestamp=T0 + timedelta(hours=n, minutes=10),
            payload={"author": "maintainer", "author_association": "MEMBER",
                     "author_is_bot": False, "body": "Thanks, looks good."},
        ))
    if merged:
        records.append(EvidenceRecord(
            evidence_id=f"{key}:merged", source="github", url=records[0].url,
            timestamp=T0 + timedelta(hours=n, minutes=30),
            payload={"author": who, "merged_by": "maintainer"},
        ))
    return records


def many(make, count: int = 12) -> list[EvidenceRecord]:
    return [r for n in range(1, count + 1) for r in make(n)]


# --- the three entry shapes ------------------------------------------------------


def test_one_data_file_per_pull_request_is_a_registry():
    records = many(lambda n: pr(n, [f"domains/user{n}.json"], f"Register user{n}.is-a.dev"))
    shape = rk.detect(records)
    assert shape is not None
    assert (shape.kind, shape.shape, shape.where) == ("registry", rk.DATA, "domains/")
    assert (shape.entries, shape.attempts) == (12, 12)
    rule = shape.rule()
    assert rule.code == "catalogue_shape"
    assert rule.startswith("12 of the 12 pull requests from outside contributors")
    assert "domains/ folder" in rule and "isn't a software contribution" in rule


def test_several_manifests_for_one_version_are_one_entry():
    # winget: installer, locale and version manifests in one version folder.
    def make(n):
        base = f"manifests/a/Acme/App{n}/1.{n}.0"
        return pr(n, [f"{base}/Acme.App{n}.installer.yaml", f"{base}/Acme.App{n}.locale.en-US.yaml",
                      f"{base}/Acme.App{n}.yaml"], f"New version: Acme.App{n} version 1.{n}.0", 90)
    shape = rk.detect(many(make))
    assert shape is not None and shape.shape == rk.DATA and shape.where == "manifests/"


@pytest.mark.parametrize("title", ["tool{n} 2.{n}.0", "tool{n}: update to 2.{n}.0",
                                   "tool{n} 2.{n}.0 (new cask)", "Add tool{n} cask"])
def test_one_package_manifest_named_in_the_title_is_a_package_entry(title):
    # homebrew-cask: a cask is a declarative manifest (version, url, sha256).
    records = many(lambda n: pr(n, [f"Casks/t/tool{n}.rb"], title.format(n=n)))
    shape = rk.detect(records)
    assert shape is not None
    assert (shape.kind, shape.shape, shape.where) == ("registry", rk.PACKAGE, "Casks/")
    assert "single package in the Casks/ folder" in shape.rule()


def test_a_manifest_change_that_is_not_a_version_or_a_new_package_is_not_an_entry():
    records = many(lambda n: pr(n, [f"Casks/t/tool{n}.rb"], f"tool{n}: fix livecheck"))
    assert rk.read(records) == rk.Reading()


# --- package recipes: packaging work, not turned down ------------------------------


@pytest.mark.parametrize("files,title", [
    (["packages/tool{n}/build.sh"], "bump(main/tool{n}): 2.{n}.0"),          # termux
    (["packages/tool{n}/build.sh", "packages/tool{n}/fix.patch"], "addpkg(main/tool{n})"),
    (["pkgs/by-name/to/tool{n}/package.nix"], "tool{n}: 1.0 -> 2.{n}"),       # nixpkgs
    (["Formula/t/tool{n}.rb"], "tool{n} 2.{n}.0"),                              # homebrew-core
    (["tool{n}/PKGBUILD"], "tool{n}: new package"),                             # AUR-style
])
def test_package_recipes_are_packaging_work_not_a_catalogue(files, title):
    records = many(lambda n: pr(n, [f.format(n=n) for f in files], title.format(n=n)))
    reading = rk.read(records)
    assert reading.catalogue is None
    assert reading.packaging is not None
    assert reading.packaging.code == "package_updates"
    assert reading.packaging == rk.PACKAGING_LINE


def test_recipes_must_be_most_pull_requests_for_the_line():
    recipes = [r for n in range(1, 11)
               for r in pr(n, [f"packages/tool{n}/build.sh"], f"bump(main/tool{n}): 2.{n}.0")]
    software = [r for n in range(11, 21)
                for r in pr(n, [f"scripts/build/step{n}.sh", "build-package.sh"], "Speed up builds")]
    assert rk.read(recipes + software) == rk.Reading()  # 10 of 20 is not most


def test_the_packaging_line_never_takes_the_last_place_from_a_turn_down():
    reading = rk.Reading(packaging=rk.Rule(rk.PACKAGING_LINE, code="package_updates"))
    turned_down = [rk.Rule("waiting", code="awaiting_reply"), rk.Rule("ignored", code="ignored")]
    out = rk.explain(turned_down, reading, Verdict.NOT_VIABLE)
    assert rule_codes(out) == ["awaiting_reply", "package_updates", "ignored"]
    out = rk.explain([rk.Rule("merges", code="merges")], reading, Verdict.VIABLE)
    assert rule_codes(out) == ["merges", "package_updates"]


def test_a_line_added_to_the_same_markdown_list_is_a_list():
    records = many(lambda n: pr(n, ["readme.md"], f"Add awesome-thing-{n}", additions=1))
    shape = rk.detect(records)
    assert shape is not None
    assert (shape.kind, shape.shape, shape.where) == ("awesome_list", rk.LIST, "readme.md")
    assert "the same list (readme.md)" in shape.rule()


def test_lists_kept_side_by_side_in_one_folder_count_as_one_list():
    # free-programming-books: one list per language in books/.
    records = many(lambda n: pr(n, [f"books/list-{n % 4}.md"], "Add a book", additions=1,
                                deletions=n % 2))
    shape = rk.detect(records)
    assert shape is not None and shape.where == "books/" and shape.kind == "awesome_list"


def test_an_extensionless_list_file_is_a_registry_not_a_list_of_links():
    # hacs/default: one repository per line in a file called `integration`.
    shape = rk.detect(many(lambda n: pr(n, ["integration"], f"Add org/repo{n}", additions=1)))
    assert shape is not None and shape.kind == "registry"


# --- what must not count ---------------------------------------------------------


def test_software_changes_are_not_a_catalogue():
    records = many(lambda n: pr(n, [f"src/app/mod{n % 3}.py", f"tests/test_mod{n % 3}.py"],
                                f"Fix bug {n}", 30, 4))
    assert rk.detect(records) is None


def test_a_single_source_file_per_pull_request_is_not_an_entry():
    # TheAlgorithms/Python: one new algorithm per pull request is still code.
    records = many(lambda n: pr(n, [f"sorts/sort_{n}.py"], f"Add sort_{n} 1.0"))
    assert rk.detect(records) is None


def test_dependency_bumps_in_project_files_are_not_data_entries():
    records = many(lambda n: pr(n, ["package.json", "package-lock.json"], f"Bump lib to 1.{n}", 2, 2))
    assert rk.detect(records) is None


def test_readme_typo_fixes_are_not_list_lines():
    assert rk.detect(many(lambda n: pr(n, ["README.md"], "Fix typo", 1, 1))) is None


def test_documentation_edits_are_not_list_lines():
    records = many(lambda n: pr(n, [f"docs/guide{n % 2}.md"], "Clarify wording", 2))
    assert rk.detect(records) is None


def test_ci_config_is_not_data():
    records = many(lambda n: pr(n, [".github/workflows/ci.yml"], "Tweak CI", 2, 1))
    assert rk.detect(records) is None


def test_too_few_outside_pull_requests_decide_nothing():
    records = many(lambda n: pr(n, [f"domains/u{n}.json"]), count=rk.MIN_ATTEMPTS - 1)
    assert rk.detect(records) is None


def test_insiders_and_bots_are_not_counted():
    insiders = many(lambda n: pr(n, [f"domains/u{n}.json"], association="MEMBER"))
    assert rk.detect(insiders) is None
    bots = many(lambda n: pr(n, [f"domains/u{n}.json"], author=f"update-bot-{n}[bot]"))
    assert rk.detect(bots) is None


def test_a_minority_of_entries_is_not_enough():
    software = [r for n in range(1, 21)
                for r in pr(n, [f"src/m{n}.go", f"src/m{n}_test.go"], f"fix {n}", 40, 3)]
    entries = [r for n in range(21, 31) for r in pr(n, [f"data/e{n}.json"])]
    assert rk.detect(software + entries) is None  # 10 of 30


# --- the free report -------------------------------------------------------------


class ListProvider(FixtureProvider):
    def __init__(self, records):
        super().__init__(Window.PRE_T)
        self._records = records

    def _fetch_raw(self, request, /, **params):
        return list(self._records)

    def _resolve_raw(self, evidence_id):
        return next((r for r in self._records if r.evidence_id == evidence_id), None)


def test_the_free_report_turns_a_registry_down_and_says_why():
    records = many(lambda n: pr(n, [f"domains/user{n}.json"], f"Register user{n}.is-a.dev"))
    provider = ListProvider(records)
    assessment, trace = analyze_without_model(REPO, provider, as_of=T0 + timedelta(days=30))
    assert assessment.verdict is Verdict.NOT_VIABLE
    assert rule_codes(trace.rules) == ["catalogue_shape"]
    assert assessment.bottom_line.startswith("Not worth your time. 12 of the 12 pull requests")
    # Cited to real pull requests, in plain words rather than a field name.
    [claim] = assessment.claims
    assert provider.resolve(claim.evidence_id) is not None
    assert "repo_kind" not in claim.text and "registry" not in claim.text


def test_the_free_report_keeps_a_recipe_repository_worth_it_and_says_what_the_work_is():
    records = many(lambda n: pr(n, [f"pkgs/by-name/to/tool{n}/package.nix"], f"tool{n}: 1.0 -> 2.{n}",
                                reviewed=True))
    assessment, trace = analyze_without_model(REPO, ListProvider(records), as_of=T0 + timedelta(days=30))
    assert assessment.verdict is Verdict.VIABLE
    assert rule_codes(trace.rules)[-1] == "package_updates"
    assert trace.rules[-1] == rk.PACKAGING_LINE
    # The bottom line still gives the reason for the verdict, not the aside.
    assert assessment.bottom_line.startswith("Worth your time. 12 pull requests")
    assert assessment.claims == []


def test_an_archived_catalogue_is_still_turned_down_for_being_archived():
    records = many(lambda n: pr(n, [f"domains/user{n}.json"]))
    records.append(EvidenceRecord(
        evidence_id=f"repo:{REPO}:meta", source="github", url=f"https://github.com/{REPO}",
        timestamp=T0, payload={"is_archived": True},
    ))
    _, trace = analyze_without_model(REPO, ListProvider(records), as_of=T0 + timedelta(days=30))
    assert rule_codes(trace.rules) == ["archived"]


# --- the golden set --------------------------------------------------------------

CATALOGUES = {
    "is-a-dev/register", "microsoft/winget-pkgs", "Homebrew/homebrew-cask",
    "hacs/default", "sindresorhus/awesome", "EbookFoundation/free-programming-books",
    "firstcontributions/first-contributions", "public-apis/public-apis",
}
PACKAGE_SETS = {"NixOS/nixpkgs", "termux/termux-packages"}


def test_on_the_golden_set_the_catalogues_are_flagged_and_nothing_else():
    readings = {repo: rk.read(golden.read_recording(repo)[1]) for repo in golden.load_repos()}
    assert {repo for repo, r in readings.items() if r.catalogue} == CATALOGUES
    assert {repo for repo, r in readings.items() if r.packaging} == PACKAGE_SETS
