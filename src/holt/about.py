"""What a repository is about, and how big and alive it is.

Shown above the verdict (the CLI/TUI header here; the web's "About this repo"
block from the server's `repo_meta`). Nothing here feeds the verdict: it is
GitHub's own description, the README's first sentence and GitHub's counters,
as of when they were read.
"""

from __future__ import annotations

import html
import math
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlparse

# The longest README line kept; a longer first sentence is cut at a word.
MAX_LINE = 200
# Fewer words than this is a title or a slogan fragment ("WIP"), not a line.
MIN_WORDS = 3
# Languages shown, biggest first.
TOP_LANGUAGES = 3

_COMMENT = re.compile(r"<!--.*?-->", re.S)
_FENCE = re.compile(r"^\s*(```|~~~).*?^\s*\1[^\n]*$", re.S | re.M)
_HTML_HEADING = re.compile(r"<h[1-6][^>]*>.*?</h[1-6]\s*>", re.S | re.I)
_ATX = re.compile(r"^\s{0,3}#")
_UNDERLINE = re.compile(r"^\s*([=\-~^*#_+`'\"])\1{2,}\s*$")
_SKIP_LINE = re.compile(r"^\s*(\||>|[-*+]\s|\d+[.)]\s|\.\. )")
_IMAGE = re.compile(r"!\[[^\]]*\](\([^)]*\)|\[[^\]]*\])")
_LINK = re.compile(r"\[([^\]]*)\](\([^)]*\)|\[[^\]]*\])")
_BRACKETS = re.compile(r"\[([^\]]+)\]")
_RST_LINK = re.compile(r"`([^`<]+?)\s*<[^>]+>`_{1,2}")
_TAG = re.compile(r"<[^>]+>")
_EMOJI = re.compile(r":[a-z0-9_+-]*[a-z][a-z0-9_+-]*:", re.I)
_STRONG = re.compile(r"(\*\*|__)(.+?)\1")
_EM = re.compile(r"(?<!\w)([*_])(\S(?:.*?\S)?)\1(?!\w)")
# "Docs · Chat · Blog", "Home | Install | FAQ": a navigation row, not prose.
_NAV_SEP = re.compile(r"\s[·|•–—-]\s")
_CONTENTS = re.compile(r"^\W*(table of )?contents\W*$", re.I)
_SENTENCE_END = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"'(\[])")


def _inline(text: str) -> str:
    """Markdown/rST/HTML inline markup out, plain words kept."""
    text = _IMAGE.sub("", text)
    text = _LINK.sub(r"\1", text)
    text = _RST_LINK.sub(r"\1", text)
    text = _TAG.sub(" ", text)
    text = _BRACKETS.sub(r"\1", text)
    text = _EMOJI.sub("", text)
    text = _STRONG.sub(r"\2", text)
    text = _EM.sub(r"\2", text)
    text = text.replace("~~", "").replace("`", "")
    return " ".join(html.unescape(text).split())


def _paragraph_text(block: str) -> str:
    lines = block.split("\n")
    if lines and lines[0].lstrip().startswith(".. "):
        return ""  # an rST directive (an image, a badge) and its options
    # A setext/rST title is the text above its underline: drop both.
    for i in range(len(lines) - 1, -1, -1):
        if _UNDERLINE.match(lines[i]):
            lines = lines[i + 1:]
            break
    kept = [ln for ln in lines if ln.strip() and not _ATX.match(ln)
            and not _SKIP_LINE.match(ln)]
    if not kept:
        return ""
    raw = " ".join(kept)
    # Only links and separators (a row of "Docs | Chat | Blog"): no prose.
    if not re.search(r"[A-Za-z]{2}", _TAG.sub("", _LINK.sub("", _IMAGE.sub("", raw)))):
        return ""
    plain = _inline(raw)
    pieces = _NAV_SEP.split(plain)
    if len(pieces) >= 3 and all(len(p.split()) <= 3 for p in pieces):
        return ""
    if _CONTENTS.match(plain):
        return ""
    return plain


def _cut(text: str) -> str:
    if len(text) <= MAX_LINE:
        return text
    cut = text[:MAX_LINE - 1]
    if " " in cut:
        cut = cut[:cut.rindex(" ")]
    return cut.rstrip(" ,;:-–—") + "…"


