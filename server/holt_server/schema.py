"""The response bodies in API.md, as pydantic models.

These are the contract with `web/` and the browser extension: the OpenAPI
document FastAPI builds from them is turned into `web/src/lib/api-schema.ts`
(`server/scripts/api_types.sh`), and CI fails when that file is stale.

What a reader sees at the top of a report (the headline and its tone, then
three lines: the reason, the numbers with their dates, what to do next) and
"How this was counted" are derived here, once, from the verdict, the counts
and the rules. Every surface renders these fields instead of working them out
again, so they cannot disagree with each other or with the verdict. They are
computed fields, so reports cached before a wording change get the new wording.

Adding a field: give it a default (reports already in the cache were stored
without it), add it to API.md, and regenerate the TypeScript types.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from holt.agent.verdict import headline as verdict_headline
from holt.agent.rates import SETTLE_DAYS
from holt.agent.verdict import MIN_MERGES, hours_phrase
from pydantic import BaseModel, ConfigDict, Field, computed_field, model_serializer

# Bound here, not looked up per call: tests swap `holt.starter` for a fake.
from holt.starter import is_beginner_issue, issue_areas

Verdict = Literal["viable", "not_viable", "insufficient_evidence"]
Mode = Literal["rules", "ai"]
ContributionType = Literal["code", "docs", "tests", "design", "translations"]
Level = Literal["newcomer", "experienced"]
Tone = Literal["good", "bad", "warn"]
OddsLevel = Literal["good", "fair", "long"]
JobState = Literal["queued", "running", "done", "error"]

TONES: dict[str, Tone] = {"viable": "good", "not_viable": "bad",
                          "insufficient_evidence": "warn"}


class Model(BaseModel):
    # Stored reports may carry keys a model no longer declares (the old
    # `headline`, now computed): ignore them. Fields with defaults are still
    # always present in responses, and the generated types say so.
    model_config = ConfigDict(extra="ignore", json_schema_serialization_defaults_required=True)


# --- errors ------------------------------------------------------------------------

ErrorCode = Literal["unauthorized", "not_found", "invalid_repo", "invalid_request",
                    "rate_limited", "quota_exceeded", "needs_plan", "needs_key", "claim_not_ready",
                    "ai_unavailable", "upstream", "internal", "not_implemented"]


class Error(Model):
    # `retry_after` is left out, not null, unless it applies (errors.py).
    model_config = ConfigDict(json_schema_serialization_defaults_required=False)

    code: ErrorCode
    message: str
    retry_after: int | None = None


class ErrorBody(Model):
    error: Error


# --- the report --------------------------------------------------------------------


class Stats(Model):
    # Decided attempts only (merged, closed, or open past the settle window):
    # the denominator of every rate here. `still_open` are too new to count;
    # `closed_silently` were closed with no reply, which is not `no_reply`.
    outsider_attempts: int
    outsider_merged: int
    distinct_outsiders: int
    first_time_merged_authors: int
    no_reply: int
    median_first_response_hours: float | None
    bot_share: float
    still_open: int = 0
    closed_silently: int = 0


class PartialStats(Model):
    """The counts a find result carries: whichever the finder had. Counts it
    didn't have are left out, not null (a null reply time means "no replies")."""

    model_config = ConfigDict(json_schema_serialization_defaults_required=False)

    outsider_attempts: int | None = None
    outsider_merged: int | None = None
    distinct_outsiders: int | None = None
    first_time_merged_authors: int | None = None
    no_reply: int | None = None
    median_first_response_hours: float | None = None
    bot_share: float | None = None

    @model_serializer(mode="wrap")
    def _only_known(self, handler):
        return {k: v for k, v in handler(self).items() if k in self.model_fields_set}


class LandingPath(Model):
    path: str
    merged: int
    attempted: int


class NeverLanded(Model):
    path: str
    attempted: int


class EvidenceItem(Model):
    id: str
    url: str
    kind: str
    value: str | None = None
    text: str
    quote: str | None = None


class Cost(Model):
    model: str
    input_tokens: int
    output_tokens: int
    # What the model calls cost in US dollars, and how long the whole run took.
    # Null on reports cached before these were recorded.
    usd: float | None = None
    seconds: float | None = None


