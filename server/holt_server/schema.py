"""The response bodies in API.md, as pydantic models.

These are the contract with `web/` and the browser extension: the OpenAPI
document FastAPI builds from them is turned into `web/src/lib/api-schema.ts`
(`server/scripts/export_types.sh`), and CI fails when that file is stale.

What a reader sees at the top of a report (the headline, its tone, the one
sentence under it and "Your odds") is derived here, once, from the verdict and
the counts. Every surface renders these fields instead of working them out
again, so they cannot disagree with each other or with the verdict. They are
computed fields, so reports cached before a wording change get the new wording.

Adding a field: give it a default (reports already in the cache were stored
without it), add it to API.md, and regenerate the TypeScript types.
"""

from __future__ import annotations

from typing import Literal

from holt.agent.verdict import headline as verdict_headline
from pydantic import BaseModel, ConfigDict, Field, computed_field, model_serializer

Verdict = Literal["viable", "not_viable", "insufficient_evidence"]
Mode = Literal["rules", "ai"]
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
                    "rate_limited", "quota_exceeded", "needs_key", "claim_not_ready",
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


class Odds(Model):
    """A newcomer's chances, for a report whose verdict is `viable` only."""

    level: OddsLevel
    tone: Tone
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


def verdict_line(verdict: str, s: Stats, decided_by: list[str], rule_codes: list[str]) -> str:
    """One sentence under the headline. It explains the verdict and never
    oversells it: "Worth your time" with a low merge rate or many ignored pull
    requests says so plainly."""
    n = s.outsider_attempts
    merged = f"{s.outsider_merged} of {n}"
    if verdict == "viable":
        rate = s.outsider_merged / n if n else 0.0
        silent = s.no_reply / n if n else 0.0
        low_merge, many_silent = rate < 0.1, silent > 0.4
        if low_merge or many_silent:
            buts = [b for b in (
                "most pull requests don't land" if low_merge else "",
                f"{_silent_phrase(silent)} get no reply" if many_silent else "",
            ) if b]
            return (f"Newcomers do get merged here ({merged} recently), but "
                    f"{' and '.join(buts)}, so start with one of the starter issues below.")
        if silent < 0.3:
            return ("Outside contributors get real replies here, and "
                    f"{merged} of their recent pull requests were merged.")
        return f"Outside contributors get merged here: {merged} of their recent pull requests landed."
    if verdict == "not_viable":
        # The rule that turned it down is the last one in the trace, and is a
        # plain sentence on its own, except rubber-stamping, which reads as a
        # "but" after the merge count. Reports cached before `rule_codes`
        # existed are recognised by that "But".
        last = decided_by[-1] if decided_by else ""
        if (rule_codes[-1:] == ["rubber_stamp"]
                or (not rule_codes and last.startswith("But only"))):
            return RUBBER_STAMP_LINE
        if last:
            return last
        if s.outsider_merged == 0:
            return f"None of the last {n} pull requests from outside contributors were merged."
        return (f"Only {merged} pull requests from outside contributors were merged, "
                "and most never got a useful reply.")
    return "Too few outside contributors have tried recently for Holt to say either way."


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


class Report(VerdictView):
    repo: str
    mode: Mode
    days: int
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

    @computed_field
    @property
    def verdict_line(self) -> str:
        return verdict_line(self.verdict, self.stats, self.decided_by, self.rule_codes)

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
