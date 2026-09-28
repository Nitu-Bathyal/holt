"""A hard cap on what this environment spends on AI models.

`HOLT_AI_BUDGET_USD` is the most this server may ever spend on models: AI
reports on its own key, and the playbooks and pre-flight summaries the
paid-features service writes for it (that service is only reached through
this server's jobs, so its spend is counted here too). 0, the default, turns
AI off.

How it holds:

* **Queueing** a job that may call a model holds its most expensive possible
  run (`HOLT_AI_RUN_MAX_USD`, or `HOLT_AI_PRO_RUN_MAX_USD` for the service)
  from the budget, in the transaction that charges the user's credit, with a
  guarded `UPDATE` on the one `ai_budget` row. If that would pass the budget
  the request is refused, rolled back and nothing is charged. So runs racing
  each other can never take the total past the budget.
* **Running** it claims that hold; a job run a second time (its process died
  and it was queued again) needs a new one, and fails, refunded, without it.
* An AI report's model is wrapped in `Capped`, which refuses a call that
  could take the run past its hold, reckoned from the call's output cap
  (`holt.model.max_output_tokens`) and the size of its prompt (waiting first
  for calls still out, when the call would fit once they are done).
* **Ending** it records what it really cost and gives back the rest of the
  hold. A run whose cost isn't known (it timed out, and may still be going)
  keeps its whole hold.

`GET /v1/admin/ai-spend` and `python -m holt_server.budget` say
"AI spend: $x of $y".
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import math
import threading
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from sqlalchemy import func, select, update

from holt.model import max_output_tokens, resolve_price
from holt_server.db import AiBudget, AiRun, Job, now
from holt_server.errors import ApiError

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from holt_server.services import Services
    from holt_server.settings import Settings

log = logging.getLogger("holt_server.budget")

MICROS = 1_000_000
ANALYSIS, PLAYBOOK, PREFLIGHT = "analysis", "playbook", "preflight"


def to_micros(usd: float) -> int:
    return math.ceil(round(usd * MICROS, 3))


def limit_usd(settings: Settings) -> float:
    """The budget in force: 0 when AI is off. In production a budget needs the
    owner's `HOLT_AI_BUDGET_OWNER_OK=1` too."""
    if settings.ai_budget_usd <= 0:
        return 0.0
    if settings.env == "production" and not settings.ai_budget_owner_ok:
        return 0.0
    return settings.ai_budget_usd


def refused_in_production(settings: Settings) -> bool:
    """A budget set in production without the owner's say-so (logged at startup)."""
    return limit_usd(settings) == 0 and settings.ai_budget_usd > 0


def run_max_usd(settings: Settings, kind: str) -> float:
    return settings.ai_run_max_usd if kind == ANALYSIS else settings.ai_pro_run_max_usd


def kind_of(job: Job) -> str | None:
    """Which budgeted run a job is, or None when it can't call a model."""
    if job.kind == "analysis":
        return ANALYSIS if job.mode == "ai" else None
    if job.kind == "playbook":
        return PLAYBOOK
    if job.kind == "preflight":
        return PREFLIGHT if (job.params or {}).get("summary") else None
    return None


def switched_off() -> ApiError:
    return ApiError("ai_unavailable", "AI features aren't switched on here. "
                    "Nothing was charged.")


def used_up() -> ApiError:
    return ApiError("ai_unavailable", "The AI budget for this environment is used up, "
                    "so AI features are paused. Nothing was charged. The free quick "
                    "report still has the full verdict and evidence.",
                    reason="ai_budget_used_up")


async def reserve(s: AsyncSession, settings: Settings, job_id: str, kind: str, *,
                  started: bool = False) -> None:
    """Hold one run's most from the budget, inside the caller's transaction.
    Raises `ai_unavailable` (the caller rolls back) when it doesn't fit."""
    cap = to_micros(limit_usd(settings))
    if cap <= 0:
        raise switched_off()
    held = to_micros(run_max_usd(settings, kind))
    done = await s.execute(
        update(AiBudget)
        .where(AiBudget.id == 1, AiBudget.committed_micros + held <= cap)
        .values(committed_micros=AiBudget.committed_micros + held))
    if done.rowcount != 1:
        spent = (await s.execute(select(AiBudget.committed_micros))).scalar() or 0
        log.warning("ai budget: refused a %s run (job %s): $%.4f of $%.2f committed, "
                    "a run holds $%.4f", kind, job_id, spent / MICROS, cap / MICROS,
                    held / MICROS)
        raise used_up()
    s.add(AiRun(job_id=job_id, kind=kind, reserved_micros=held,
                started_at=now() if started else None))