class Odds(Model):
    """A newcomer's chances, for a report whose verdict is `viable` only."""

    level: OddsLevel
    tone: Tone
    text: str


AskCode = Literal["cla", "dco", "issue_first"]


class Ask(Model):
    """Something the project asks of a contributor before a pull request, and
    where Holt read it (a CLA bot's comment, or CONTRIBUTING)."""

    code: AskCode
    url: str


class Sample(Model):
    """What the counts were read from: the newest pull requests, and who was
    left out of them before counting."""

    # Every pull request read, and when the oldest and newest were opened.
    pull_requests: int
    first_opened: str | None
    last_opened: str | None
    # Opened by the project's own team, or by bots: in no count.
    team_pull_requests: int
    team_people: int
    bot_pull_requests: int


class Counted(Model):
    """One entry of "How this was counted"."""

    topic: str
    text: str


# Thresholds for the odds. web/src/lib/format.ts colours the stat tiles with
# the same numbers, so a tile and the odds line never pull different ways.
MERGE_GOOD, MERGE_FAIR = 0.12, 0.05
NO_REPLY_GOOD, NO_REPLY_FAIR = 0.25, 0.50

ODDS_TEXT: dict[str, str] = {
    "good": "most outside pull requests get a reply, and plenty get merged",
    "fair": "some outside pull requests land; a well-chosen starter issue helps",
    "long": "most outside pull requests here don't land, so pick your first one carefully",
}
# Long odds because of silence, while merges are fine: say that instead.
LONG_SILENT_TEXT = ("many outside pull requests here never get a reply, "
                    "so pick your first one carefully")
ODDS_TONE: dict[str, Tone] = {"good": "good", "fair": "warn", "long": "bad"}


def _band(share: float, good: float, fair: float, higher_is_better: bool) -> int:
    """0 good, 1 fair, 2 long."""
    if higher_is_better:
        return 0 if share >= good else 1 if share >= fair else 2
    return 0 if share <= good else 1 if share <= fair else 2


def odds_for(verdict: str, s: Stats) -> Odds | None:
    """The worse of the merge rate and the reply rate. Only a `viable` report
    has odds: "Not worth your time" and "Not enough evidence" already are the
    answer, and odds next to them could only repeat or contradict it."""
    if verdict != "viable" or not s.outsider_attempts:
        return None
    # Whole percentages, as the stat tiles show them.
    merged = int(100 * s.outsider_merged / s.outsider_attempts + 0.5) / 100
    silent = int(100 * s.no_reply / s.outsider_attempts + 0.5) / 100
    merge_band = _band(merged, MERGE_GOOD, MERGE_FAIR, True)
    band = max(merge_band, _band(silent, NO_REPLY_GOOD, NO_REPLY_FAIR, False))
    level: OddsLevel = ("good", "fair", "long")[band]
    text = LONG_SILENT_TEXT if level == "long" and merge_band < 2 else ODDS_TEXT[level]
    return Odds(level=level, tone=ODDS_TONE[level], text=text)


def _silent_phrase(share: float) -> str:
    if 0.45 <= share <= 0.6:
        return "about half"
    if 0.6 < share < 0.72:
        return "about two in three"
    if share >= 0.72:
        return "most"
    return f"about {round(share * 100)}%"


RUBBER_STAMP_LINE = ("Outside pull requests here get merged without anyone reviewing "
                     "them, so you wouldn't get feedback on yours.")


# Rule codes that say something about the sample and never decide (API.md).
# The reason under the headline is the last rule that is not one of these.
INFO_CODES = frozenset({
    "awaiting_reply", "landed_off_button", "package_updates", "kind_contested",
    "kind_uncited", "sample_period", "dormant", "excluded", "still_open",
    "closed_silently",
})


def deciding_rule(decided_by: list[str], rule_codes: list[str]) -> tuple[str, str]:
    """The sentence and code of the rule that decided the verdict. Reports
    cached before `rule_codes` existed have no codes: their last line."""
    codes = rule_codes if len(rule_codes) == len(decided_by) else [""] * len(decided_by)
    for text, code in zip(reversed(decided_by), reversed(codes)):
        if code not in INFO_CODES:
            return text, code
    return (decided_by[-1], "") if decided_by else ("", "")


