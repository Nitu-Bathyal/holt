"""Stage E's check: the written report may only say what was measured or said.

The narrator is handed the verdict, the rule trace, the counts and the verified
findings, and writes prose. Nothing checked that prose. The audit of 27 Sep 2026
found it inventing figures, quoting automated posts as maintainers, and leaking
the prompt's field names to the reader ("distinct_merged_authors is 0").

This is the same rule Stage D applies to findings, applied to sentences: a
sentence whose numbers are not in the measurements, whose quotation nobody
other than the pull request's author said, or which names an internal field, is
removed -- not softened. No model runs here; it is arithmetic and string
matching, like the rest of verification.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field

from holt.agent.verify import quote_supported

# A quotation of at least this many words has to be found in the record. Two
# words in quotation marks are usually a label ("Not planned") or a term, and
# those are checked as numbers and field names like any other text.
MIN_QUOTED_WORDS = 3

_SENTENCE = re.compile(r"(?<=[.!?…])[\"”’)]?\s+(?=[A-Z0-9“\"(])")
_QUOTED = re.compile(r"“([^”]+)”|\"([^\"]+)\"")
_BACKTICKED = re.compile(r"`[^`]*`")
# snake_case: an internal field or enum name (`distinct_merged_authors`,
# `not_viable`, `merged_after_review`). Ordinary prose never has one outside a
# quotation or a code span.
_FIELD_NAME = re.compile(r"\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b")
_NUMBER = re.compile(r"(?<![\w#.])(\d+(?:[.,]\d+)?)(?![\w])")
# The narrator is told never to say it; it means nothing to a reader.
_JARGON = re.compile(r"\bcutoff\b", re.IGNORECASE)


@dataclass(slots=True)
class Checked:
    """A field's prose after the check, and the sentences that were removed."""

    text: str
    dropped: list[tuple[str, str]] = field(default_factory=list)  # (sentence, why)


def sentences(text: str) -> list[str]:
    return [s for s in _SENTENCE.split(text.strip()) if s.strip()] if text else []


def _plain(sentence: str) -> str:
    """The sentence with quotations and code spans removed: the narrator's own words."""
    return _BACKTICKED.sub(" ", _QUOTED.sub(" ", sentence))


def _as_number(raw: str) -> float | None:
    try:
        return float(raw.replace(",", "") if raw.count(",") == 1 and len(raw.split(",")[1]) == 3
                     else raw.replace(",", "."))
    except ValueError:
        return None


def allowed_numbers(values: Iterable[object], texts: Iterable[str] = ()) -> set[float]:
    """Every number a sentence may state, in the forms a writer would state it.

    From each measurement: the value, rounded to whole and one decimal; a share
    (0 to 1) also as a percentage; an hour count also in minutes and days. Plus
    every number written in `texts` (the rule trace), and the
    small whole numbers prose uses for its own structure ("two reasons").
    """
    out: set[float] = {float(n) for n in range(0, 4)}

    def add(x: float) -> None:
        out.update({round(x, 1), float(round(x))})

    for v in values:
        if isinstance(v, bool) or not isinstance(v, int | float):
            continue
        x = float(v)
        add(x)
        if 0 <= x <= 1:
            add(x * 100)
        if x > 0:
            add(x * 60)
            add(x / 24)
    for text in texts:
        for raw in _NUMBER.findall(text or ""):
            if (n := _as_number(raw)) is not None:
                add(n)
    return out


def _derived(signals: Mapping[str, object]) -> list[float]:
    """Differences and shares a writer reasonably computes from the counts."""
    nums = {k: v for k, v in signals.items()
            if isinstance(v, int | float) and not isinstance(v, bool)}
    out: list[float] = []
    threads = nums.get("outsider_threads")
    for k in ("outsider_merged", "outsider_ignored", "outsider_answered"):
        if threads and k in nums:
            out.append(threads - nums[k])
            out.append(nums[k] / threads)
    if threads and "outsider_merged" in nums and "outsider_ignored" in nums:
        out.append(threads - nums["outsider_merged"] - nums["outsider_ignored"])
    return out


def check_text(
    text: str,
    numbers: set[float],
    spoken: str,
) -> Checked:
    """Keep the sentences whose figures, quotations and words all check out."""
    kept: list[str] = []
    dropped: list[tuple[str, str]] = []
    for sentence in sentences(text):
        why = _unsupported(sentence, numbers, spoken)
        if why:
            dropped.append((sentence, why))
        else:
            kept.append(sentence)
    return Checked(" ".join(kept), dropped)


def check_paragraphs(text: str, numbers: set[float], spoken: str) -> Checked:
    """`check_text` per paragraph, keeping the blank lines between them."""
    paragraphs, dropped = [], []
    for para in (text or "").split("\n\n"):
        checked = check_text(para, numbers, spoken)
        dropped += checked.dropped
        if checked.text:
            paragraphs.append(checked.text)
    return Checked("\n\n".join(paragraphs), dropped)


def _unsupported(sentence: str, numbers: set[float], spoken: str) -> str:
    plain = _plain(sentence)
    if m := _FIELD_NAME.search(plain):
        return f"names an internal field ({m.group(0)})"
    if _JARGON.search(plain):
        return "uses internal jargon"
    for m in _QUOTED.finditer(sentence):
        quote = (m.group(1) or m.group(2) or "").strip().rstrip("…").rstrip(".").strip()
        if len(quote.split()) >= MIN_QUOTED_WORDS and not quote_supported(quote, spoken):
            return "quotes words nobody but the author, or a program, wrote"
    for raw in _NUMBER.findall(plain):
        n = _as_number(raw)
        if n is not None and round(n, 1) not in numbers and float(round(n)) not in numbers:
            return f"states a figure that was not measured ({raw})"
    return ""


def check_narration(
    narrated: Mapping[str, str],
    signals: Mapping[str, object],
    trace: Iterable[str],
    spoken: Mapping[str, str],
    extra_numbers: Iterable[object] = (),
) -> tuple[dict[str, str], list[tuple[str, str, str]]]:
    """Check every narrated field. Returns (checked fields, [(field, sentence, why)]).

    `spoken` is `verify.spoken_words`: what people other than each pull
    request's author said, bots and automated posts excluded. A quotation must
    appear somewhere in it.
    """
    trace = list(trace)
    haystack = " ".join(spoken.values())
    numbers = allowed_numbers(
        [*signals.values(), *_derived(signals), *extra_numbers],
        texts=trace,
    )
    out: dict[str, str] = {}
    removed: list[tuple[str, str, str]] = []
    for name, text in narrated.items():
        checked = check_paragraphs(text or "", numbers, haystack)
        out[name] = checked.text
        removed += [(name, s, why) for s, why in checked.dropped]
    return out, removed
