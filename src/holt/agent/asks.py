"""What a project asks of a contributor before it will take a pull request.

Read from evidence Holt already has, and only where it is unambiguous:

- a CLA (Contributor License Agreement): a CLA bot commented on outside pull
  requests in the sample. Not from CONTRIBUTING: free-programming-books has a
  "Contributor License Agreement" heading that only means "you agree to the
  licence", with nothing to sign;
- a DCO sign-off: CONTRIBUTING names the "Developer Certificate of Origin";
- an issue first: CONTRIBUTING says, in so many words, to open an issue or
  discuss the change before sending a pull request;
- a ticket first: the bot that closed outside pull requests says they need a
  ticket in the project's tracker (django's Trac). The tracker's link is
  quoted from the bot;
- no AI-written pull requests: outside pull requests closed and labelled or
  retitled as AI ("bot:ai-policy-close" on ruff, "AI junk" on flask), or a
  written rule against them in CONTRIBUTING or an AI policy file. Where the
  project only asks you to say whether you used AI, that is a separate ask,
  and a ban outranks it;
- tests approved first, and a team to find: most outside pull requests carry
  `needs-ok-to-test` / `ok-to-test`, or a `sig/<area>` label (kubernetes);
- search for duplicates: several outside pull requests closed as a duplicate.

These never touch the verdict. They are advice for the next step, and each
one links to where it was read so the reader can check it. Where nothing is
found, nothing is said: the absence of a match is not a claim that the project
asks for nothing.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass

from holt.agent.signals import build_threads
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


# A bot's closing comment that names a tracker ticket as the missing piece:
# django's "Missing Trac Ticket", "Trac Ticket Not Ready for a Pull Request".
_TICKET = re.compile(
    r"\b(?:missing|no|valid|accepted|triaged|linked)\b[^\n.]{0,30}\bticket\b"
    r"|\bticket\b[^\n.]{0,30}\b(?:not\s+ready|missing|required)\b",
    re.I,
)
_URL = re.compile(r"https?://[^\s)>\]\"'`*]+")

# Closes marked as AI by a label: "rejected AI", "bot:ai-policy-close",
# "reason: ai generated pr". Labels that only record AI use ("llm-assisted",
# "assisted: ai") are not a ban: rust and nixpkgs merge those.
_AI_CLOSE_LABEL = re.compile(
    r"\b(?:ai|llm)\b.*\b(?:rejected|junk|slop|spam|policy close|generated)\b"
    r"|\b(?:rejected|junk|slop|spam)\b.*\b(?:ai|llm)\b"
)
# ...by a title a maintainer rewrote ("AI junk", "[rejected AI] add a guide"),
_AI_CLOSE_TITLE = re.compile(r"^\s*\[rejected\s+ai\]|^\W*ai\s+(?:junk|spam|slop)\W*$", re.I)
# ...or by the closing bot's own words (fastapi: "marked as potentially AI
# generated and will be closed").
_AI_CLOSE_COMMENT = re.compile(r"\b(?:AI|LLM)[- ]generated\b[^.\n]{0,60}\bclos", re.I)

# A written ban. Kept to sentences that say AI-written work is not accepted or
# will be closed: "AI tools are welcome as an aid" or "follow our AI policy"
# say nothing either way.
_AI = r"(?:generative\s+AI|AI|LLMs?)"
_MADE = r"(?:generated|written|created|made)"
_AI_BAN = re.compile(
    rf"\b(?:not|never|n't)\s+(?:be\s+)?accept\w*\b[^.\n]{{0,60}}"
    rf"(?:\b{_AI}[- ]?{_MADE}\b|\b{_MADE}\s+(?:by|with|using)\s+(?:an?\s+)?{_AI}\b)"
    rf"|\b{_AI}[- ](?:generated|written)\b[^.\n]{{0,80}}\b(?:will\s+be\s+(?:closed|rejected)"
    rf"|(?:are|is)\s+(?:not\s+accepted|not\s+allowed|rejected|banned|prohibited))"
    rf"|\b{_MADE}\b[^.\n]{{0,60}}\b{_AI}\b[^.\n]{{0,80}}\bwill\s+be\s+(?:closed|rejected)",
    re.I,
)
# A rule to say whether AI was used: "disclose" or "declare" in the same
# sentence as AI, and not a security policy's "responsible disclosure".
_DISCLOSE = re.compile(r"\b(?:disclos\w*|declare)\b", re.I)
_AI_WORD = re.compile(rf"\b{_AI}\b|\bAI/LLM\b")
_SECURITY = re.compile(r"secur|vulnerab", re.I)
_SENTENCE = re.compile(r"(?<=[.!?])\s+|\n+")

_OK_TO_TEST = {"needs-ok-to-test", "ok-to-test"}
_DUPLICATE = re.compile(r"\bduplicate\s+(?:of|with)\s+(?:#\d+|https://github\.com/\S+/pull/\d+)"
                        r"|\bduplicates?\s+#\d+", re.I)

# How many outside pull requests must show a closing pattern before it is an
# ask, and what share must carry a label for "most".
MIN_CLOSES = 2
MIN_DUPLICATES = 5
MIN_LABELLED = 5
MOST = 0.5

# Blocking asks first: what gets a pull request closed before anyone reads it.
ORDER = ("ticket_first", "no_ai_prs", "ok_to_test", "sig_team", "cla", "dco", "issue_first",
         "ai_disclosure", "duplicates")


@dataclass(frozen=True, slots=True)
class Ask:
    code: str  # one of ORDER
    url: str  # where it was read: a bot's comment, a pull request, or a document
    # A link the source itself gives (the tracker a bot names), when there is one.
    link: str | None = None


def is_cla_bot(login: str | None) -> bool:
    return bool(login) and bool(_CLA_BOT.search(login or ""))


def _key(evidence_id: str) -> str:
    return ":".join(evidence_id.split(":")[:2])


def _flat(label: str) -> str:
    return " ".join(re.sub(r"[-_:/.]+", " ", label.lower()).split())


def _sentences(text: str) -> list[str]:
    return [s for s in _SENTENCE.split(re.sub(r"[*_]", "", text)) if s.strip()]


def _discloses(text: str) -> bool:
    return any(_DISCLOSE.search(s) and _AI_WORD.search(s) and not _SECURITY.search(s)
               for s in _sentences(text))


def _origin(url: str) -> str:
    scheme, _, rest = url.partition("://")
    return f"{scheme}://{rest.split('/')[0]}".rstrip(".,;:")


def read(records: Iterable[EvidenceRecord], outsider_keys: set[str] | None = None) -> list[Ask]:
    """Every ask found, in ORDER. `outsider_keys` limits the pull-request checks
    to those pull requests (a bot greeting staff says nothing about outsiders);
    None reads every one."""
    records = list(records)
    found: dict[str, Ask] = {}

    def outside(key: str) -> bool:
        return outsider_keys is None or key in outsider_keys

    comments: dict[str, list[EvidenceRecord]] = {}
    for r in records:
        if ":comment:" in r.evidence_id or ":review:" in r.evidence_id:
            comments.setdefault(_key(r.evidence_id), []).append(r)
    for key, said in comments.items():
        if not outside(key):
            continue
        cla = next((r for r in said if is_cla_bot(r.payload.get("author")) and r.url), None)
        if cla is not None:
            found.setdefault("cla", Ask("cla", cla.url))
            break

    threads = [t for t in build_threads(records).values()
               if outside(t.key) and not t.author_is_bot and not t.draft]
    newest_first = sorted(threads, key=lambda t: t.opened_at, reverse=True)
    url = {r.evidence_id: r.url for r in records if r.evidence_id.endswith(":opened")}

    def pr_url(t) -> str:
        return url.get(f"{t.key}:opened") or ""

    tickets: list[tuple[str, str | None]] = []
    ai_closes: list[str] = []
    ai_disclosure_closes: list[str] = []
    duplicates: list[str] = []
    for t in newest_first:
        if not t.closed_unmerged or t.merged:
            continue
        said = comments.get(t.key, [])
        by_closer = [r for r in said if t.closed_by_bot and r.payload.get("author") == t.closed_by]
        if any(_AI_CLOSE_LABEL.search(_flat(label)) for label in t.labels) \
                or _AI_CLOSE_TITLE.search(t.title) \
                or any(_AI_CLOSE_COMMENT.search(r.payload.get("body") or "") for r in by_closer):
            ai_closes.append(pr_url(t))
        for r in by_closer:
            body = r.payload.get("body") or ""
            if m := _TICKET.search(body):
                link = _URL.search(body, m.end())
                tickets.append((r.url or pr_url(t), _origin(link.group(0)) if link else None))
                break
        if any(_discloses(r.payload.get("body") or "") for r in by_closer):
            ai_disclosure_closes.append(pr_url(t))
        if any("duplicate" in label.lower() for label in t.labels) or any(
                _DUPLICATE.search(r.payload.get("body") or "") for r in said
                if r.payload.get("author") != t.author):
            duplicates.append(pr_url(t))

    if len(tickets) >= MIN_CLOSES:
        links = [link for _, link in tickets if link]
        link = max(set(links), key=links.count) if links else None
        found["ticket_first"] = Ask("ticket_first", tickets[0][0], link)
    if len(duplicates) >= MIN_DUPLICATES:
        found["duplicates"] = Ask("duplicates", duplicates[0])

    for code, labelled in (("ok_to_test", lambda ls: bool(_OK_TO_TEST & ls)),
                           ("sig_team", lambda ls: any(x.startswith("sig/") for x in ls))):
        hits = [t for t in newest_first if labelled({x.lower() for x in t.labels})]
        if len(hits) >= MIN_LABELLED and len(hits) >= MOST * len(threads):
            found[code] = Ask(code, pr_url(hits[0]))

    docs = [r for r in records if r.evidence_id.endswith((":contributing", ":ai_policy"))
            and r.url and r.payload.get("text")]
    for doc in docs:
        text = doc.payload["text"]
        if doc.evidence_id.endswith(":contributing"):
            if _DCO_DOC.search(text):
                found.setdefault("dco", Ask("dco", doc.url))
            if _ISSUE_FIRST_DOC.search(text):
                found.setdefault("issue_first", Ask("issue_first", doc.url))
        if _AI_BAN.search(re.sub(r"[*_]", "", text)):
            found.setdefault("no_ai_prs", Ask("no_ai_prs", doc.url))
        elif _discloses(text):
            found.setdefault("ai_disclosure", Ask("ai_disclosure", doc.url))
    if len(ai_closes) >= MIN_CLOSES:
        found.setdefault("no_ai_prs", Ask("no_ai_prs", ai_closes[0]))
    if len(ai_disclosure_closes) >= MIN_CLOSES:
        found.setdefault("ai_disclosure", Ask("ai_disclosure", ai_disclosure_closes[0]))
    if "no_ai_prs" in found:
        found.pop("ai_disclosure", None)
    return [found[c] for c in ORDER if c in found]