def verdict_line(verdict: str, s: Stats, decided_by: list[str], rule_codes: list[str]) -> str:
    """The first line of the report: the reason for the verdict, in one
    sentence. It never oversells: "Worth your time" with a low merge rate or
    many ignored pull requests says so plainly. The counts themselves are the
    next line (`numbers_line`), so a "Worth your time" reason doesn't repeat
    them."""
    n = s.outsider_attempts
    if verdict == "viable":
        rate = s.outsider_merged / n if n else 0.0
        silent = s.no_reply / n if n else 0.0
        low_merge, many_silent = rate < 0.1, silent > 0.4
        if low_merge or many_silent:
            buts = [b for b in (
                "most of their pull requests don't land" if low_merge else "",
                f"{_silent_phrase(silent)} get no reply" if many_silent else "",
            ) if b]
            return (f"Outside contributors do get merged here, but {' and '.join(buts)}, "
                    "so choose your first change carefully.")
        if silent < 0.3:
            return "Outside contributors get real replies here, and their work gets merged."
        return "Outside contributors get merged here, though some wait a while for a reply."
    if verdict == "not_viable":
        # Rubber-stamping reads as a "but" after the merge count, so it gets
        # its own sentence. Reports cached before `rule_codes` existed are
        # recognised by that "But".
        last, code = deciding_rule(decided_by, rule_codes)
        if code == "rubber_stamp" or (not rule_codes and last.startswith("But only")):
            return RUBBER_STAMP_LINE
        if last:
            return last
        if s.outsider_merged == 0:
            return f"None of the last {n} pull requests from outside contributors were merged."
        return (f"Only {s.outsider_merged} of {n} pull requests from outside contributors "
                "were merged, and most never got a useful reply.")
    return "Too few outside contributors have tried recently for Holt to say either way."


def _pct(part: int, whole: int) -> int:
    # Whole percentages, rounded half up, as the web's stat tiles show them.
    return int(100 * part / whole + 0.5) if whole else 0


def _date(iso: str) -> tuple[int, str, int] | None:
    try:
        d = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return d.day, d.strftime("%b"), d.year


def period(sample: Sample | None) -> str | None:
    """ "3 Jun – 26 Sep 2026": when the pull requests read were opened."""
    if sample is None or not sample.first_opened or not sample.last_opened:
        return None
    a, b = _date(sample.first_opened), _date(sample.last_opened)
    if a is None or b is None:
        return None
    end = f"{b[0]} {b[1]} {b[2]}"
    if a == b:
        return end
    start = f"{a[0]} {a[1]}" + (f" {a[2]}" if a[2] != b[2] else "")
    return f"{start} – {end}"


def numbers_line(s: Stats, sample: Sample | None) -> str:
    """The second line: what happened to outside contributors, with the dates
    it covers. The same counts as the stat tiles and the verdict's rules:
    rates are over decided pull requests, and the ones still too new to judge
    are said apart."""
    n = s.outsider_attempts
    when = period(sample)
    when = f" ({when})" if when else ""
    if not n and not s.still_open:
        return f"Nobody outside the project's team opened a pull request{when}."
    if not n:
        return (f"Outside contributors opened {s.still_open} pull "
                f"request{'' if s.still_open == 1 else 's'}{when}, all still open and "
                f"too new to judge (less than {SETTLE_DAYS} days old).")
    decided = " that have had time for an answer" if s.still_open else ""
    out = [f"Of {n} pull request{'' if n == 1 else 's'} from outside contributors{when}"
           f"{decided}, {s.outsider_merged} {'was' if s.outsider_merged == 1 else 'were'} "
           f"merged ({_pct(s.outsider_merged, n)}%)."]
    if s.median_first_response_hours is not None:
        # The median is over the ones that got a reply; say so, or a fast
        # median hides a silent majority (the next sentences give its size).
        # The engine's phrasing, so it reads the same as the rule that decided.
        out.append("When a maintainer replied, it was typically within "
                   f"{hours_phrase(s.median_first_response_hours)}.")
    else:
        out.append("No maintainer replied to any of them.")
    if s.closed_silently:
        out.append(f"{_pct(s.closed_silently, n)}% were closed without a word.")
    if s.no_reply:
        out.append(f"{_pct(s.no_reply, n)}% got no reply at all.")
    if s.still_open:
        out.append(f"Another {s.still_open} {'is' if s.still_open == 1 else 'are'} still "
                   "open and too new to count.")
    return " ".join(out)


