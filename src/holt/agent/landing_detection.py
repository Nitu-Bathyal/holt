"""Pull requests that landed without GitHub's merge button, and repositories
where pull requests are not the way in.

GitHub marks a pull request "merged" only when its own button (or API) did the
merging. Plenty of projects land accepted work some other way, and every one of
those pull requests reads as *closed, not merged*:

* a merge bot or an internal sync lands the change as a commit and the commit
  closes the pull request (pytorchmergebot, Meta's meta-codesync and
  facebook-github-bot, Google's Copybara);
* the change goes through another review system and a bot closes the pull
  request once it lands there (Go's Gerrit via gopherbot, Git's mailing list
  via GitGitGadget);
* a maintainer applies the commits by hand, then closes the pull request with
  "Merged to 3.4. Thank you!" (OpenSSL);
* the project labels it `Merged`.

Counted as rejections, these made react-native, pytorch, openssl and Go look
like places where nothing from outside ever lands, which is the opposite of the
truth. `classify` reads each closed pull request and says which of the three it
was -- merged, landed another way (and how), or closed without landing -- and
`mark_landed` folds the second kind into the threads every count is built from.

What is deliberately *not* read as a landing: a commit in this repository that
merely mentions the pull request (a `:reference:` record). A commit on a work
branch mentions it too, and so does a maintainer's rewrite that replaces it.
A commit that *closes* the pull request is different: GitHub only records one
as the closer when it reached the default branch.

`elsewhere` is the repository-level half: a mirror, or a fork, is a place where
a pull request is not how you contribute, and rules mode now says so and where
to go instead.

No model runs here. Everything is read from recorded GitHub fields and fixed
patterns, so the same evidence always gives the same answer.
"""

from __future__ import annotations

import re
from collections import Counter
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from holt.agent import people
from holt.types import EvidenceRecord

if TYPE_CHECKING:
    from holt.agent.signals import Thread

MERGED = "merged"
LANDED = "landed"
CLOSED = "closed"

# How an off-button landing happened, and the phrase a reader sees for it. The
# phrase completes "landed ...". Plain words, no bot names: a beginner does not
# need to know what meta-codesync is to understand that Meta copied the change
# in from its own systems.
VIA = {
    "gerrit": "through Gerrit, the project's own code review site",
    "mailing_list": "through the project's mailing list",
    "internal_sync": "through the company's internal code sync",
    "merge_bot": "by the project's merge bot",
    "commit": "by a maintainer's commit",
    "comment": "by hand, as a maintainer said when closing it",
    "label": "as the project's 'merged' label says",
}

# Accounts whose closing a pull request *with a commit* names how it landed.
# Anything else that looks like a bot is a generic merge bot; a person closing
# with a commit is a maintainer pushing it themselves.
_CLOSER_ACCOUNTS = {
    "pytorchmergebot": "merge_bot",
    "bors": "merge_bot",
    "bors-servo": "merge_bot",
    "rust-bors": "merge_bot",
    "homu": "merge_bot",
    "mergify": "merge_bot",
    "k8s-ci-robot": "merge_bot",
    "openshift-merge-robot": "merge_bot",
    "meta-codesync": "internal_sync",
    "facebook-github-bot": "internal_sync",
    "copybara-service": "internal_sync",
    "gopherbot": "gerrit",
    "gitgitgadget": "mailing_list",
    "gitgitgadget-git": "mailing_list",
}

# What a bot writes when the change it was carrying has landed elsewhere. Each
# of these is that bot's fixed wording, checked against the golden recordings;
# a new one belongs here only with a recording that shows it.
_BOT_SIGNATURES: tuple[tuple[str, re.Pattern[str]], ...] = (
    # gopherbot: "This PR is being closed because golang.org/cl/794361 has been merged."
    ("gerrit", re.compile(r"\bclosed because \S*golang\.org/cl/\d+\S* has been merged\b", re.I)),
    # GitGitGadget: "This patch series was integrated into master via <url>" and
    # "Your patch series was merged into upstream via <sha>". Integration into
    # `seen` or `next` is a step on the way, not a landing.
    ("mailing_list", re.compile(
        r"\b(?:integrated into (?:master|main)|merged into upstream) via\b", re.I)),
    # facebook-github-bot: "@someone merged this pull request in <sha>."
    # meta-codesync: "This pull request has been merged in react/react-native@<sha>."
    ("internal_sync", re.compile(
        r"\bmerged this pull request in [0-9a-f]{7,40}\b|"
        r"\bthis pull request has been merged in \S*?[0-9a-f]{7,40}\b", re.I)),
    # bors/homu: "Test successful ... Pushing <sha> to master..."
    ("merge_bot", re.compile(r"\bpushing [0-9a-f]{7,40} to (?:master|main|trunk)\b", re.I)),
)

