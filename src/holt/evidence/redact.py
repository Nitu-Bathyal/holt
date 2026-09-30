"""Strip third-party credentials out of captured evidence before it is committed.

Public GitHub issues contain leaked API keys, in bug reports and in secret-scanner
test cases alike. Crawling them is fine; **redistributing them in a submitted
artifact is not**, whether or not they are still live. So the scrub runs at
capture time and every fixture in this repository has been through it.

Two tiers, because one is not enough:

1. Any string in a recognised credential format is replaced wherever it appears.
2. In a record where tier 1 fired, long opaque runs are replaced too. One captured
   issue printed a token backwards next to the real one — a format matcher will
   never catch that, and a record already known to be discussing a live secret is
   the right place to be blunt about it.

Tier 2 deliberately does not run repository-wide: commit hashes and base64 blobs
are legitimate evidence, and destroying them everywhere to catch one obfuscated
token would cost more than it buys.
"""

from __future__ import annotations

import re
from typing import Any

MARKER = "[REDACTED-CREDENTIAL]"

# Prefixed formats only. A pattern loose enough to catch unprefixed secrets is
# loose enough to shred ordinary evidence.
CREDENTIAL_PATTERNS = [
    # GitHub App installation tokens in the "ghs_<app id>_<JWT>" form (since
    # April 2026), before the classic form and the bare JWT so they go whole.
    re.compile(r"ghs_[0-9]+_[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+"),
    re.compile(r"gh[pousr]_[A-Za-z0-9]{36,255}"),
    # A JWT: three base64url parts, the first two JSON objects ("eyJ" is "{\"").
    # Not when it is a link's `?jwt=`, `?token=` or `?signature=`: those are
    # presigned image links in PR bodies (GitHub's attachments among them),
    # expired within minutes and no key to anything.
    # (The checks come after the literal "eyJ", so the scan stays fast.)
    re.compile(r"eyJ(?<![?&]jwt=eyJ)(?<![?&]token=eyJ)(?<![?&]signature=eyJ)"
               r"[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}"),
    re.compile(r"github_pat_[A-Za-z0-9_]{22,255}"),
    re.compile(r"sk-proj-[A-Za-z0-9_-]{20,}"),
    re.compile(r"sk-ant-[A-Za-z0-9_-]{20,}"),
    re.compile(r"sk-[A-Za-z0-9]{32,}"),
    re.compile(r"xox[baprs]-[A-Za-z0-9-]{10,}"),
    re.compile(r"AKIA[0-9A-Z]{16}"),
    re.compile(r"AIza[0-9A-Za-z_-]{35}"),
]

# Tier 2, inside an already-flagged record only.
OPAQUE_RUN = re.compile(r"\b[A-Za-z0-9]{30,}\b")


def _scrub(text: str, patterns) -> tuple[str, int]:
    hits = 0
    for pattern in patterns:
        text, n = pattern.subn(MARKER, text)
        hits += n
    return text, hits


def _walk(value: Any, patterns) -> tuple[Any, int]:
    if isinstance(value, str):
        return _scrub(value, patterns)
    if isinstance(value, dict):
        out, total = {}, 0
        for k, v in value.items():
            out[k], n = _walk(v, patterns)
            total += n
        return out, total
    if isinstance(value, list):
        out, total = [], 0
        for v in value:
            scrubbed, n = _walk(v, patterns)
            out.append(scrubbed)
            total += n
        return out, total
    return value, 0


def redact_payload(payload: dict[str, Any]) -> tuple[dict[str, Any], int]:
    """Return a scrubbed copy and the number of secrets removed."""
    scrubbed, hits = _walk(payload, CREDENTIAL_PATTERNS)
    if hits:
        scrubbed, extra = _walk(scrubbed, [OPAQUE_RUN])
        hits += extra
        scrubbed["redacted"] = True
    return scrubbed, hits