def stat_line(s: Stats) -> str | None:
    """The short count the browser extension's chip shows next to the headline."""
    n = s.outsider_attempts
    if not n:
        return None
    return f"{s.outsider_merged} of {n} outside PR{'' if n == 1 else 's'} merged"


def first_timer_line(s: Stats) -> str | None:
    if not s.outsider_attempts:
        return None
    k = s.first_time_merged_authors
    if not k:
        return "Nobody got their first pull request merged here in this period."
    return (f"{k} {'person' if k == 1 else 'people'} got their first pull request "
            "merged here.")


# The best place to start needs this many merged outside pull requests in it;
# fewer is luck, not a pattern. A folder where this many tried and none landed
# is worth a warning.
BEST_AREA_MIN_MERGED = 3
AVOID_AREA_MIN_TRIED = 5

ASK_STEP: dict[str, str] = {
    "cla": "Sign the CLA (Contributor License Agreement) when the bot asks.",
    "dco": "Sign off every commit (git commit -s): the project asks for a DCO sign-off.",
    "issue_first": "Open an issue before you write code: CONTRIBUTING asks for that.",
}
NOT_VIABLE_STEP: dict[str, str] = {
    "archived": "Don't send a pull request here. Look for an active fork or a similar "
                "project that's still maintained.",
    "elsewhere": "Contribute where the project is really developed, not here.",
    "closed_kind": "Contribute where the project is really developed, not here.",
    "non_software_kind": "Adding an entry is fine if that's what you want. For experience "
                         "with real code, pick a different project.",
    "catalogue_shape": "Adding an entry is fine if that's what you want. For experience "
                       "with real code, pick a different project.",
    "rubber_stamp": "Your change would probably be merged, but nobody would review it. "
                    "For feedback on your code, pick a project that reviews.",
}
NOT_VIABLE_DEFAULT_STEP = ("Put your time into a project that answers outside "
                           "contributors; Holt's Find page lists some.")
INSUFFICIENT_STEP = ("There's too little to go on. Before writing code, open an issue "
                     "and ask whether a pull request would be welcome.")


def next_step(verdict: str, decided_by: list[str], rule_codes: list[str],
              landing: list[LandingPath], never_landed: list[NeverLanded],
              asks: list[Ask]) -> str:
    """The third line: what to do next, from where outside work landed and
    what the project asks of contributors. Advice only; it never decides."""
    if verdict == "not_viable":
        _, code = deciding_rule(decided_by, rule_codes)
        return NOT_VIABLE_STEP.get(code, NOT_VIABLE_DEFAULT_STEP)
    if verdict != "viable":
        return INSUFFICIENT_STEP
    areas = [a for a in landing if a.path != "(root)" and a.merged >= BEST_AREA_MIN_MERGED]
    best = max(areas, key=lambda a: (a.merged, a.merged / a.attempted), default=None)
    if best is not None:
        out = [f"Best bet: a small change in {best.path}, where {best.merged} of "
               f"{best.attempted} outside pull requests were merged."]
    else:
        out = ["Best bet: a small, focused change; a starter issue is a good place to find one."]
    avoid = next((a for a in never_landed if a.attempted >= AVOID_AREA_MIN_TRIED), None)
    if avoid is not None:
        out.append(f"Nothing from outside landed in {avoid.path} ({avoid.attempted} tried).")
    out += [ASK_STEP[a.code] for a in asks]
    return " ".join(out)


# `decided_by` lines that inform, shown in "How this was counted" under these.
INFO_TOPICS: dict[str, str] = {
    "awaiting_reply": "Too new to judge",
    "still_open": "Still open",
    "closed_silently": "Closed without a word",
    "excluded": "Drafts and spam",
    "dormant": "Recent activity",
    "landed_off_button": "Merges GitHub shows as closed",
    "package_updates": "What the work is",
    "kind_contested": "What kind of project this is",
    "kind_uncited": "What kind of project this is",
}


