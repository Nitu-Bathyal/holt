"""Personalised contribution discovery: what should *this* person do next here?

The ranking is arithmetic. The model does not order anything.

That separation is the point rather than an implementation detail. `find_paths`,
the prototype this replaces, put the whole ranking inside one prompt, so when it
failed to beat GitHub's `good first issue` label there was no way to see *why* --
whether it was ignoring contributor history, weighting the wrong thing, or simply
guessing. Here every rank is a weighted sum of named features, `explain()` prints
the vector that produced it, and the model appears in exactly two places that
cannot move a result:

  * `profile()` -- one call per contributor, turning their merged pull requests
    and the review feedback on them into a competence profile. It feeds exactly
    one feature term out of eight.
  * `describe()` -- prose for the top few, after the order is fixed.

`holt_arith` (no model at all) against `holt_full` (with the profile term) is
therefore a clean measurement of whether the model adds anything over arithmetic.

Weights are fixed in `eval/PREREGISTRATION-3.md`, written before this file
existed, and are never fitted to the outcome.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from holt.model import ModelClient
from holt.report import cite
from holt.types import EvidenceRecord

# Fixed in the pre-registration. Changing one is an experiment, not a tweak.
WEIGHTS = {
    "file_hit": 3.0,
    "profile_hit": 2.5,
    "dir_hit": 2.0,
    "thread_reviewer": 1.5,
    "lang_hit": 1.0,
    "scope_step": 1.0,
    "actionable": 0.5,
    "discussion": 0.5,
}

# A path-ish token: something with an extension, or something with a slash.
PATH_TOKEN = re.compile(r"[\w][\w.-]*\.[A-Za-z][A-Za-z0-9]{0,4}\b|[\w][\w.-]*(?:/[\w.-]+)+")
MAX_ISSUE_TEXT = 4000

# Size bands. Declared here rather than tuned: a contributor who has been landing
# ~20-line changes is not obviously ready for a 2,000-line one, and "one band up"
# is the step this feature is meant to reward.
PR_BANDS = (50, 500)
ISSUE_BANDS = (300, 1200)


def _band(value: int, edges: tuple[int, int]) -> int:
    return sum(1 for edge in edges if value >= edge)


def paths_in(record: EvidenceRecord) -> set[str]:
    text = f"{record.payload.get('title') or ''} {record.payload.get('body') or ''}"
    return set(PATH_TOKEN.findall(text[:MAX_ISSUE_TEXT]))


def _dirs(files: set[str]) -> set[str]:
    return {f.rsplit("/", 1)[0] for f in files if "/" in f}


def _exts(names: set[str]) -> set[str]:
    return {n.rsplit(".", 1)[-1].lower() for n in names if "." in n}


@dataclass
class Profile:
    """What the contributor has demonstrably worked on. Optional by design."""

    areas: list[str] = field(default_factory=list)
    skills: list[str] = field(default_factory=list)
    ready_for: str = ""

    def terms(self) -> set[str]:
        # Short tokens match everything; they would make the feature fire on all
        # issues and quietly become a constant.
        return {t.lower() for t in (*self.areas, *self.skills) if len(t) >= 4}


@dataclass
class Contributor:
    """Everything the ranker is allowed to know, all of it from before the cutoff."""

    login: str
    files: set[str]
    median_pr_size: int
    engaged_with: set[str]
    merged_count: int
    profile: Profile | None = None


def features(contributor: Contributor, issue: EvidenceRecord) -> dict[str, float]:
    """The whole ranking signal, as named numbers a reader can check."""
    named = paths_in(issue)
    payload = issue.payload
    text = f"{payload.get('title') or ''} {payload.get('body') or ''}".lower()

    theirs = contributor.files
    their_dirs = _dirs(theirs)
    their_base = {f.rsplit("/", 1)[-1] for f in theirs}

    file_hit = any(
        p in theirs or p.rsplit("/", 1)[-1] in their_base or any(p.endswith(f) or f.endswith(p) for f in theirs)
        for p in named
    )
    dir_hit = any(
        any(d and (p.startswith(d + "/") or d in p) for d in their_dirs) for p in named
    )
    lang_hit = bool(_exts(named) & _exts(theirs))

    issue_band = _band(len(payload.get("body") or ""), ISSUE_BANDS)
    their_band = _band(contributor.median_pr_size, PR_BANDS)

    profile_hit = 0.0
    if contributor.profile:
        profile_hit = float(any(term in text for term in contributor.profile.terms()))

    return {
        "file_hit": float(file_hit),
        "profile_hit": profile_hit,
        "dir_hit": float(dir_hit),
        # The pre-registration wrote this as "someone who reviewed their work is
        # active on this issue". Captured issues carry the author but not the
        # commenters, so it is narrowed to the author. Recorded rather than
        # silently redefined.
        "thread_reviewer": float(payload.get("author") in contributor.engaged_with),
        "lang_hit": float(lang_hit),
        "scope_step": float(issue_band in (their_band, their_band + 1)),
        "actionable": float(bool(named)),
        "discussion": min(payload.get("comments", 0), 5) / 5.0,
    }


# Amendment 1. Three of the eight registered features fire on 66-83% of all
# candidates with lift at or below 1.11 -- they are constants, not features, and
# together they outweigh `dir_hit` entirely. The drop rule ("fires on >50% of
# candidates AND lift < 1.15") is a property of a feature's own distribution, was
# fitted on pool 1 alone, and changes no weight. See `eval/PREREGISTRATION-3.md`.
NEAR_CONSTANT = ("scope_step", "actionable", "discussion")
REPAIRED_WEIGHTS = {k: v for k, v in WEIGHTS.items() if k not in NEAR_CONSTANT}


def score(vector: dict[str, float], weights: dict[str, float] | None = None) -> float:
    w = weights if weights is not None else WEIGHTS
    return sum(w[k] * v for k, v in vector.items() if k in w)


def rank(
    contributor: Contributor,
    issues: dict[str, EvidenceRecord],
    weights: dict[str, float] | None = None,
) -> list[tuple[str, float, dict[str, float]]]:
    """Best first. Deterministic, no model, ties broken by recency."""
    scored = []
    for key, issue in issues.items():
        vector = features(contributor, issue)
        scored.append((key, score(vector, weights), vector, issue.timestamp))
    scored.sort(key=lambda row: (-row[1], -row[3].timestamp()))
    return [(key, value, vector) for key, value, vector, _ in scored]


def explain(vector: dict[str, float], weights: dict[str, float] | None = None) -> str:
    """Why this ranked where it did — the numbers, not a paragraph about them."""
    w = weights if weights is not None else WEIGHTS
    live = [(k, v) for k, v in vector.items() if v and k in w]
    if not live:
        return "no features fired"
    return "  ".join(f"{k}={v:.2g}×{w[k]}" for k, v in live) + f"  = {score(vector, w):.2f}"


# What `holt next` may claim about this ranking, verbatim in the output. The
# elaborate weighted scorer above was cut for failing to beat this rule
# (hit@10 0.211 against 0.234 across 128 pairs); the rule ships because it is
# the best of five methods tried, and the output says how weak that is because
# the 95% interval of its lead over chance, [-0.003, +0.132], spans zero.
# Measured by eval/progression_harness.py; per-pair rows in
# eval/progression_results.json. The numbers stay here and in the research
# docs; the reader gets them in plain words.
NEXT_MEASUREMENT = (
    "Ranked by one fixed rule: open issues that name a file or folder you've "
    "already worked on here come first, newest first, then the rest by how "
    "recent they are. We tested it against four other ways of ordering issues "
    "and it did best, but not by enough to be sure it beats a random order, so "
    "treat the order as a rough guide."
)


def overlap_tokens(files: set[str], issue: EvidenceRecord) -> set[str]:
    """The path-ish tokens in an issue that name something this person touched.

    Kept identical to the `overlaps` predicate the harness measured
    (eval/progression_harness.py); shipping a different rule under the measured
    rule's numbers would be the exact overclaim this project exists to avoid.
    """
    named = paths_in(issue)
    dirs = _dirs(files)
    return {
        p for p in named
        if p in files
        or any(p.endswith(f) or f.endswith(p) for f in files)
        or any(d and d in p for d in dirs)
    }


def path_overlap_rank(
    files: set[str], issues: dict[str, EvidenceRecord]
) -> list[tuple[str, set[str]]]:
    """Best first: overlapping issues in recency order, then the rest.

    Returns each key with the tokens that matched, so the renderer can show
    *why* a row is where it is instead of asserting that it belongs there.
    """
    recency = sorted(issues.items(), key=lambda kv: kv[1].timestamp, reverse=True)
    matched = [(k, toks) for k, r in recency if (toks := overlap_tokens(files, r))]
    rest = [(k, set()) for k, r in recency if not overlap_tokens(files, r)]
    return matched + rest


def history_for(login: str, threads) -> Contributor:
    """What this person has demonstrably done here, from pre-cutoff threads."""
    import statistics as _stats

    merged = [t for t in threads.values() if t.merged and t.author == login]
    files = {f for t in merged for f in t.files}
    sizes = [t.additions + t.deletions for t in merged]
    engaged = {who for t in threads.values() if t.author == login
               for _, who, _ in t.responses if who != login}
    return Contributor(
        login=login,
        files=files,
        median_pr_size=int(_stats.median(sizes)) if sizes else 0,
        engaged_with=engaged,
        merged_count=len(merged),
    )


def render_next(
    repo: str,
    contributor: Contributor,
    ranked: list[tuple[str, set[str]]],
    issues: dict[str, EvidenceRecord],
    top: int = 10,
) -> str:
    """The measurement is emitted here, in the only path that prints the
    ranking, so no caller can show the order without the number that says how
    well it works."""
    lines = [f"# What to look at next in {repo} — for `{contributor.login}`", ""]
    lines += [
        f"You have {contributor.merged_count} merged pull request"
        f"{'s' if contributor.merged_count != 1 else ''} here, touching "
        f"{len(contributor.files)} file{'s' if len(contributor.files) != 1 else ''}.",
        "",
        NEXT_MEASUREMENT,
        "",
    ]
    for key, tokens in ranked[:top]:
        issue = issues[key]
        title = issue.payload.get("title") or "(untitled)"
        lines.append(f"- **{title}** — {cite(issue.evidence_id)}")
        if tokens:
            shown = ", ".join(f"`{t}`" for t in sorted(tokens)[:4])
            lines.append(f"  names {shown} — work you have already touched")
        else:
            lines.append("  no overlap with your history; ranked by recency only")
    return "\n".join(lines).rstrip() + "\n"


PROFILE_SYSTEM = """You are reading one contributor's merged pull requests in a
single repository, together with what reviewers said to them.

