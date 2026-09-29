"""Someone's own project, or a small team's: not one run for outside contributors.

A hackathon entry, a course assignment, a personal site. Holt used to answer
"Not enough evidence" for these (nobody from outside tried), which reads as
"maybe, give it a go". The honest answer is that no merge verdict applies:
the repository was never set up to take outside work.

Deliberately conservative, because a small genuinely open project with little
traffic must stay "Not enough evidence". Every one of these must hold:

* nothing from outside the team was merged, and at most MAX_OUTSIDE_PRS
  outside pull requests were opened at all;
* every pull request read came from at most MAX_PEOPLE people (the owner, or a
  hackathon-sized team), and it has fewer than MAX_STARS stars;
* there is no CONTRIBUTING file (a project that writes one is asking);
* and at least one sign that it is a personal or event project: hackathon or
  coursework words in its name, description, topics or README; a name like a
  personal site; or a short burst of work that has stopped.

Live readings only (and recordings of them): the frozen benchmark never had
this rule (see pipeline._add_personal).
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping
from datetime import datetime, timedelta
from typing import Any

from holt.agent.signals import Thread, outsider_threads
from holt.types import EvidenceRecord

MAX_OUTSIDE_PRS = 2
MAX_PEOPLE = 5
MAX_STARS = 25
# A burst: everything from the repository's creation to its last push fits in
# this many days, and nothing has been pushed for QUIET_DAYS since.
BURST_DAYS = 60
QUIET_DAYS = 30
# How much of the README to read for the words below: its opening, where a
# project says what it is. A long README that mentions a hackathon in its
# history section is not a hackathon entry.
README_HEAD_CHARS = 1500

_EVENT_WORDS = re.compile(
    r"\bhack[\s-]?a?thons?\b|\bhackathon\w*|\bgame[\s-]?jam\b|\bsubmission for\b"
    r"|\b(?:course|class|college|university|school|lab|programming|homework)\s+assignment\b"
    r"|\bassignment\s*\d+\b|\bcoursework\b|\bcourse project\b|\bclass project\b"
    r"|\bsemester project\b|\bcapstone\b|\bfinal[\s-]year project\b"
    r"|\bcollege project\b|\buniversity project\b|\bschool project\b|\bhomework\b"
    r"|\bbootcamp project\b|\bsmart india hackathon\b|\bsih\s?20\d\d\b",
    re.IGNORECASE,
)
_PERSONAL_NAMES = re.compile(
    r"(^|[-_.])(dotfiles|portfolio|resume|cv|personal[-_]?(site|website|page))($|[-_.])"
    r"|\.github\.io$",
    re.IGNORECASE,
)


def _meta(records: Iterable[EvidenceRecord]) -> EvidenceRecord | None:
    return next((r for r in records if r.evidence_id.endswith(":meta")), None)


def _doc(records: Iterable[EvidenceRecord], kind: str) -> EvidenceRecord | None:
    return next((r for r in records if r.evidence_id.endswith(f":{kind}")), None)


def _when(raw: Any) -> datetime | None:
    if not raw:
        return None
    try:
        return datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        return None


def event_words(name: str, meta: Mapping[str, Any], readme: str) -> str | None:
    """The first hackathon or coursework word in what the project says about itself."""
    topics = " ".join(meta.get("topics") or [])
    for text in (name.replace("-", " ").replace("_", " "), meta.get("description") or "",
                 topics.replace("-", " "), readme[:README_HEAD_CHARS]):
        if m := _EVENT_WORDS.search(text):
            return m.group(0)
    return None


def _burst(created: datetime | None, meta: Mapping[str, Any], as_of: datetime) -> bool:
    pushed = _when(meta.get("pushed_at"))
    if created is None or pushed is None or pushed > as_of:
        return False
    return pushed - created <= timedelta(days=BURST_DAYS) and \
        as_of - pushed >= timedelta(days=QUIET_DAYS)


def detect(records: list[EvidenceRecord], threads: Mapping[str, Thread],
           as_of: datetime) -> str | None:
    """The sentence a reader sees when this is a personal or team project, or None."""
    meta = _meta(records)
    if meta is None:
        return None
    m = meta.payload
    repo = str(m.get("name_with_owner") or meta.evidence_id.split(":")[1])
    name = repo.split("/")[-1]

    outside = outsider_threads(threads)
    if any(t.merged for t in outside) or len(outside) > MAX_OUTSIDE_PRS:
        return None
    people = {t.author for t in threads.values() if not t.author_is_bot}
    if len(people) > MAX_PEOPLE:
        return None
    stars = m.get("stargazer_count")
    if not isinstance(stars, int) or stars >= MAX_STARS:
        return None
    if _doc(records, "contributing") is not None:
        return None

    readme = (_doc(records, "readme").payload.get("text") or "") if _doc(records, "readme") else ""
    who = ("every pull request here came from one person" if len(people) == 1 else
           f"every pull request here came from a small team ({len(people)} people)"
           if people else "nobody has opened a pull request here")
    if word := event_words(name, m, readme):
        return (f"This looks like a {_event_kind(word)} project: {who}, and nothing from "
                "outside has been merged. It isn't set up for outside contributions.")
    if _PERSONAL_NAMES.search(name):
        return (f"This looks like someone's personal repository: {who}, and nothing "
                "from outside has been merged. It isn't set up for outside contributions.")
    if _burst(meta.timestamp, m, as_of):
        return (f"This looks like a short personal or team project: its work happened "
                f"within {BURST_DAYS} days and stopped, and {who}. It isn't set up for "
                "outside contributions.")
    return None


def _event_kind(word: str) -> str:
    low = word.lower()
    if "hack" in low or "sih" in low or "jam" in low or "submission" in low:
        return "hackathon"
    return "coursework"
