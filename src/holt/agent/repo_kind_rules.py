"""Is this repository a catalogue? Decided from the shape of pull requests, no model.

Registries -- is-a-dev/register, Homebrew/homebrew-cask, microsoft/winget-pkgs,
termux/termux-packages -- and curated lists look extremely healthy on every
count Holt makes, precisely because contributing to them is trivial: add your
subdomain's JSON file, bump a version number, add a line to a list. Merges are
many and quick and change no software. Until this module, only the AI report's
Classify stage (`stages.classify`) could tell, so the free report called
is-a-dev "worth your time" and the verdict depended on what the reader paid.

The categories are Classify's (`registry`, `awesome_list`); what decides is
arithmetic over the diffs outside contributors actually sent. Each pull request
is either one catalogue entry or not:

* a data entry: a handful of data files (JSON, YAML, TOML, extensionless
  records...) in one directory, like `domains/alice.json` or winget's three
  manifests for one app version;
* a package entry: the files of one package, in one directory, under a title
  that names that package and a version or says it is new, like
  `bump(main/tgpt): 2.15.0` touching `packages/tgpt/build.sh`;
* a list line: a few lines added or fixed in one or two list files, in a place
  at least five outside pull requests changed, like awesome's `readme.md` or
  free-programming-books' `books/` (one list per language). Documentation
  folders and a README's typo fixes are prose, not lists, and don't count.

A repository is a catalogue when at least `CATALOGUE_SHARE` of its outside
pull requests are entries. Across the golden set (`golden/`) the catalogues sit
at 0.56 to 1.0 and every software project at 0.13 or below (ollama, whose
README lists community integrations); the threshold sits in that gap. The
reason printed to the reader states the count it came from.

The free report uses this (`pipeline.analyze_without_model`). The AI report
still takes Classify's word: overriding it changes the narration prompt, and
the committed `--replay` trajectories for nixpkgs and is-a-dev would need
re-recording with a model.

Only a positive answer is given. A repository that does not look like a
catalogue is not thereby software; the rules simply have nothing to say, and
the arithmetic in `verdict.classify` decides as before.
"""

from __future__ import annotations

import re
from collections import Counter
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import PurePosixPath

from holt.agent.findings import Findings
from holt.agent.signals import looks_like_bot, pr_key
from holt.agent.verdict import Rule
from holt.types import EvidenceRecord

# Insiders are left out: what a catalogue *is* to a newcomer is what newcomers
# send it. A pull request without an association (recorded before evidence v2)
# counts as outside.
INSIDER_ASSOCIATIONS = {"OWNER", "MEMBER", "COLLABORATOR"}

# Below this many outside pull requests with a file list, a share is anecdote.
# homebrew-cask, whose traffic is almost all automation and staff, has 11.
MIN_ATTEMPTS = 10

# See the module docstring for where this sits: catalogues 0.56-1.0, software
# at most 0.13 across the golden set.
CATALOGUE_SHARE = 0.4

# An entry is small. winget's is three manifests; a package with its patches a
# few more. `files` is capped at 20 by the provider, so `changed_files` is what
# is checked.
MAX_ENTRY_FILES = 10

# A list line must land in a file this many outside pull requests changed:
# the list everyone adds to, not a file one person happened to edit.
MIN_LIST_EDITORS = 5
MAX_LIST_FILES = 2
MAX_LIST_LINES = 6

DATA_SUFFIXES = {".json", ".yaml", ".yml", ".toml", ".csv", ".tsv", ".xml", ".plist",
                 ".ini", ".cfg", ".txt"}
MARKDOWN = {".md", ".markdown", ".rst", ".adoc"}
LIST_SUFFIXES = DATA_SUFFIXES | MARKDOWN

# Files that configure a software project rather than list anything: a pull
# request that only bumps a dependency in package.json is maintenance of code.
PROJECT_FILES = {
    "package.json", "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "tsconfig.json",
    "composer.json", "composer.lock", "cargo.toml", "cargo.lock", "pyproject.toml",
    "poetry.lock", "uv.lock", "requirements.txt", "setup.cfg", "tox.ini", "go.mod",
    "go.sum", "gemfile", "gemfile.lock", "makefile", "dockerfile", "build", "workspace",
    "license", "copying", "codeowners", "procfile", "rakefile", "jenkinsfile",
    "changelog.md", "changes.md", "readme.md", "readme.rst", "readme.txt", "readme",
}

# A package entry is a recipe or manifest: a cask or formula (Ruby), a build
# script, a Nix expression, patches. A new source file named in its title --
# `sorts/bubble_sort.py`, "Add bubble sort" -- is code however small it is.
SOURCE_SUFFIXES = {".py", ".js", ".mjs", ".ts", ".tsx", ".jsx", ".go", ".rs", ".c", ".cc",
                   ".cpp", ".h", ".hpp", ".java", ".kt", ".cs", ".swift", ".m", ".php",
                   ".scala", ".dart", ".vue", ".svelte", ".ex", ".exs", ".hs", ".ml", ".zig"}