def readme_line(text: str | None) -> str | None:
    """The README's first real sentence, as plain text: past the badges,
    logos, headings, code and lists. None when there isn't one."""
    if not text:
        return None
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = _COMMENT.sub("", text)
    text = _FENCE.sub("", text)
    text = _HTML_HEADING.sub("", text)
    for block in re.split(r"\n\s*\n", text):
        plain = _paragraph_text(block)
        if len(plain.split()) < MIN_WORDS or not re.search(r"[A-Za-z]", plain):
            continue
        return _cut(_SENTENCE_END.split(plain, maxsplit=1)[0].strip())
    return None


# Where a README sends people for help: chat rooms and the project's docs. The
# first of each kind wins; a badge's image URL (shields.io, badges.gitter.im)
# never matches, only where the badge links to.
_URL_END = r"[^\s)\"'<>\]]*"
HELP_PATTERNS = (
    ("docs", re.compile(r"https?://(?:[\w-]+\.readthedocs\.(?:io|org)|docs\.(?!github\.com)[\w.-]+\.\w+)" + _URL_END, re.I)),
    ("discord", re.compile(r"https?://(?:www\.)?(?:discord\.gg|discord(?:app)?\.com/invite)/[\w-]+", re.I)),
    ("slack", re.compile(r"https?://(?:join\.slack\.com/t/|[\w-]+\.slack\.com)" + _URL_END, re.I)),
    ("gitter", re.compile(r"https?://(?:app\.)?gitter\.im/[\w-]+" + _URL_END, re.I)),
    ("matrix", re.compile(r"https?://matrix\.to/#/" + _URL_END, re.I)),
    ("zulip", re.compile(r"https?://[\w-]+\.zulipchat\.com" + _URL_END, re.I)),
)
MAX_URL = 300


def help_links(text: str | None) -> list[dict[str, str]]:
    """The README's links to its docs and chat rooms, as [{"kind", "url"}],
    in HELP_PATTERNS order, one per kind."""
    if not text:
        return []
    text = _COMMENT.sub("", text)
    out = []
    for kind, pattern in HELP_PATTERNS:
        for m in pattern.finditer(text):
            url = m.group(0).rstrip(".,;:!?")
            if len(url) <= MAX_URL:
                out.append({"kind": kind, "url": url})
                break
    return out


def compact(n: int) -> str:
    """91234 -> "91k", 1234 -> "1.2k", 1250000 -> "1.3M"."""
    for size, unit in ((1_000_000_000, "B"), (1_000_000, "M"), (1_000, "k")):
        if n >= size * 0.9995:
            v = n / size
            shown = math.floor(v * 10 + 0.5) / 10 if v < 9.95 else math.floor(v + 0.5)
            if shown >= 1000 and unit != "B":
                continue
            return f"{shown:g}{unit}"
    return str(n)


def language_shares(conn: dict[str, Any] | None, top: int = TOP_LANGUAGES) -> list[dict[str, Any]]:
    """GitHub's `languages { totalSize edges { size node { name } } }` as
    [{"name", "share"}], biggest first, share in 0..1."""
    conn = conn or {}
    total = conn.get("totalSize") or 0
    out = []
    for edge in conn.get("edges") or []:
        name = ((edge or {}).get("node") or {}).get("name")
        if name and total:
            out.append({"name": name, "share": round((edge.get("size") or 0) / total, 4)})
    return sorted(out, key=lambda x: -x["share"])[:top]


def license_name(info: dict[str, Any] | None) -> str | None:
    """"MIT" for GitHub's `licenseInfo`; None when there is none. GitHub
    names an unrecognised licence "Other" (spdxId NOASSERTION)."""
    if not info:
        return None
    spdx = info.get("spdxId")
    if spdx and spdx != "NOASSERTION":
        return spdx
    return info.get("name") or None


@dataclass(slots=True)
class About:
    description: str | None = None
    readme_line: str | None = None
    homepage: str | None = None
    stars: int | None = None
    forks: int | None = None
    open_issues: int | None = None
    license: str | None = None
    topics: list[str] = field(default_factory=list)
    languages: list[dict[str, Any]] = field(default_factory=list)
    created_at: datetime | None = None
    pushed_at: datetime | None = None
    default_branch: str | None = None
    archived: bool = False
    fork_of: str | None = None
    fork: bool = False