def verdict_rule_text(days: int) -> str:
    return (
        f"“{verdict_headline('viable')}” needs at least {MIN_MERGES} merged pull requests "
        "from outside contributors and a typical first reply within your "
        f"{days}-day budget, with people actually reviewing what gets merged. "
        f"“{verdict_headline('not_viable')}” is an archived repository, a mirror, a "
        "catalogue of entries, merges nobody reviews, or outside pull requests that "
        f"are almost all ignored. Anything in between is “{verdict_headline('insufficient_evidence')}”. "
        "These rules are fixed; no AI chooses the verdict."
    )


def counted(r: Report) -> list[Counted]:
    """ "How this was counted": the sample, who was left out and why, and the
    rule that decided it. Every number here is one the report already shows."""
    out: list[Counted] = []
    smp = r.sample
    when = period(smp)
    if smp is not None:
        text = f"The newest {smp.pull_requests} pull requests on GitHub"
        text += f", opened {when}." if when else "."
        out.append(Counted(topic="What we read", text=text))
        team = smp.team_pull_requests
        out.append(Counted(topic="The team and outside contributors", text=(
            f"{team} of them came from {smp.team_people} "
            f"{'person' if smp.team_people == 1 else 'people'} on the project's team and "
            f"{'is' if team == 1 else 'are'} left out. The team is everyone GitHub shows as an "
            "owner, member or collaborator, plus anyone the history shows merging, "
            "closing or formally reviewing other people's pull requests. Everyone else "
            "is an outside contributor, including people who come back.")))
        bots = smp.bot_pull_requests
        left = ("No pull requests were opened by bots." if not bots else
                f"{bots} pull request{'' if bots == 1 else 's'} opened by bots (dependency "
                f"updates and the like) {'is' if bots == 1 else 'are'} left out.")
        out.append(Counted(topic="Bots", text=(
            f"{left} Only a maintainer's reply counts as a reply: not a bot, a CLA "
            "check, the author, or a passer-by.")))
    elif r.evidence_until and (d := _date(r.evidence_until)):
        out.append(Counted(topic="What we read", text=(
            f"The newest pull requests on GitHub, up to {d[0]} {d[1]} {d[2]}.")))
    codes = r.rule_codes if len(r.rule_codes) == len(r.decided_by) else [""] * len(r.decided_by)
    for text, code in zip(r.decided_by, codes):
        if code in INFO_TOPICS:
            out.append(Counted(topic=INFO_TOPICS[code], text=text))
    # Every rule that weighed in, in order: a rubber-stamp "But only..." reads
    # after the merge count it qualifies.
    deciding = [t for t, c in zip(r.decided_by, codes) if c not in INFO_CODES]
    if deciding:
        out.append(Counted(topic="What decided it", text=" ".join(deciding)))
    out.append(Counted(topic="The rule", text=verdict_rule_text(r.days)))
    return out


class VerdictView(Model):
    """The headline and its colour, for anything that shows a verdict."""

    verdict: Verdict

    @computed_field
    @property
    def headline(self) -> str:
        return verdict_headline(self.verdict)

    @computed_field
    @property
    def tone(self) -> Tone:
        return TONES[self.verdict]


class HoltUsers(Model):
    """Pull requests that connected Holt users sent to this repository in the
    last `window_days`: counts only. Present only when at least 5 people who
    didn't opt out of statistics make up the numbers (repo_stats.py)."""

    people: int
    pull_requests: int
    merged: int
    # Closed without being merged.
    closed: int
    # Still open.
    waiting: int
    window_days: int
    computed_at: str