DOC_DIRS = {"doc", "docs", "documentation", "website", "site"}
PROSE_FILES = {"contributing", "changelog", "changes", "history", "news", "security",
               "code_of_conduct", "license", "authors", "notice"}

# Directory and file names too generic to identify an entry in a title.
_GENERIC = {"build", "package", "default", "index", "main", "init", "src", "lib", "test",
            "tests", "docs", "readme", "manifest", "manifests", "packages", "pkgs"}

_VERSION = re.compile(r"\d+(?:\.\d+)+")
_VERSION_DIR = re.compile(r"^v?\d+(?:[._-]\d+)*[a-z0-9.+-]*$", re.I)
_NEW_ENTRY = re.compile(
    r"\baddpkg\b|\bnew (?:package|cask|formula|manifest)\b"
    r"|\badd(?:s|ed|ing)?\b.{0,40}\b(?:package|cask|formula|manifest)\b",
    re.I,
)

DATA, PACKAGE, LIST = "data", "package", "list"


@dataclass(frozen=True, slots=True)
class Attempt:
    """One outside pull request, as much of it as the shape rules read."""

    key: str
    title: str
    files: tuple[str, ...]
    changed_files: int
    additions: int
    deletions: int


def outside_attempts(records: Iterable[EvidenceRecord]) -> list[Attempt]:
    """Outside, human pull requests with a file list, newest first."""
    out: list[tuple[object, Attempt]] = []
    for r in records:
        if not r.evidence_id.endswith(":opened"):
            continue
        p = r.payload
        if looks_like_bot(p.get("author", ""), bool(p.get("author_is_bot"))):
            continue
        if p.get("author_association") in INSIDER_ASSOCIATIONS:
            continue
        files = tuple(p.get("files") or ())
        if not files:
            continue
        out.append((r.timestamp, Attempt(
            key=pr_key(r.evidence_id),
            title=p.get("title") or "",
            files=files,
            changed_files=max(p.get("changed_files") or 0, len(files)),
            additions=p.get("additions") or 0,
            deletions=p.get("deletions") or 0,
        )))
    out.sort(key=lambda pair: (pair[0], pair[1].key), reverse=True)
    return [a for _, a in out]


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", text.lower())


def _is_project_file(path: str) -> bool:
    parts = PurePosixPath(path).parts
    return (PurePosixPath(path).name.lower() in PROJECT_FILES
            or any(part.startswith(".") for part in parts))


def _is_data(path: str) -> bool:
    if _is_project_file(path):
        return False
    suffix = PurePosixPath(path).suffix.lower()
    return suffix in DATA_SUFFIXES or suffix == ""


def _is_list(path: str) -> bool:
    p = PurePosixPath(path)
    name, suffix = p.name.lower(), p.suffix.lower()
    # A README is often the list itself (awesome lists), so only dependency
    # and config files are excluded by name. Documentation is prose: a typo
    # fixed in a project's docs/ folder is not a line in a list.
    if any(part.startswith(".") for part in p.parts) or name in PROJECT_FILES - {"readme.md", "readme"}:
        return False
    if any(part.lower() in DOC_DIRS for part in p.parts[:-1]):
        return False
    if name.split(".")[0] in PROSE_FILES:
        return False
    return suffix in LIST_SUFFIXES or suffix == ""


def _is_readme(path: str) -> bool:
    return PurePosixPath(path).name.lower().startswith("readme")


def _list_home(path: str) -> str:
    """The list a line belongs to: its directory, as free-programming-books
    keeps one list per language side by side, or the file itself at the root,
    where a directory would lump every top-level file together."""
    parent = str(PurePosixPath(path).parent)
    return path if parent == "." else parent + "/"


def _entry_names(files: tuple[str, ...], directory: str) -> set[str]:
    """What a title would call this entry: the package directory (skipping a
    version directory, as winget's `.../HexPlayer/5.3.0/`) or a file's stem."""
    names = {PurePosixPath(f).name.split(".")[0] for f in files}
    parts = [p for p in directory.split("/") if p]
    while parts and _VERSION_DIR.match(parts[-1]):
        parts.pop()
    if parts:
        names.add(parts[-1])
    return {n for n in map(_norm, names) if len(n) >= 3 and n not in _GENERIC}