# A maintainer saying the work is in: "Merged to 3.4. Thank you!", "merged in
# 1a2b3c4", "Landed in main", "Applied as abc123, thanks", "Merged to all the
# active branches as appropriate.", "Thanks, merged.", "## Merged onto master",
# "Merged (only the last commit) to 3.5.", "Merged directly", "This was merged
# already.", "These changes landed: <link>". Anchored to the start of a line
# (after an optional heading mark or thank-you), so "once this is merged in
# main we can" and "I think this should be merged to 3.x" do not count.
_SAID_LANDED = re.compile(
    r"^\s*(?:#+\s*|>\s*|\*+\s*)?"
    r"(?:(?:thanks?|thank you|ty)\b[!,.]*\s*(?:again\s*)?[!,.]*\s*)?"
    r"(?:(?:i've|i have|we've|we have|now|"
    r"(?:this|these|the)(?: changes?| pr| pull request| patch(?:es)?)?"
    r"(?: was| were| has been| have been| is now| is| are)?)\s+)?"
    r"(?:merged|landed|applied|pushed|committed|cherry-?picked)\b"
    r"(?:\s+(?:manually|by hand|directly|already|locally|upstream)\b"
    r"|(?:\s*\([^)\n]*\))?(?:\s*[.!:]|\s*$|\s*,\s*thank|\s+(?:to|in|into|on|onto|as|via)\b))",
    re.I | re.M,
)

# ...unless it says the work went somewhere else, or did not go in at all.
# "Merged in #1234 instead" is a different pull request landing, not this one.
_NOT_THIS_ONE = re.compile(
    r"\b(?:instead|supersed\w*|duplicate|not merged|won't|will not|reverted|"
    r"another (?:pr|pull request)|different (?:pr|pull request))\b|#\d+",
    re.I,
)

# Labels a project puts on a pull request that landed. Exact names only: a label
# such as "approval: ready to merge" or "merge conflict" says nothing of the kind.
_LANDED_LABELS = {"merged", "landed", "merged upstream", "merged-upstream",
                  "merged internally", "merged manually"}
# ...and what undoes it: the label, or the sync bot's "This pull request has
# been **reverted** by <sha>." Work that went in and came back out did not land.
_REVERTED_LABELS = {"reverted"}
_REVERTED = re.compile(r"\bthis pull request has been \**reverted\**\b", re.I)



@dataclass(frozen=True, slots=True)
class Closure:
    """How one pull request ended: merged, landed another way, or closed.

    `how` is a key of VIA for a landing, `why` the plain sentence behind it,
    and `evidence_id` the record that shows it (the close, or the comment).
    """

    outcome: str
    how: str = ""
    why: str = ""
    evidence_id: str = ""

    @property
    def via(self) -> str:
        return VIA.get(self.how, "")


def _key(evidence_id: str) -> str:
    return ":".join(evidence_id.split(":")[:2])


def _looks_automated(login: str) -> bool:
    low = (login or "").lower()
    return low.endswith("[bot]") or low.endswith("bot") or "-bot" in low or low in _CLOSER_ACCOUNTS


def _account(login: str | None) -> str:
    return (login or "").lower().removesuffix("[bot]")


def _said_landed(body: str) -> str | None:
    """The line where someone says this pull request landed, or None."""
    for match in _SAID_LANDED.finditer(body or ""):
        line_end = body.find("\n", match.start())
        line = body[match.start(): None if line_end < 0 else line_end]
        if not _NOT_THIS_ONE.search(line):
            return line.strip()
    return None