async def start(svc: Services, job: Job) -> None:
    """Claim the hold the job was queued with, or hold again for a job being
    run a second time. Raises `ai_unavailable` when there is no room."""
    kind = kind_of(job)
    if kind is None:
        return
    async with svc.db.session() as s:
        claimed = await s.execute(
            update(AiRun).where(AiRun.job_id == job.id, AiRun.started_at.is_(None),
                                AiRun.settled_at.is_(None))
            .values(started_at=now()))
        if claimed.rowcount == 0:
            await reserve(s, svc.settings, job.id, kind, started=True)
        await s.commit()


async def settle(s: AsyncSession, job_id: str, usd: float | None) -> None:
    """Record what the job's run cost and give back the rest of its hold, in
    the job's finishing transaction. `usd=None`: not known, keep the hold."""
    run = (await s.execute(
        select(AiRun).where(AiRun.job_id == job_id, AiRun.started_at.is_not(None),
                            AiRun.settled_at.is_(None))
        .order_by(AiRun.id.desc()).limit(1))).scalar_one_or_none()
    if run is None:
        return
    cost = run.reserved_micros if usd is None else to_micros(max(usd, 0.0))
    marked = await s.execute(
        update(AiRun).where(AiRun.id == run.id, AiRun.settled_at.is_(None))
        .values(cost_micros=cost, estimated=usd is None, settled_at=now()))
    if marked.rowcount != 1:
        return
    # Can go up as well as down: a run a little over its estimate is counted in full.
    await s.execute(update(AiBudget).where(AiBudget.id == 1).values(
        committed_micros=AiBudget.committed_micros + cost - run.reserved_micros))
    if cost > run.reserved_micros:
        log.warning("ai budget: job %s cost $%.4f, more than the $%.4f it held",
                    job_id, cost / MICROS, run.reserved_micros / MICROS)


def pro_cost(body: dict[str, Any]) -> float | None:
    """What a service answer cost, from what it says: nothing when it came
    from its cache or made no model call; else its `usage` (cost, or tokens
    priced like the engine's); None when it doesn't say."""
    if body.get("cached"):
        return 0.0
    summary = body.get("summary")
    if isinstance(summary, dict) and summary.get("model") is None:
        return 0.0  # pre-flight with nothing worth summarising: no call was made
    usage = body.get("usage")
    if not isinstance(usage, dict):
        return None
    if isinstance(usage.get("cost_usd"), int | float):
        return float(usage["cost_usd"])
    rates, _ = resolve_price(str(usage.get("model") or body.get("model") or ""))
    if rates is None:
        return None
    return (int(usage.get("prompt_tokens") or 0) * rates[0]
            + int(usage.get("completion_tokens") or 0) * rates[1]) / MICROS


# --- one AI report's model calls ----------------------------------------------------------


# Characters per token when guessing a prompt's size before sending it. English
# and JSON run at about four; three leaves room.
CHARS_PER_TOKEN = 3