class Report(VerdictView):
    repo: str
    mode: Mode
    days: int
    # AI mode only: at most two model-written sentences, the lead of the AI
    # explanation. Null in rules mode and on reports cached before it existed.
    bottom_line: str | None = None
    summary: str | None = None
    stats: Stats
    decided_by: list[str] = Field(default_factory=list)
    # Stable codes of the rules in `decided_by`, same order (`archived`,
    # `ignored`, `merges`, `rubber_stamp`, ...). Empty on reports cached before
    # this field existed.
    rule_codes: list[str] = Field(default_factory=list)
    unknowns: list[str] = Field(default_factory=list)
    landing: list[LandingPath] = Field(default_factory=list)
    never_landed: list[NeverLanded] = Field(default_factory=list)
    evidence: list[EvidenceItem] = Field(default_factory=list)
    evidence_until: str | None = None
    generated_at: str
    cost: Cost | None = None
    # What the counts were read from. Null on reports cached before it existed.
    sample: Sample | None = None
    # What the project asks of a contributor (a CLA, a DCO sign-off, an issue
    # first), where Holt could read it. Empty means none found, not none asked.
    asks: list[Ask] = Field(default_factory=list)
    # Filled when the report is served (GET /v1/reports/{owner}/{repo}), never
    # stored with it; null when too few Holt users sent pull requests here.
    holt_users: HoltUsers | None = None

    # The top of the report, in order: `headline` and `verdict_line` (the
    # verdict and its reason), `numbers_line` (what happened, with dates),
    # `first_timer_line`, and `next_step` (what to do).
    @computed_field
    @property
    def verdict_line(self) -> str:
        return verdict_line(self.verdict, self.stats, self.decided_by, self.rule_codes)

    @computed_field
    @property
    def numbers_line(self) -> str:
        return numbers_line(self.stats, self.sample)

    @computed_field
    @property
    def first_timer_line(self) -> str | None:
        return first_timer_line(self.stats)

    @computed_field
    @property
    def next_step(self) -> str:
        return next_step(self.verdict, self.decided_by, self.rule_codes,
                         self.landing, self.never_landed, self.asks)

    @computed_field
    @property
    def stat_line(self) -> str | None:
        return stat_line(self.stats)

    @computed_field
    @property
    def counted(self) -> list[Counted]:
        return counted(self)

    @computed_field
    @property
    def odds(self) -> Odds | None:
        return odds_for(self.verdict, self.stats)


# --- starter issues and find ------------------------------------------------------


class StarterIssue(Model):
    number: int
    title: str
    url: str
    labels: list[str] = Field(default_factory=list)
    created_at: str | None = None
    comments: int = 0
    why: list[str] = Field(default_factory=list)

    # Derived from the labels and title, so cached issues get them too. The
    # web uses them with a profile: a newcomer sees only `beginner` issues,
    # and issues matching their contribution types come first.
    @computed_field
    @property
    def beginner(self) -> bool:
        return is_beginner_issue(self.labels)

    @computed_field
    @property
    def areas(self) -> list[ContributionType]:
        return issue_areas(self.labels, self.title)


class StarterIssues(Model):
    repo: str
    issues: list[StarterIssue]


class FindResult(VerdictView):
    repo: str
    description: str | None = None
    language: str | None = None
    stars: int | None = None
    stats: PartialStats = Field(default_factory=PartialStats)
    issues: list[StarterIssue] = Field(default_factory=list)


class FindQuery(Model):
    languages: list[str]
    topics: list[str]
    days: int
    hacktoberfest: bool
    limit: int


# --- jobs ---------------------------------------------------------------------------


class Queued(Model):
    status: Literal["queued"] = "queued"
    job_id: str


class AnalysisDone(Model):
    status: Literal["done"] = "done"
    report: Report


class FindDone(Model):
    status: Literal["done"] = "done"
    results: list[FindResult]


class JobStatus(Model):
    status: JobState
    stage: str | None = None
    progress: float
    report: Report | None
    error: Error | None


class FindJobStatus(Model):
    status: JobState
    stage: str | None = None
    progress: float
    results: list[FindResult] | None
    error: Error | None


class ReportListItem(Model):
    repo: str
    mode: Mode
    generated_at: str | None
    verdict: Verdict | None


class ReportList(Model):
    reports: list[ReportListItem]


# --- account ------------------------------------------------------------------------

class Credits(Model):
    """Credits: GET /v1/me/credits, and `credits` in GET /v1/me."""

    # Every credit this user can spend: free + purchased.
    balance: int
    # Welcome, weekly and gifted credits.
    free: int
    # Credits from packs (none until payments are switched on).
    purchased: int
    can_claim: bool
    # When the weekly claim opens; null only before the welcome grant.
    next_claim_at: str | None
    claim_every_days: float
    # False while the server has no model key: AI reports can't run at all.
    ai_available: bool


class Me(Model):
    # The plan in force: "free" once a paid plan has lapsed.
    plan: str
    # When that plan lapses; null for free or until changed.
    plan_expires_at: str | None
    credits: Credits