Describe what this person has **demonstrably** worked on. Not what they might be
good at, and not a compliment: only what the merged work and the review feedback
actually show.

  * areas: parts of the project they have touched. Use the vocabulary of the
    repository itself -- directory names, subsystem names, feature names.
  * skills: what kind of work they did. "packaging", "test fixtures",
    "documentation", "API endpoints", "build configuration".
  * ready_for: one sentence on the next step up in scope that their history
    supports. Be specific and be conservative; if the history is thin, say so.

If two merged pull requests are all you have, say what those two show and nothing
more."""

PROFILE_SCHEMA = {
    "type": "object",
    "properties": {
        "areas": {"type": "array", "items": {"type": "string"}},
        "skills": {"type": "array", "items": {"type": "string"}},
        "ready_for": {"type": "string"},
    },
    "required": ["areas", "skills", "ready_for"],
    "additionalProperties": False,
}

MAX_PRS_SHOWN = 12


def profile(repo: str, login: str, merged_prs: list[dict], model: ModelClient) -> Profile:
    """One call. Feeds one feature term out of eight; cannot reorder anything."""
    if not merged_prs:
        return Profile()
    # Title breaks size ties: without it the order depends on how the caller
    # happened to iterate, and the same contributor yields a different prompt on
    # a different run.
    shown = sorted(
        merged_prs,
        key=lambda p: (-((p.get("additions") or 0) + (p.get("deletions") or 0)),
                       p.get("title") or ""),
    )[:MAX_PRS_SHOWN]
    lines = []
    for pr in shown:
        files = pr.get("files") or []
        lines.append(
            f"--- {pr.get('title')}\n"
            f"    {pr.get('changed_files', len(files))} files, "
            f"+{pr.get('additions', 0)}/-{pr.get('deletions', 0)}\n"
            f"    touched: {', '.join(files[:12]) or '(file list unavailable)'}\n"
            f"    reviewers said: {'; '.join(pr.get('_responders') or []) or '(nobody replied)'}"
        )
    result = model.complete(
        label="profile",
        system=PROFILE_SYSTEM,
        prompt=f"Repository: {repo}\nContributor: {login}\n\n"
               f"Their merged pull requests ({len(shown)} of {len(merged_prs)}):\n\n"
               + "\n".join(lines),
        schema=PROFILE_SCHEMA,
    )
    return Profile(result["areas"], result["skills"], result["ready_for"])


DESCRIBE_SYSTEM = """You are told which open issues a contributor should look at
next, and why each one scored where it did. **The order is already decided and you
must not change it.**

