"""Where outsider work actually landed, and where it never did.

Every pull request Holt reads carries its file list. Until now that list was used
for exactly one thing -- deciding whether a diff was substantial enough to count
-- and then discarded. This counts it instead.

The output is the sentence a newcomer most needs and cannot get anywhere:
*in a tree of two hundred thousand files, these three directories are where
strangers' work has actually been merged, and these are where strangers tried and
never succeeded.* GitHub does not show it, CONTRIBUTING does not say it, and it is
not inferable from stars, issue labels or commit frequency.

**It ranks nothing and predicts nothing.** After five capabilities cut for losing
to a cheap comparator, that is deliberate: there is no ordering to be beaten here,
only a count of what happened. Arithmetic over evidence already in hand, no model
call, and nothing that could disagree with the verdict.

Read `attempted but never landed` carefully -- it is a description of this
sample, not a prohibition. A directory can appear there because outsiders are
turned away from it, or because only two people ever tried.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass

from holt.agent.signals import Thread, outsider_threads

# Two path segments. One is too coarse to act on in a monorepo (`pkgs`, `src`);
# three splits the same area into a dozen near-identical rows.
DEPTH = 2
MIN_ATTEMPTS = 2
TOP_N = 4

# When two segments barely group anything -- a plugin registry where every entry
# is its own directory produces ninety areas from a hundred pull requests -- the
# rows read as insight while carrying none. Above this ratio of areas to pull
# requests, fall back to one segment, which for that registry correctly collapses
# to a single honest row: everything lands in `plugins`.
REGROUP_ABOVE = 0.5


@dataclass(frozen=True, slots=True)
class Area:
    path: str
    landed: int
    attempted: int

    @property
    def rate(self) -> float:
        return self.landed / self.attempted if self.attempted else 0.0


@dataclass(frozen=True, slots=True)
class Landing:
    """Where outsiders got in, and where they did not."""

    landed: list[Area]
    never: list[Area]
    outsider_threads: int
    outsider_merges: int
    depth: int = DEPTH

    def __bool__(self) -> bool:
        return bool(self.landed or self.never)


def area_of(path: str, depth: int = DEPTH) -> str:
    """`pkgs/by-name/fo/foo/package.nix` -> `pkgs/by-name`. A root file -> `(root)`."""
    parts = path.split("/")
    if len(parts) == 1:
        return "(root)"
    return "/".join(parts[:depth])


def _tally(outsiders: list[Thread], depth: int) -> tuple[Counter, Counter]:
    landed: Counter = Counter()
    attempted: Counter = Counter()
    for thread in outsiders:
        # Count each area once per pull request. A change touching forty files in
        # one directory is one attempt at that directory, not forty.
        for area in sorted({area_of(f, depth) for f in (thread.files or [])}):
            attempted[area] += 1
            if thread.merged:
                landed[area] += 1
    return landed, attempted


def compute(threads: dict[str, Thread]) -> Landing:
    outsiders = outsider_threads(threads)
    depth = DEPTH
    landed, attempted = _tally(outsiders, depth)
    if outsiders and len(attempted) > REGROUP_ABOVE * len(outsiders):
        depth = 1
        landed, attempted = _tally(outsiders, depth)

    # `Counter.most_common` breaks ties by insertion order, and insertion order
    # here was set-iteration order, which varies with the process hash seed. Two
    # replays of the same recording printed different fourth rows -- a report
    # this project claims is a function of the evidence quietly was not. Ordered
    # explicitly instead: most merges first, then the better odds, then the
    # larger sample, then alphabetically, so the order is total.
    got_in = [
        Area(a, landed[a], attempted[a])
        for a in sorted(
            landed,
            key=lambda a: (-landed[a], -landed[a] / attempted[a], -attempted[a], a),
        )[:TOP_N]
    ]
    never = [
        Area(a, 0, attempted[a])
        for a in sorted(attempted, key=lambda a: (-attempted[a], a))
        if landed.get(a, 0) == 0 and attempted[a] >= MIN_ATTEMPTS
    ][:TOP_N]

    return Landing(
        landed=got_in,
        never=never,
        outsider_threads=len(outsiders),
        outsider_merges=sum(1 for t in outsiders if t.merged),
        depth=depth,
    )


def render(landing: Landing) -> list[str]:
    """Markdown lines, or nothing at all when there is nothing to say."""
    if not landing:
        return []
    lines = ["## Where outsider work landed", ""]
    lines.append(
        f"Counted over the {landing.outsider_threads} pull requests opened here by "
        f"people with no prior merge, of which {landing.outsider_merges} were merged. "
        + ("Paths are cut to their first two segments, so a short path may name a "
           "file rather than a directory." if landing.depth == 2 else
           "Paths are cut to their first segment: at two, almost every pull request "
           "here landed in a directory of its own, which groups nothing.")
    )
    lines.append("")
    for area in landing.landed:
        lines.append(
            f"- **`{area.path}`** — {area.landed} merged "
            f"of {area.attempted} attempted ({area.rate:.0%})"
        )
    if landing.never:
        lines.append("")
        joined = ", ".join(f"`{a.path}` ({a.attempted})" for a in landing.never)
        lines.append(
            f"Outsiders attempted these and none were merged: {joined}. "
            f"That is what this sample shows, not a rule — a directory can appear "
            f"here because newcomers are turned away from it, or because only a "
            f"couple of people ever tried."
        )
    return lines