class Access(Model):
    """Whether this user can use one feature now, and what it would cost."""

    feature: str
    # The feature's name, for people.
    name: str
    allowed: bool
    # How a use is paid for now: "plan" (covered) or "credits". Null when not allowed.
    via: Literal["plan", "credits"] | None
    # Credits one use takes (0 when the plan covers it or credits can't pay for it).
    cost: int
    # The plan's monthly allowance left; null when unlimited or the plan has none.
    left_this_month: int | None
    # When not allowed: the error the request would get.
    code: str | None
    message: str | None


class Entitlements(Model):
    """GET /v1/me/entitlements."""

    plan: str
    plan_expires_at: str | None
    features: list[Access]


class AdminLot(Model):
    id: int
    origin: str
    pack_id: str | None
    reference: str | None
    granted: int
    remaining: int
    expires_at: str | None
    created_at: str


class AdminCreditEvent(Model):
    id: int
    kind: str
    source: str
    amount: int
    lot_id: int | None
    feature: str | None
    job_id: str | None
    reason: str | None
    actor: str | None
    created_at: str


class AdminPlanEvent(Model):
    id: int
    plan: str
    expires_at: str | None
    reason: str | None
    actor: str | None
    reference: str | None
    created_at: str


class AdminPlanUsage(Model):
    feature: str
    period: str
    used: int


class AdminUserSummary(Model):
    id: str
    # As stored, and the one in force (free once lapsed).
    plan: str
    effective_plan: str
    plan_expires_at: str | None
    free: int
    purchased: int
    created_at: str


class AdminUser(AdminUserSummary):
    """GET /v1/admin/users/{user_id}: everything about one user's money."""

    lots: list[AdminLot]
    ledger: list[AdminCreditEvent]
    plan_history: list[AdminPlanEvent]
    plan_usage: list[AdminPlanUsage]
    access: list[Access]


class AdminUsers(Model):
    users: list[AdminUserSummary]


class HistoryItem(Model):
    job_id: str
    status: JobState
    repo: str
    mode: Mode
    days: int
    verdict: Verdict | None
    created_at: str

    @computed_field
    @property
    def headline(self) -> str | None:
        return verdict_headline(self.verdict) if self.verdict else None

    @computed_field
    @property
    def tone(self) -> Tone | None:
        return TONES[self.verdict] if self.verdict else None


class History(Model):
    items: list[HistoryItem]


class Health(Model):
    ok: bool
    version: str
    database: bool | None = None


class GitHubAccount(Model):
    id: int
    login: str
    connected_at: str
    adult_confirmed_at: str
    # True when they chose "Don't include me in statistics".
    stats_opt_out: bool


class GitHubConnection(Model):
    connected: bool
    account: GitHubAccount | None


# --- Profile ---------------------------------------------------------------------------

class ProfilePrefs(Model):
    languages: list[str] = Field(default_factory=list)
    topics: list[str] = Field(default_factory=list)
    days: int = 7
    contributions: list[ContributionType] = Field(default_factory=list)
    level: Level = "newcomer"
    updated_at: str | None = None


class ProfileOut(Model):
    # Null until they save one.
    profile: ProfilePrefs | None
    # True when they've confirmed they're 18 or older (here or by connecting
    # GitHub): saving then doesn't ask again.
    adult_confirmed: bool


# --- My Contributions ----------------------------------------------------------------

PullState = Literal["open", "merged", "closed"]


class RepoVerdict(Model):
    """Holt's latest rules verdict for a repository, from the report cache."""

    verdict: Verdict
    checked_at: str

    @computed_field
    @property
    def headline(self) -> str:
        return verdict_headline(self.verdict)

    @computed_field
    @property
    def tone(self) -> Tone:
        return TONES[self.verdict]


class ContributionPullRequest(Model):
    repo: str
    number: int
    title: str
    url: str
    state: PullState
    draft: bool
    created_at: str
    closed_at: str | None
    merged_at: str | None
    # null when Holt has no report for the repository yet.
    verdict: RepoVerdict | None
    # Opened within 30 days after this user looked at the repository on Holt.
    found_via_holt: bool


