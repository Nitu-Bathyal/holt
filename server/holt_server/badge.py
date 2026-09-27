"""The README badge, shields.io style.

A repo that passes gets a positive, factual line: `Holt | merges outsiders ·
replies in ~6h`. Anything else is neutral (`Holt | see report`), never a red
verdict: the badge sits in a maintainer's own README, and the report page is
where the full answer lives.
"""

from __future__ import annotations

from html import escape
from typing import Any

LABEL = "Holt"

# Opaque fills on both halves, dark label, white text: readable on light and
# dark README backgrounds alike. Each colour holds white text at 4.5:1 or better.
LABEL_COLOR = "#555"
POSITIVE_COLOR = "#1a7f37"
NEUTRAL_COLOR = "#57606a"
NEUTRAL = "see report"
UNCHECKED = "not checked yet"

# Only a quick first reply is worth putting on the badge; a slow one is still
# in the report.
REPLY_SHOWN_HOURS = 72

# Verdana 11px advance widths, roughly. Enough to size a badge; shields.io does
# the same with a measured table.
_NARROW = set("fijlrt1 .,:;'!|()-·")
_WIDE = set("mwMW@%")


def text_width(text: str) -> int:
    width = 0.0
    for ch in text:
        if ch in _NARROW:
            width += 4.0
        elif ch in _WIDE:
            width += 10.0
        elif ch.isupper() or ch.isdigit():
            width += 7.5
        else:
            width += 6.6
    return int(round(width))


def short_hours(hours: float) -> str:
    """0.8 -> "~48m", 6.2 -> "~6h", 50 -> "~2d"."""
    if hours < 1:
        return f"~{max(1, round(hours * 60))}m"
    if hours < 24:
        return f"~{round(hours)}h"
    return f"~{round(hours / 24)}d"


def message(verdict: str | None, stats: dict[str, Any] | None) -> tuple[str, str]:
    """The badge's right half and its colour, from the latest rules report."""
    if verdict is None:
        return UNCHECKED, NEUTRAL_COLOR
    if verdict != "viable":
        return NEUTRAL, NEUTRAL_COLOR
    stats = stats or {}
    parts = []
    if (stats.get("outsider_merged") or 0) > 0:
        parts.append("merges outsiders")
    hours = stats.get("median_first_response_hours")
    if isinstance(hours, (int, float)) and 0 <= hours <= REPLY_SHOWN_HOURS:
        parts.append(f"replies in {short_hours(hours)}")
    return " · ".join(parts) or "worth your time", POSITIVE_COLOR


def render(verdict: str | None, stats: dict[str, Any] | None, link: str) -> str:
    msg, color = message(verdict, stats)
    lw = text_width(LABEL) + 12
    mw = text_width(msg) + 12
    total = lw + mw
    title = escape(f"{LABEL}: {msg}")
    link = escape(link, quote=True)
    return f"""<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{total}" height="20" role="img" aria-label="{title}">
<title>{title}</title>
<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
<clipPath id="r"><rect width="{total}" height="20" rx="3" fill="#fff"/></clipPath>
<a xlink:href="{link}" href="{link}" target="_blank">
<g clip-path="url(#r)"><rect width="{lw}" height="20" fill="{LABEL_COLOR}"/><rect x="{lw}" width="{mw}" height="20" fill="{color}"/><rect width="{total}" height="20" fill="url(#s)"/></g>
<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
<text x="{lw / 2:.1f}" y="15" fill="#010101" fill-opacity=".3">{LABEL}</text><text x="{lw / 2:.1f}" y="14">{LABEL}</text>
<text x="{lw + mw / 2:.1f}" y="15" fill="#010101" fill-opacity=".3">{escape(msg)}</text><text x="{lw + mw / 2:.1f}" y="14">{escape(msg)}</text>
</g>
</a>
</svg>
"""
