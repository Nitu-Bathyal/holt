"""What a project asks of a contributor before it will take a pull request.

Read from evidence Holt already has, and only where it is unambiguous:

- a CLA (Contributor License Agreement): a CLA bot commented on outside pull
  requests in the sample. Not from CONTRIBUTING: free-programming-books has a
  "Contributor License Agreement" heading that only means "you agree to the
  licence", with nothing to sign;
- a DCO sign-off: CONTRIBUTING names the "Developer Certificate of Origin";
- an issue first: CONTRIBUTING says, in so many words, to open an issue or
  discuss the change before sending a pull request.

These never touch the verdict. They are advice for the next step, and each
one links to where it was read so the reader can check it. Where nothing is
found, nothing is said: the absence of a match is not a claim that the project
asks for nothing.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass

from holt.types import EvidenceRecord

# CLA bots seen on the golden set: linux-foundation-easycla, google-cla,
# meta-cla, python-cla-bot, CLAassistant. Whole-word "cla", so `cclauss` and
# `clarfonthey` are people.
_CLA_BOT = re.compile(r"easycla|claassistant|cla-assistant|(?:^|[-_])cla(?:[-_](?:bot|checker|assistant))?(?:\[bot\])?$",
                      re.I)
_DCO_DOC = re.compile(r"developer\s+certificate\s+of\s+origin", re.I)
_ISSUE_FIRST_DOC = re.compile(
    r"\b(?:open|file|create|raise)\s+an\s+issue\s+first\b"
    r"|\bdiscuss\s+(?:it|your\s+(?:idea|change|proposal)|the\s+change|this)\s+first\b"
    r"|\bbefore\s+(?:opening|submitting|sending|starting)\s+(?:a|your|any)\s+(?:pull\s+request|PR)"
    r"[^.\n]{0,40}?\b(?:open|file|create)\s+an\s+issue\b",
    re.I,
)


@dataclass(frozen=True, slots=True)
class Ask:
    code: str  # "cla", "dco" or "issue_first"
    url: str  # where it was read: a bot's comment, or CONTRIBUTING


def is_cla_bot(login: str | None) -> bool:
    return bool(login) and bool(_CLA_BOT.search(login or ""))


def read(records: Iterable[EvidenceRecord], outsider_keys: set[str] | None = None) -> list[Ask]:
    """Every ask found, CLA first. `outsider_keys` limits the CLA-bot check to
    those pull requests (a bot greeting staff says nothing about outsiders)."""
    records = list(records)
    found: dict[str, Ask] = {}
    for r in records:
        if ":comment:" not in r.evidence_id and ":review:" not in r.evidence_id:
            continue
        key = ":".join(r.evidence_id.split(":")[:2])
        if outsider_keys is not None and key not in outsider_keys:
            continue
        if is_cla_bot(r.payload.get("author")) and r.url:
            found.setdefault("cla", Ask("cla", r.url))
            break
    doc = next((r for r in records if r.evidence_id.endswith(":contributing")), None)
    text = (doc.payload.get("text") or "") if doc is not None else ""
    if doc is not None and doc.url and text:
        if _DCO_DOC.search(text):
            found.setdefault("dco", Ask("dco", doc.url))
        if _ISSUE_FIRST_DOC.search(text):
            found.setdefault("issue_first", Ask("issue_first", doc.url))
    return [found[c] for c in ("cla", "dco", "issue_first") if c in found]
