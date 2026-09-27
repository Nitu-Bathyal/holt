""""Was this verdict right?": answers from report pages, and their export.

    POST /v1/feedback                              (see API.md)
    python -m holt_server.feedback export [--format csv|json] [--out FILE] [--since DATE]

Each answer is tied to the report row the person was shown (its id, its
`generated_at` and the verdict it showed), so it stays a label for that exact
version after the repo is checked again. One answer per person per version:
answering again updates the row. A person is their user id when signed in,
else a salted hash of their IP; the raw IP is never stored.

The export is the labelled data the engine's golden set grows from: one row per
answer, with the report's key numbers alongside.
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import hashlib
import hmac
import json
import re
import sys
from datetime import UTC, datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from holt_server import repos
from holt_server.api import Caller, caller, services
from holt_server.db import Feedback, Report, iso, now
from holt_server.errors import ApiError
from holt_server.schema import Mode, Model
from holt_server.services import Services

router = APIRouter(prefix="/v1")

# Answers per hour. Generous next to analyses: an answer costs one small row.
ANON_PER_HOUR = 30
USER_PER_HOUR = 120
REASON_MAX = 500


Vote = Literal["up", "down"]


class FeedbackIn(BaseModel):
    repo: str = Field(max_length=500)
    mode: Mode = "rules"
    days: int = Field(7, ge=1, le=90)
    # The `generated_at` of the report on screen: which version is being judged.
    generated_at: str = Field(min_length=1, max_length=40)
    vote: Vote
    reason: str | None = Field(None, max_length=2000)


class FeedbackOut(Model):
    """The answer as saved, with the verdict of the report it is about."""

    repo: str
    generated_at: str
    verdict: str
    vote: Vote
    reason: str | None


def ip_hash(svc: Services, ip: str) -> str:
    """Salted, keyed hash of an IP: the same visitor maps to the same value,
    and it can't be reversed without the server's secret."""
    s = svc.settings
    salt = f"holt-feedback-ip|{s.secret_key or s.internal_key}".encode()
    return hmac.new(salt, ip.encode(), hashlib.sha256).hexdigest()


def clean_reason(reason: str | None) -> str | None:
    text = re.sub(r"\s+", " ", reason or "").strip()
    return text[:REASON_MAX] or None


def limit(svc: Services, who: Caller) -> None:
    """Its own counters (keyed apart in the read limiter): answering never uses
    up analyses or page reads."""
    if not who.user_id and not who.ip:
        raise ApiError("invalid_request",
                       "Anonymous requests must say who is asking (X-Holt-Client-Ip).")
    per_hour = USER_PER_HOUR if who.user_id else ANON_PER_HOUR
    try:
        svc.read_limiter.hit(f"feedback:{who.rate_key}", per_hour)
    except ApiError as exc:
        raise ApiError("rate_limited", "Thanks, that's a lot of answers for one hour. "
                       "Please try again a little later.", retry_after=exc.retry_after) from exc


async def shown_report(svc: Services, repo: str, mode: str, days: int,
                       generated_at: str) -> Report:
    async with svc.db.session() as s:
        report = (await s.execute(
            select(Report).where(Report.repo_key == repos.key(repo), Report.mode == mode,
                                 Report.days == days,
                                 Report.report["generated_at"].as_string() == generated_at)
            .order_by(Report.id.desc()).limit(1)
        )).scalar_one_or_none()
    if report is None:
        raise ApiError("not_found", "We couldn't find that report any more. "
                       "Reload the page and try again.")
    return report


@router.post("/feedback")
async def post_feedback(body: FeedbackIn, request: Request,
                        who: Caller = Depends(caller)) -> FeedbackOut:
    svc = services(request)
    repo = repos.normalize(body.repo)
    limit(svc, who)
    report = await shown_report(svc, repo, body.mode, body.days, body.generated_at)
    if who.user_id:
        voter, user_id, hashed = f"user:{who.user_id}", who.user_id, None
    else:
        hashed = ip_hash(svc, who.ip)
        voter, user_id = f"ip:{hashed}", None
    values = {"vote": body.vote, "reason": clean_reason(body.reason),
              # The verdict comes from the stored report, not from the browser.
              "verdict": str(report.report.get("verdict") or ""), "updated_at": now()}
    row = await upsert(svc, report, voter, values,
                       {"user_id": user_id, "ip_hash": hashed})
    return FeedbackOut(repo=row.repo, generated_at=row.generated_at, verdict=row.verdict,
                       vote=row.vote, reason=row.reason)


async def upsert(svc: Services, report: Report, voter: str, values: dict[str, Any],
                 who: dict[str, Any]) -> Feedback:
    """Insert, or update this person's answer for this version. The unique
    index decides a race between two first answers; the loser updates."""
    for _ in range(2):
        async with svc.db.session() as s:
            row = (await s.execute(select(Feedback).where(
                Feedback.report_id == report.id, Feedback.voter == voter)
            )).scalar_one_or_none()
            if row is None:
                row = Feedback(report_id=report.id, repo=report.repo,
                               repo_key=report.repo_key, mode=report.mode, days=report.days,
                               generated_at=str(report.report.get("generated_at") or ""),
                               voter=voter, created_at=values["updated_at"], **who, **values)
                s.add(row)
            else:
                for k, v in values.items():
                    setattr(row, k, v)
            try:
                await s.commit()
            except IntegrityError:
                await s.rollback()
                continue
            return row
    raise ApiError("internal", "Something went wrong saving your answer. Please try again.")


# --- export ---------------------------------------------------------------------


# The report's key numbers, copied next to each answer.
STATS = ["outsider_attempts", "outsider_merged", "distinct_outsiders", "no_reply",
         "median_first_response_hours"]
FIELDS = [
    "repo", "mode", "days", "report_id", "generated_at", "evidence_until", "verdict",
    "vote", "reason", "signed_in", "voter", "created_at", "updated_at", *STATS,
]


def pseudonym(voter: str) -> str:
    """Stable per person, so repeat voters can be spotted, but no user id or IP hash."""
    return hashlib.sha256(voter.encode()).hexdigest()[:16]


async def export_rows(svc: Services, since: datetime | None = None) -> list[dict[str, Any]]:
    query = (select(Feedback, Report.report).join(Report, Report.id == Feedback.report_id,
                                                   isouter=True)
             .order_by(Feedback.updated_at, Feedback.id))
    if since is not None:
        query = query.where(Feedback.updated_at >= since)
    async with svc.db.session() as s:
        rows = (await s.execute(query)).all()
    out = []
    for fb, report in rows:
        report = report or {}
        stats = report.get("stats") or {}
        out.append({
            "repo": fb.repo, "mode": fb.mode, "days": fb.days, "report_id": fb.report_id,
            "generated_at": fb.generated_at, "evidence_until": report.get("evidence_until"),
            "verdict": fb.verdict, "vote": fb.vote, "reason": fb.reason,
            "signed_in": fb.user_id is not None, "voter": pseudonym(fb.voter),
            "created_at": iso(fb.created_at), "updated_at": iso(fb.updated_at),
            **{k: stats.get(k) for k in STATS},
        })
    return out


def write(rows: list[dict[str, Any]], fmt: str, out) -> None:
    if fmt == "json":
        json.dump(rows, out, indent=2, ensure_ascii=False)
        out.write("\n")
        return
    w = csv.DictWriter(out, fieldnames=FIELDS, lineterminator="\n")
    w.writeheader()
    w.writerows(rows)


def parse_since(value: str) -> datetime:
    when = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return when if when.tzinfo else when.replace(tzinfo=UTC)


async def _export(svc: Services, fmt: str, path: str | None, since: datetime | None) -> int:
    try:
        rows = await export_rows(svc, since)
    finally:
        await svc.db.dispose()
        svc.http.close()
    if path and path != "-":
        with open(path, "w", encoding="utf-8", newline="") as f:
            write(rows, fmt, f)
        print(f"wrote {len(rows)} answers to {path}", file=sys.stderr)
    else:
        write(rows, fmt, sys.stdout)
    return 0


def main(argv: list[str] | None = None) -> int:
    from holt_server.settings import get_settings

    p = argparse.ArgumentParser(prog="python -m holt_server.feedback",
                                description="Export 'Was this verdict right?' answers.")
    sub = p.add_subparsers(dest="command", required=True)
    e = sub.add_parser("export", help="write every answer as CSV or JSON")
    e.add_argument("--format", choices=("csv", "json"), default="csv")
    e.add_argument("--out", help="file to write (default: stdout)")
    e.add_argument("--since", type=parse_since,
                   help="only answers given or changed since this date (YYYY-MM-DD)")
    args = p.parse_args(argv)
    return asyncio.run(_export(Services(get_settings()), args.format, args.out, args.since))


if __name__ == "__main__":
    sys.exit(main())