def _may_say_landed(comment: dict[str, Any], author: str, closed_by: str | None,
                    team: frozenset[str]) -> bool:
    """Whether this person's "merged" can mean the pull request landed.

    Whoever closed it, or anyone on the project's team (`people.maintainers`,
    the same team every other count uses: OpenSSL's release managers read as
    CONTRIBUTOR but merge and close other people's pull requests). Strangers
    cannot land anything, whatever they write, and nor can an author on their
    own pull request unless they could have pushed it themselves.
    """
    who = comment.get("author") or ""
    if not who or comment.get("author_is_bot") or _looks_automated(who):
        return False
    if who == closed_by:
        return True
    assoc = comment.get("author_association")
    if assoc is None and who != author:
        # Older captures carry no association at all; a reply from anyone other
        # than the author is the best that evidence can say.
        return True
    return who in team or assoc in people.MAINTAINER_ASSOCIATIONS


def _classify_one(opened: EvidenceRecord | None, end: EvidenceRecord | None,
                  talk: list[EvidenceRecord], team: frozenset[str]) -> Closure | None:
    if end is None:
        return None  # still open
    if end.evidence_id.endswith(":merged"):
        return Closure(MERGED, evidence_id=end.evidence_id)

    close = end.payload
    labels = {str(n).strip().lower() for n in (opened.payload.get("labels") or [])} \
        if opened else set()
    closed = Closure(CLOSED, evidence_id=end.evidence_id)
    if labels & _REVERTED_LABELS or any(
        _REVERTED.search(r.payload.get("body") or "") for r in talk
    ):
        return closed  # it went in and came back out

    author = close.get("author") or (opened.payload.get("author") if opened else "") or ""
    closed_by = close.get("closed_by")
    closer = close.get("closer") or {}

    # A bot's own "this landed" notice is the most specific account there is.
    for r in talk:
        body = r.payload.get("body") or ""
        if (r.payload.get("author") or "") == author and not _looks_automated(author):
            continue
        for how, pattern in _BOT_SIGNATURES:
            if pattern.search(body):
                who = r.payload.get("author") or "a bot"
                return Closure(LANDED, how, f"{who} wrote: {_first_line(pattern, body)}",
                               r.evidence_id)

    if closer.get("kind") == "commit":
        account = _account(closed_by)
        how = _CLOSER_ACCOUNTS.get(account) or (
            "merge_bot" if _looks_automated(account) else "commit")
        sha = (closer.get("oid") or "")[:10]
        who = closed_by or "someone"
        return Closure(LANDED, how,
                       f"closed by commit {sha} in this repository ({who} closed it)",
                       end.evidence_id)

    for r in reversed(talk):  # the closing remark is usually the last one
        if not _may_say_landed(r.payload, author, closed_by, team):
            continue
        if line := _said_landed(r.payload.get("body") or ""):
            return Closure(LANDED, "comment",
                           f"{r.payload.get('author')} wrote: “{_clip(line)}”", r.evidence_id)

    if labels & _LANDED_LABELS:
        name = next(n for n in (opened.payload.get("labels") or [])
                    if str(n).strip().lower() in _LANDED_LABELS)
        return Closure(LANDED, "label", f"labelled “{name}”",
                       opened.evidence_id if opened else end.evidence_id)

    return closed


def _first_line(pattern: re.Pattern[str], body: str) -> str:
    match = pattern.search(body)
    start = body.rfind("\n", 0, match.start()) + 1
    end = body.find("\n", match.end())
    return "“" + _clip(body[start: None if end < 0 else end].strip()) + "”"


_MD_LINK = re.compile(r"\[([^\]\n]+)\]\([^)\s]+\)")


