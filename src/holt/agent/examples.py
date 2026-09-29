"""The outside pull requests behind the counts, for a report with no AI.

Without a model the engine cites nothing, which leaves a reader with numbers
and no way to look for themselves. These are picked by arithmetic only (the
newest merged, the newest with no reply), so they say nothing the counts do
not already say; they make the counts clickable. The web's rules report and
`holt analyze --no-model` (Markdown and JSON) show the same ones.
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime
from typing import Any

from holt.agent import rates
from holt.agent.landing_detection import VIA
from holt.agent.signals import Thread, outsider_threads
from holt.report import evidence_url
from holt.types import EvidenceRecord

EACH = 4


def counted(threads: Mapping[str, Thread], records: Mapping[str, EvidenceRecord],
            as_of: datetime | None = None, settle_hours: float = 0.0) -> list[dict[str, Any]]:
    """Up to EACH merged and EACH unanswered outside pull requests, newest first,
    from the ones the counts are over. Each is an API.md evidence item."""
    outsiders = [t for t in outsider_threads(threads) if not rates.excluded(t)]
    if rates.judges_time(as_of, settle_hours):
        # Only the pull requests the counts are over: not too new, not too old.
        outsiders = rates.split(outsiders, as_of, settle_hours).decided
    outsiders.sort(key=lambda t: t.opened_at, reverse=True)
    picks = [("merged", t) for t in outsiders if t.merged][:EACH]
    # The pull requests the "no reply" count is made of: open, unanswered and
    # past the settle window. Not a silent close, and not one opened yesterday.
    picks += [("no_reply", t) for t in outsiders
              if rates.outcome(t, as_of, settle_hours) == rates.IGNORED][:EACH]
    out = []
    for value, t in picks:
        evidence_id = f"{t.key}:opened"
        record = records.get(evidence_id)
        url = (record.url if record is not None and record.url else "") or evidence_url(evidence_id)
        if not url:
            continue
        title = ((record.payload.get("title") or "").strip() if record is not None else "")
        what = "had no reply from anyone when we looked"
        if value == "merged":
            # GitHub shows an off-button landing as closed; say how it went in.
            what = f"landed {VIA[t.landed_via]}" if t.landed_via else "was merged"
        text = f"Outside contributor's pull request #{t.number} {what}"
        out.append({"id": evidence_id, "url": url, "kind": "outsider_pr", "value": value,
                    "text": text + (f": “{title}”" if title else ""), "quote": None})
    return out