def entry_shape(attempt: Attempt, list_editors: Counter[str]) -> str | None:
    """Which kind of catalogue entry this pull request is, or None."""
    files = attempt.files
    if attempt.changed_files > MAX_ENTRY_FILES:
        return None
    directories = {str(PurePosixPath(f).parent) for f in files}
    one_directory = len(directories) == 1 and attempt.changed_files == len(files)

    if one_directory and all(_is_data(f) for f in files):
        return DATA

    directory = next(iter(directories))
    if one_directory and directory != ".":
        title = attempt.title
        names_entry = any(n in _norm(title) for n in _entry_names(files, directory))
        recipe = not any(PurePosixPath(f).suffix.lower() in SOURCE_SUFFIXES for f in files)
        if recipe and names_entry and (_VERSION.search(title) or _NEW_ENTRY.search(title)):
            return PACKAGE

    if (len(files) <= MAX_LIST_FILES and one_directory and all(_is_list(f) for f in files)
            and list_editors[_list_home(files[0])] >= MIN_LIST_EDITORS
            and 1 <= attempt.additions + attempt.deletions
            and attempt.additions <= MAX_LIST_LINES and attempt.deletions <= MAX_LIST_LINES
            # A README is a list only when lines are added to it; a one-word
            # fix to a project's README is not a listing.
            and (attempt.deletions == 0 or not any(_is_readme(f) for f in files))):
        return LIST
    return None


@dataclass(frozen=True, slots=True)
class CatalogueShape:
    """The measured case that a repository is a catalogue."""

    kind: str  # one of Classify's REPO_KINDS: "registry" or "awesome_list"
    shape: str  # the commonest entry shape: DATA, PACKAGE or LIST
    entries: int
    attempts: int
    where: str  # where entries land: "domains/", "Casks/", "readme.md"
    examples: tuple[str, ...]  # evidence ids of entry pull requests, newest first

    @property
    def share(self) -> float:
        return self.entries / self.attempts

    def rule(self) -> Rule:
        """The sentence the reader sees under "What decided it"."""
        counted = (f"{self.entries} of the {self.attempts} pull requests from outside "
                   "contributors we looked at")
        folder = self.where.endswith("/")
        doing = {
            DATA: "add or edit one small data file "
                  + (f"in the {self.where} folder" if folder else f"({self.where})")
                  + ", like one entry in a catalogue",
            PACKAGE: "add or update a single package"
                     + (f" in the {self.where} folder" if folder else "")
                     + ", such as a new version number",
            LIST: "add or fix a line or two in "
                  + (f"a list in the {self.where} folder" if folder
                     else f"the same list ({self.where})"),
        }[self.shape]
        return Rule(
            f"{counted} {doing}. Getting a change like that merged isn't a "
            "software contribution.",
            code="catalogue_shape",
            # The wording the non-software rule was recorded with, so a
            # narration prompt handed this trace matches one where the AI had
            # reached the same kind (see `verdict.legacy_trace`).
            legacy=f"repo_kind={self.kind}: merged work here is not a software contribution",
        )

    def note(self) -> str:
        return (f"{self.entries} of {self.attempts} outside pull requests are single "
                "catalogue entries; this is one of them")


def detect(records: Iterable[EvidenceRecord]) -> CatalogueShape | None:
    """The catalogue case from the evidence, or None if there isn't one."""
    attempts = outside_attempts(records)
    if len(attempts) < MIN_ATTEMPTS:
        return None
    list_editors = Counter(home for a in attempts for home in {_list_home(f) for f in a.files})
    shaped = [(a, s) for a in attempts if (s := entry_shape(a, list_editors))]
    if len(shaped) < CATALOGUE_SHARE * len(attempts):
        return None

    shape = Counter(s for _, s in shaped).most_common(1)[0][0]
    of_shape = [a for a, s in shaped if s == shape]
    if shape == LIST:
        where = Counter(_list_home(a.files[0]) for a in of_shape).most_common(1)[0][0]
    else:
        roots = Counter(
            (a.files[0].split("/")[0] + "/") if "/" in a.files[0] else a.files[0]
            for a in of_shape
        )
        where = roots.most_common(1)[0][0]
    # A list of links reads as one; a list of anything else (hacs's list of
    # repositories, a list of names) is a registry of entries.
    markdown = sum(PurePosixPath(a.files[0]).suffix.lower() in MARKDOWN for a in of_shape)
    kind = "awesome_list" if shape == LIST and markdown * 2 > len(of_shape) else "registry"
    return CatalogueShape(
        kind=kind,
        shape=shape,
        entries=len(shaped),
        attempts=len(attempts),
        where=where,
        examples=tuple(f"{a.key}:opened" for a in of_shape[:3]),
    )


def add_finding(findings: Findings, shape: CatalogueShape) -> None:
    """Record the kind as a finding, cited to example entries, in place of any
    kind already there."""
    findings.drop("repo_kind")
    findings.add("repo_kind", shape.kind, shape.examples, shape.note())


def explain(rules: list[str], shape: CatalogueShape | None) -> list[str]:
    """Swap the generic "this is a catalogue" sentence for the measured one."""
    if shape is None:
        return rules
    return [shape.rule() if getattr(r, "code", "") == "non_software_kind" else r
            for r in rules]