class ContributionSummary(Model):
    opened: int
    merged: int
    # Still open: waiting for a decision.
    waiting: int
    # Closed without being merged.
    closed: int
    # merged / (merged + closed); null until any pull request was decided.
    landed_share: float | None
    found_via_holt: int


class Contributions(Model):
    login: str
    # When GitHub was last read for this user.
    fetched_at: str
    # The refresh button works again from this time; null means now.
    next_refresh_at: str | None
    # How far back the list goes, and whether GitHub had more than we keep.
    window_days: int
    truncated: bool
    summary: ContributionSummary
    pull_requests: list[ContributionPullRequest]


class ContributionMetric(Model):
    """The product metric: pull requests opened after checking a repo on Holt.
    Counts only, no people."""

    since: str
    window_days: int
    connected_users: int
    users_with_pull_requests: int
    users_with_pr_after_holt: int
    prs_after_holt: int
    prs_after_holt_merged: int


# --- the playbook ("How to get merged here") -----------------------------------------

PlaybookSectionKey = Literal["must_do", "size_and_scope", "reviewers", "closing_reasons",
                             "checklist"]


class PlaybookSource(Model):
    """A counted fact behind a playbook item."""

    statement: str
    # "Seen in `seen` of `of`" pull requests; null for a fact from a document
    # (the contributing guide, CODEOWNERS) rather than a count.
    seen: int | None = None
    of: int | None = None
    # Example pull requests (or the document) on GitHub.
    links: list[str] = Field(default_factory=list)


class PlaybookItem(Model):
    # Plain English; may contain Markdown code spans (check names, paths), never HTML.
    text: str
    sources: list[PlaybookSource] = Field(default_factory=list)


class PlaybookExample(Model):
    """A closed pull request and what someone in the project wrote on it."""

    number: int
    url: str
    title: str = ""
    who: str
    quote: str


class PlaybookClosingReason(Model):
    reason: str
    explanation: str = ""
    # Closed outside pull requests that showed this reason, of those read.
    seen: int
    of: int
    examples: list[PlaybookExample] = Field(default_factory=list)


class PlaybookSections(Model):
    """In display order. Any may be empty: show nothing for an empty one."""

    must_do: list[PlaybookItem] = Field(default_factory=list)
    size_and_scope: list[PlaybookItem] = Field(default_factory=list)
    reviewers: list[PlaybookItem] = Field(default_factory=list)
    closing_reasons: list[PlaybookClosingReason] = Field(default_factory=list)
    checklist: list[PlaybookItem] = Field(default_factory=list)


class Playbook(Model):
    repo: str
    generated_at: str
    # The model that worded it. It never decides a count or a quote.
    model: str | None = None
    # Say once, near the top, when present (e.g. the counts cover everyone's
    # pull requests because too few outside ones were merged).
    note: str | None = None
    # How far back pull requests were read.
    window_days: int | None = None
    archived: bool = False
    sections: PlaybookSections


class PlaybookTeaserSection(Model):
    key: PlaybookSectionKey
    count: int


class PlaybookTeaser(Model):
    """What anyone sees before paying: which sections this repository's
    playbook has, and its first must-do."""

    sections: list[PlaybookTeaserSection]
    first: PlaybookItem | None
    generated_at: str


class PlaybookJob(Model):
    job_id: str
    status: JobState
    stage: str | None = None
    progress: float


class PlaybookState(Model):
    """GET /v1/playbook/{owner}/{repo}."""

    repo: str
    # False when this server runs without paid features: hide the section.
    available: bool
    # Null until someone has had this repository's playbook written.
    teaser: PlaybookTeaser | None
    # The full playbook, only for a signed-in user who unlocked it.
    playbook: Playbook | None
    unlocked: bool
    # Signed in: whether they can unlock it now and what it costs. Null when signed out.
    access: Access | None
    # Whether any way to pay for a playbook is on sale (a plan or a credit pack).
    on_sale: bool
    # This user's playbook for this repository, while it is being written.
    job: PlaybookJob | None


class PlaybookDone(Model):
    status: Literal["done"] = "done"
    playbook: Playbook


class PlaybookJobStatus(Model):
    status: JobState
    stage: str | None = None
    progress: float
    playbook: Playbook | None
    error: Error | None