def _ts(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")) if value else None
    except ValueError:
        return None


def about_from_meta(meta: dict[str, Any], created_at: datetime | None,
                    readme: str | None) -> About:
    """From the engine's `repo:<slug>:meta` payload (github_graphql.py) and the
    README line. Older captures lack most counters; those stay unset."""
    return About(
        description=(meta.get("description") or "").strip() or None,
        readme_line=readme,
        homepage=(meta.get("homepage_url") or "").strip() or None,
        stars=meta.get("stargazer_count"),
        forks=meta.get("fork_count"),
        open_issues=meta.get("open_issues"),
        license=meta.get("license"),
        topics=list(meta.get("topics") or []),
        languages=list(meta.get("languages") or []),
        created_at=created_at,
        pushed_at=_ts(meta.get("pushed_at")),
        default_branch=meta.get("default_branch"),
        archived=bool(meta.get("is_archived")),
        fork_of=meta.get("parent"),
        fork=bool(meta.get("is_fork")),
    )


def ago(when: datetime, now: datetime | None = None) -> str:
    """"today", "3 days ago", "5 months ago", "2 years ago" (calendar days)."""
    now = now or datetime.now(UTC)
    days = (now.date() - when.astimezone(UTC).date()).days
    if days <= 0:
        return "today"
    if days < 60:
        return "1 day ago" if days == 1 else f"{days} days ago"
    if days < 730:
        return f"{days // 30} months ago"
    return f"{days // 365} years ago"


def _count(n: int | None, one: str, many: str) -> str | None:
    if n is None:
        return None
    return f"{compact(n)} {one if n == 1 else many}"


def _percent(share: float) -> str:
    p = round(share * 100)
    return "<1%" if p == 0 else f"{p}%"


def site(url: str) -> str:
    """"flask.palletsprojects.com" for a homepage URL."""
    parsed = urlparse(url if "//" in url else f"https://{url}")
    host = (parsed.netloc or url).removeprefix("www.")
    path = parsed.path.rstrip("/")
    return host + path


def about_lines(about: About, now: datetime | None = None) -> list[str]:
    """The header lines, plain text, most telling first. Only what is known."""
    lines = []
    if about.description:
        lines.append(about.description)
    if about.readme_line and about.readme_line != about.description:
        lines.append(about.readme_line)
    numbers = [s for s in (
        _count(about.stars, "star", "stars"),
        _count(about.forks, "fork", "forks"),
        _count(about.open_issues, "open issue", "open issues"),
        about.license,
    ) if s]
    if numbers:
        lines.append(" · ".join(numbers))
    if about.languages:
        lines.append(" · ".join(f"{lang['name']} {_percent(lang['share'])}"
                                for lang in about.languages))
    if about.topics:
        lines.append("Topics: " + ", ".join(about.topics[:6]))
    when = []
    if about.created_at:
        when.append(f"created {about.created_at.year}")
    if about.pushed_at:
        when.append(f"pushed {ago(about.pushed_at, now)}")
    if about.default_branch:
        when.append(about.default_branch)
    if when:
        lines.append(" · ".join(when))
    if about.homepage:
        lines.append(site(about.homepage))
    flags = []
    if about.archived:
        flags.append("Archived")
    if about.fork_of:
        flags.append(f"Fork of {about.fork_of}")
    elif about.fork:
        flags.append("A fork")
    if flags:
        lines.append(" · ".join(flags))
    return lines


def about_from_records(records: list) -> About | None:
    """From a fetch's evidence: the `:meta` record and the README, if read."""
    meta = next((r for r in records if r.evidence_id.endswith(":meta")), None)
    if meta is None:
        return None
    readme = next((r for r in records if r.evidence_id.endswith(":readme")), None)
    return about_from_meta(meta.payload, meta.timestamp,
                           readme_line(readme.payload.get("text")) if readme else None)


def _iso(when: datetime | None) -> str | None:
    return when.isoformat() if when else None


def about_to_dict(about: About) -> dict[str, Any]:
    """Shaped like `RepoAbout` in API.md (less `fetched_at`)."""
    return {
        "description": about.description, "readme_line": about.readme_line,
        "homepage": about.homepage, "stars": about.stars, "forks": about.forks,
        "open_issues": about.open_issues, "license": about.license,
        "topics": list(about.topics), "languages": [dict(x) for x in about.languages],
        "created_at": _iso(about.created_at), "pushed_at": _iso(about.pushed_at),
        "default_branch": about.default_branch, "archived": about.archived,
        "fork_of": about.fork_of, "fork": about.fork,
    }


def about_from_dict(d: dict[str, Any] | None) -> About | None:
    if not isinstance(d, dict):
        return None
    names = set(About.__slots__)
    about = About(**{k: v for k, v in d.items() if k in names})
    about.created_at, about.pushed_at = _ts(about.created_at), _ts(about.pushed_at)
    return about