For each, write one sentence: what they would concretely do, and how it builds on
what they have already merged here. Refer to their actual past work.

Do not say an issue is easy. Do not promise it will be merged. If the connection
to their history is weak, say that instead of inventing one."""

DESCRIBE_SCHEMA = {
    "type": "object",
    "properties": {
        "steps": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "evidence_id": {"type": "string"},
                    "next_step": {"type": "string"},
                },
                "required": ["evidence_id", "next_step"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["steps"],
    "additionalProperties": False,
}


def describe(
    repo: str,
    contributor: Contributor,
    ranked: list[tuple[str, float, dict[str, float]]],
    issues: dict[str, EvidenceRecord],
    model: ModelClient,
    limit: int = 5,
) -> list[dict]:
    """Prose for an order that is already fixed."""
    top = ranked[:limit]
    if not top:
        return []
    blocks = []
    for key, _, vector in top:
        issue = issues[key]
        body = " ".join((issue.payload.get("body") or "").split())[:500]
        blocks.append(
            f"--- evidence id: {issue.evidence_id}\n"
            f"    title: {issue.payload.get('title')}\n"
            f"    why it ranked here: {explain(vector)}\n"
            f"    {body or '(no description)'}"
        )
    past = sorted(contributor.files)[:20]
    prof = contributor.profile
    return model.complete(
        label="describe",
        system=DESCRIBE_SYSTEM,
        prompt=(
            f"Repository: {repo}\nContributor: {contributor.login}\n"
            f"They have merged {contributor.merged_count} pull request(s) here, "
            f"median size {contributor.median_pr_size} lines.\n"
            f"Files they have touched: {', '.join(past) or '(unknown)'}\n"
            + (f"Demonstrated areas: {', '.join(prof.areas)}\n"
               f"Demonstrated skills: {', '.join(prof.skills)}\n" if prof else "")
            + "\nThe issues, in the order they must stay in:\n\n"
            + "\n".join(blocks)
        ),
        schema=DESCRIBE_SCHEMA,
    )["steps"]