class Capped:
    """The job's model client, refusing any call that could take the run past
    `limit`: what it has spent, plus the worst case of the calls still out
    (stages run at once), plus this call's worst case, from its output cap and
    a generous guess at its prompt's tokens. A call that would fit once the
    calls still out have finished waits for them instead."""

    def __init__(self, inner: Any, model: str, limit: float) -> None:
        self.inner = inner
        self.limit = limit
        rates, _ = resolve_price(model)
        if rates is None:
            raise ApiError("ai_unavailable", "AI reports aren't switched on here: the "
                           "model has no known price, so its cost can't be capped.")
        self.rates = rates
        self._done = threading.Condition()
        self._out = 0.0

    def ceiling(self, label: str, system: str, prompt: str, schema: dict) -> float:
        chars = len(system) + len(prompt) + len(json.dumps(schema))
        tokens_in = chars // CHARS_PER_TOKEN + 100
        return (tokens_in * self.rates[0] + max_output_tokens(label) * self.rates[1]) / MICROS

    def complete(self, *, label: str, system: str, prompt: str, schema: dict) -> dict:
        worst = self.ceiling(label, system, prompt, schema)
        with self._done:
            while True:
                spent = float(self.inner.usage.cost_usd or 0.0)
                if spent + self._out + worst <= self.limit:
                    break
                if self._out <= 0:
                    log.warning("ai budget: refused a %s call: $%.4f spent, it could cost "
                                "$%.4f, the run may cost $%.4f", label, spent, worst,
                                self.limit)
                    raise ApiError("upstream", "This AI report needed more model work "
                                   "than one report is allowed, so we stopped it. You "
                                   "weren't charged for it.")
                self._done.wait()
            self._out += worst
        try:
            return self.inner.complete(label=label, system=system, prompt=prompt,
                                       schema=schema)
        finally:
            with self._done:
                self._out -= worst
                self._done.notify_all()

    def __getattr__(self, name: str) -> Any:
        return getattr(self.inner, name)


# --- the spend so far ---------------------------------------------------------------------


@dataclass
class Spend:
    budget_usd: float
    committed_usd: float  # spent, plus what running jobs hold
    spent_usd: float  # recorded cost of finished runs
    runs: int
    running: int

    @property
    def line(self) -> str:
        if self.budget_usd <= 0:
            return f"AI spend: ${self.spent_usd:.2f} (AI is off)"
        held = self.committed_usd - self.spent_usd
        more = f", ${held:.2f} held by {self.running} running" if self.running else ""
        return f"AI spend: ${self.spent_usd:.2f} of ${self.budget_usd:.2f}{more}"


async def spend(svc: Services) -> Spend:
    async with svc.db.session() as s:
        committed = (await s.execute(select(AiBudget.committed_micros))).scalar() or 0
        spent, runs = (await s.execute(
            select(func.coalesce(func.sum(AiRun.cost_micros), 0), func.count())
            .where(AiRun.settled_at.is_not(None)))).one()
        running = (await s.execute(select(func.count()).where(
            AiRun.settled_at.is_(None)))).scalar() or 0
    return Spend(budget_usd=limit_usd(svc.settings), committed_usd=committed / MICROS,
                 spent_usd=int(spent) / MICROS, runs=int(runs), running=int(running))


def startup_line(settings: Settings) -> tuple[int, str]:
    """The one line the server logs about AI at startup, and its level."""
    if refused_in_production(settings):
        return logging.ERROR, ("AI: off. HOLT_AI_BUDGET_USD is set in production without "
                               "HOLT_AI_BUDGET_OWNER_OK=1, so it is ignored")
    if limit_usd(settings) <= 0:
        return logging.INFO, "AI: off (HOLT_AI_BUDGET_USD is 0)"
    if not settings.openrouter_api_key:
        return logging.INFO, (f"AI: budget ${limit_usd(settings):.2f}, but AI reports are off "
                              "(no OPENROUTER_API_KEY)")
    if resolve_price(settings.openrouter_model)[0] is None:
        return logging.ERROR, (f"AI: off. {settings.openrouter_model} has no known price, "
                               "so its spend can't be capped")
    return logging.INFO, (f"AI: on, budget ${limit_usd(settings):.2f}, "
                          f"${settings.ai_run_max_usd:.2f} a report")


def main(argv: list[str] | None = None) -> int:
    """`python -m holt_server.budget`: print the spend against $DATABASE_URL."""
    from holt_server.services import Services
    from holt_server.settings import get_settings

    argparse.ArgumentParser(description="Print this environment's AI spend.").parse_args(argv)

    async def go() -> Spend:
        svc = Services(get_settings())
        try:
            return await spend(svc)
        finally:
            await svc.db.dispose()
            svc.http.close()

    result = asyncio.run(go())
    print(result.line)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
