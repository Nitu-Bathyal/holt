"""Profile: `/v1/me/profile` (API.md, "Profile").

What a signed-in user tells us once, so /find and /hacktoberfest start from
it: languages, topics, time available, the kinds of contribution they want to
make and their experience. Stated, never inferred (see `holt.profile`). Every
answer changes something: languages and topics are search terms, days is the
time budget the verdict uses, experience decides which issues are shown (a
newcomer sees only issues labelled for first-timers) and contribution types
decide which come first.

Profiles are for adults, like connecting GitHub: the first save needs an
"I'm 18 or older" confirmation unless they already gave it by connecting.
"""

from __future__ import annotations

import re

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field, field_validator

from holt_server import schema
from holt_server.db import GitHubConnection, Profile, iso, now
from holt_server.deps import Caller, caller, services, signed_in
from holt_server.errors import ApiError

router = APIRouter(prefix="/v1", responses={"default": {"model": schema.ErrorBody}})

MAX_ITEMS = 10
_TOPIC = re.compile(r"^[a-z0-9][a-z0-9-]{0,49}$")


def _clean(values: list[str], max_len: int) -> list[str]:
    out: list[str] = []
    for v in values:
        v = " ".join(str(v).split()).lower()
        if not v or len(v) > max_len:
            raise ValueError(f"each entry must be 1 to {max_len} characters")
        if v not in out:
            out.append(v)
    return out


class ProfileIn(BaseModel):
    languages: list[str] = Field(default_factory=list, max_length=MAX_ITEMS)
    topics: list[str] = Field(default_factory=list, max_length=MAX_ITEMS)
    days: int = Field(7, ge=1, le=90)
    contributions: list[schema.ContributionType] = Field(default_factory=list, max_length=5)
    level: schema.Level = "newcomer"
    adult_confirmed: bool = False

    @field_validator("languages")
    @classmethod
    def _languages(cls, v: list[str]) -> list[str]:
        return _clean(v, 40)

    @field_validator("topics")
    @classmethod
    def _topics(cls, v: list[str]) -> list[str]:
        v = _clean([t.replace(" ", "-") for t in v], 50)
        if bad := [t for t in v if not _TOPIC.match(t)]:
            raise ValueError(f"topics are GitHub topics (letters, numbers and dashes): {bad[0]!r}")
        return v

    @field_validator("contributions")
    @classmethod
    def _contributions(cls, v: list[str]) -> list[str]:
        return list(dict.fromkeys(v))


def body(row: Profile | None, adult: bool) -> schema.ProfileOut:
    if row is None:
        return schema.ProfileOut(profile=None, adult_confirmed=adult)
    return schema.ProfileOut(adult_confirmed=adult, profile=schema.ProfilePrefs(
        languages=list(row.languages or []),
        topics=list(row.topics or []),
        days=row.days,
        contributions=list(row.contributions or []),
        level=row.level,
        updated_at=iso(row.updated_at),
    ))


async def _load(s, user_id: str) -> tuple[Profile | None, bool]:
    row = await s.get(Profile, user_id)
    adult = (row is not None and row.adult_confirmed_at is not None) or (
        await s.get(GitHubConnection, user_id) is not None)
    return row, adult


@router.get("/me/profile")
async def get_profile(request: Request, who: Caller = Depends(caller)) -> schema.ProfileOut:
    user_id = signed_in(who)
    async with services(request).db.session() as s:
        return body(*await _load(s, user_id))


@router.put("/me/profile")
async def put_profile(data: ProfileIn, request: Request,
                      who: Caller = Depends(caller)) -> schema.ProfileOut:
    user_id = signed_in(who)
    at = now()
    async with services(request).db.session() as s:
        row, adult = await _load(s, user_id)
        if not adult and not data.adult_confirmed:
            raise ApiError("invalid_request",
                           "Please confirm you're 18 or older to save a profile.")
        if row is None:
            row = Profile(user_id=user_id, created_at=at)
            s.add(row)
        if data.adult_confirmed and row.adult_confirmed_at is None:
            row.adult_confirmed_at = at
        row.languages, row.topics = data.languages, data.topics
        row.days, row.contributions, row.level = data.days, list(data.contributions), data.level
        row.updated_at = at
        await s.commit()
        return body(row, True)


@router.delete("/me/profile")
async def delete_profile(request: Request, who: Caller = Depends(caller)) -> schema.ProfileOut:
    user_id = signed_in(who)
    async with services(request).db.session() as s:
        row = await s.get(Profile, user_id)
        if row is not None:
            await s.delete(row)
            await s.commit()
        connected = await s.get(GitHubConnection, user_id) is not None
    return body(None, connected)
