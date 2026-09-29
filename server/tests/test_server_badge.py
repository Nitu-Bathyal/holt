"""The badge's words: positive and factual for a passing repo, neutral otherwise."""

from __future__ import annotations

import pytest
from holt_server import badge


def stats(merged=8, hours=3.0):
    return {"outsider_attempts": 20, "outsider_merged": merged,
            "median_first_response_hours": hours}


@pytest.mark.parametrize(("s", "expected"), [
    (stats(), "merges outsiders · replies in ~3h"),
    (stats(hours=0.8), "merges outsiders · replies in ~48m"),
    (stats(hours=0.001), "merges outsiders · replies in ~1m"),
    (stats(hours=50), "merges outsiders · replies in ~2d"),
    (stats(hours=200), "merges outsiders"),     # a slow reply stays in the report
    (stats(hours=None), "merges outsiders"),
    (stats(merged=0), "replies in ~3h"),
    (stats(merged=0, hours=None), "worth your time"),
    (None, "worth your time"),
])
def test_passing_repo_gets_a_factual_line(s, expected):
    assert badge.message("viable", s) == (expected, badge.POSITIVE_COLOR)


@pytest.mark.parametrize("verdict", ["long_shot", "not_viable", "insufficient_evidence",
                                     "personal", "something_new"])
def test_anything_but_a_pass_is_neutral(verdict):
    assert badge.message(verdict, stats()) == ("see report", badge.NEUTRAL_COLOR)


def test_unchecked():
    assert badge.message(None, None) == ("not checked yet", badge.NEUTRAL_COLOR)


def test_render_escapes_and_sizes():
    svg = badge.render("viable", stats(), 'https://githolt.com/o/r"><x')
    assert 'aria-label="Holt: merges outsiders · replies in ~3h"' in svg
    assert "&quot;&gt;&lt;x" in svg and '"><x' not in svg
    short = badge.render(None, None, "https://githolt.com/o/r")
    width = lambda s: int(s.split('width="', 1)[1].split('"', 1)[0])  # noqa: E731
    assert width(svg) > width(short)