def _clip(text: str, limit: int = 120) -> str:
    """One line of someone's words for a reader: links reduced to their text."""
    text = " ".join(_MD_LINK.sub(r"\1", text).split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def classify(records: Iterable[EvidenceRecord],
             team: frozenset[str] | None = None) -> dict[str, Closure]:
    """How every finished pull request in `records` ended, keyed `pr:owner/repo#N`.

    `team` is `people.maintainers(records)`, worked out here when not given.

    Open pull requests are left out. Comments and reviews after the close are
    read too: the bots write their notice as they close, and a maintainer's
    "merged to 3.4" often lands a second after the close event.
    """
    records = list(records)
    if team is None:
        team = people.maintainers(records)
    opened: dict[str, EvidenceRecord] = {}
    ends: dict[str, EvidenceRecord] = {}
    talk: dict[str, list[EvidenceRecord]] = {}
    for r in records:
        eid = r.evidence_id
        if not eid.startswith("pr:"):
            continue
        key = _key(eid)
        if eid.endswith(":opened"):
            opened[key] = r
        elif eid.endswith(":merged"):
            ends[key] = r
        elif eid.endswith(":closed"):
            ends.setdefault(key, r)
        elif ":comment:" in eid or ":review:" in eid:
            talk.setdefault(key, []).append(r)

    out: dict[str, Closure] = {}
    for key, end in ends.items():
        said = sorted(talk.get(key, []), key=lambda r: (r.timestamp is None, r.timestamp))
        closure = _classify_one(opened.get(key), end, said, team)
        if closure is not None:
            out[key] = closure
    return out


def mark_landed(threads: Mapping[str, Thread], records: Iterable[EvidenceRecord]) -> None:
    """Count pull requests that landed another way as merged, noting how."""
    for key, closure in classify(records, getattr(threads, "team", None)).items():
        thread = threads.get(key)
        if closure.outcome == LANDED and thread is not None and not thread.merged:
            thread.merged = True
            thread.closed_unmerged = False
            thread.landed_via = closure.how


def landed_sentence(threads: Iterable[Thread]) -> str | None:
    """The plain line saying how many merges happened off the button, and how.

    Given the outsider threads a verdict was computed from; None when every
    merge among them went through GitHub's merge button.
    """
    merged = [t for t in threads if t.merged]
    off = Counter(t.landed_via for t in merged if t.landed_via)
    if not off:
        return None
    total = sum(off.values())
    ways = [f"{VIA[how]} ({n})" if len(off) > 1 else VIA[how]
            for how, n in off.most_common()]
    how = ways[0] if len(ways) == 1 else ", ".join(ways[:-1]) + " and " + ways[-1]
    of = "All" if total == len(merged) else f"{total} of the {len(merged)}"
    if total == 1 and len(merged) == 1:
        return (f"That pull request was landed {how}, so GitHub shows it as closed "
                "rather than merged. It's counted as merged here.")
    return (f"{of} merged pull requests from outside contributors were landed {how}, so GitHub "
            "shows them as closed rather than merged. They're counted as merged here.")


# --- repositories where a pull request is not the way in ------------------------

# A description that calls the repository a mirror, as a noun: "BusyBox mirror",
# "The official mirror of the V8 Git repository", "Git Source Code Mirror - ...".
# Not "Mirror your screen to a TV", which is a verb and a product.
_MIRROR_WORDS = re.compile(
    r"\bmirror\s+(?:of|for)\b|\b(?:official|unofficial|read-only|readonly|git|svn|"
    r"source code|github|cvs|mercurial|hg)\s+mirror\b|\bmirror\s*(?:$|[-–—:(,.;])|"
    r"\bis a mirror\b",
    re.I,
)


def _where(url: str | None) -> str | None:
    url = (url or "").strip()
    return url if url.startswith(("http://", "https://")) else None


def elsewhere(meta: Mapping[str, Any] | None, outsider_merged: int) -> str | None:
    """Why pull requests to this repository are not how you contribute, or None.

    Returns the sentence the reader sees. A GitHub-flagged mirror is decisive on
    its own, like archived: GitHub copies it from somewhere else. A description
    that calls itself a mirror, or a fork of another repository, is only taken
    at its word when no outsider's work landed here in the sample; a fork that
    merges outsiders is a project in its own right.
    """
    meta = meta or {}
    if meta.get("is_mirror"):
        where = _where(meta.get("mirror_url")) or _where(meta.get("homepage_url"))
        return ("GitHub marks this repository as a mirror: a copy of a project "
                "developed somewhere else, so pull requests here aren't how you "
                "contribute." + (f" Contributions happen at {where}." if where else ""))
    if outsider_merged:
        return None
    if _MIRROR_WORDS.search(meta.get("description") or ""):
        where = _where(meta.get("homepage_url"))
        return ("This repository describes itself as a mirror, and no pull request "
                "from an outside contributor landed here in the period we looked at, so pull "
                "requests here likely aren't how you contribute."
                + (f" The project's own site is {where}." if where else ""))
    parent = meta.get("parent")
    if meta.get("is_fork") and parent:
        return (f"This repository is a fork of {parent}, and no pull request from an "
                "outside contributor landed here in the period we looked at. Contributions "
                f"usually go to https://github.com/{parent} instead.")
    return None
