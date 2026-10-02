"""Answers that are the same for every reader, kept in this process.

Discover's boards, a repository's free report and Find's index part are asked
for by every visitor and change only when a report, a repository's details or
its starter issues are written. Each is built once and kept as it will be
sent, so the next reader costs no database read at all: opening a session
costs more than building most of these answers does.

An entry is served while three things hold:

* its `stamp` is the one the caller has now. A stamp says "the rows this
  answer was built from haven't been written since": `Writes` below counts
  this process's committed writes per table and per repository, so a report
  stored here (a check, the warm pass, a refresh) is seen by the very next
  read.
* it is younger than `ttl_s`. That is what bounds everything a stamp can't
  see: a write by another process (`warm.sh`, a second API process), and the
  clock (a report passing the age it is served until).
* it still fits: the least recently used entries go first once there are more
  than `max_entries`, or their `weight`s (bytes, for a body) pass `max_weight`.

Nothing per person belongs here: only answers whose key is the whole question
(no caller, no session, no rate limit decides them).
"""

from __future__ import annotations

import asyncio
import hashlib
import time
from collections import Counter, OrderedDict
from collections.abc import Awaitable, Callable, Hashable
from typing import Any, Generic, TypeVar
from weakref import WeakKeyDictionary

from fastapi import Request, Response
from pydantic import BaseModel
from sqlalchemy import event
from sqlalchemy.orm import Session

T = TypeVar("T")


class Kept(Generic[T]):
    """A bounded, short-lived store of answers, each good for one stamp."""

    def __init__(self, ttl_s: float, max_entries: int, max_weight: int | None = None,
                 clock: Callable[[], float] = time.monotonic) -> None:
        self.ttl_s = ttl_s
        self.max_entries = max_entries
        self.max_weight = max_weight
        self.clock = clock
        # key -> (stamp, good until, weight, value), least recently used first.
        self._entries: OrderedDict[Hashable, tuple[Any, float, int, T]] = OrderedDict()
        self._weight = 0
        # One build per key at a time: the readers behind it wait for its answer.
        self._building: dict[Hashable, tuple[Any, asyncio.Future[T]]] = {}
        self.hits = 0
        self.misses = 0

    def __len__(self) -> int:
        return len(self._entries)

    @property
    def weight(self) -> int:
        return self._weight

    def get(self, key: Hashable, stamp: Any = None) -> T | None:
        entry = self._entries.get(key)
        if entry is None:
            return None
        if entry[0] != stamp or self.clock() >= entry[1]:
            self.drop(key)
            return None
        self._entries.move_to_end(key)
        return entry[3]

    def put(self, key: Hashable, value: T, stamp: Any = None, weight: int = 1) -> None:
        self.drop(key)
        if self.max_weight is not None and weight > self.max_weight:
            return  # bigger than the whole store: not kept
        self._entries[key] = (stamp, self.clock() + self.ttl_s, weight, value)
        self._weight += weight
        while len(self._entries) > self.max_entries or (
                self.max_weight is not None and self._weight > self.max_weight):
            _, (_, _, dropped, _) = self._entries.popitem(last=False)
            self._weight -= dropped

    def drop(self, key: Hashable) -> None:
        entry = self._entries.pop(key, None)
        if entry is not None:
            self._weight -= entry[2]

    def clear(self) -> None:
        self._entries.clear()
        self._weight = 0

    async def load(self, key: Hashable, stamp: Any, build: Callable[[], Awaitable[T]],
                   weight: Callable[[T], int] = lambda _: 1) -> T:
        """The kept answer for `key` at `stamp`, or `build()`'s, kept. Readers
        asking for the same key and stamp while it is being built share that
        one build, which runs on even if the reader who started it goes away.
        A build that raises keeps nothing, and every reader waiting on it gets
        the error."""
        value = self.get(key, stamp)
        if value is not None:
            self.hits += 1
            return value
        running = self._building.get(key)
        if running is not None and running[0] == stamp:
            self.hits += 1
            task = running[1]
        else:
            self.misses += 1
            task = asyncio.ensure_future(self._build(key, stamp, build, weight))
            self._building[key] = (stamp, task)
            task.add_done_callback(lambda done: self._built(key, done))
        return await asyncio.shield(task)

    async def _build(self, key: Hashable, stamp: Any, build: Callable[[], Awaitable[T]],
                     weight: Callable[[T], int]) -> T:
        value = await build()
        self.put(key, value, stamp, weight(value))
        return value

    def _built(self, key: Hashable, task: asyncio.Future[T]) -> None:
        if self._building.get(key, (None, None))[1] is task:
            del self._building[key]
        if not task.cancelled():
            task.exception()  # read here, so one nobody waited for isn't logged


class Body:
    """A JSON answer as it is sent: the bytes, and an ETag made from them."""

    __slots__ = ("content", "etag")

    def __init__(self, content: bytes) -> None:
        self.content = content
        self.etag = '"' + hashlib.blake2b(content, digest_size=12).hexdigest() + '"'

    def __len__(self) -> int:
        return len(self.content)


def body_of(model: BaseModel) -> Body:
    """`model` serialised once, as FastAPI would send it."""
    return Body(model.model_dump_json(by_alias=True).encode("utf-8"))


def respond(request: Request, body: Body) -> Response:
    """`body`, or 304 with nothing when the caller already has it."""
    headers = {"ETag": body.etag}
    if _matches(request.headers.get("if-none-match"), body.etag):
        return Response(status_code=304, headers=headers)
    return Response(body.content, media_type="application/json", headers=headers)


def _matches(if_none_match: str | None, etag: str) -> bool:
    if not if_none_match:
        return False
    tags = [t.strip().removeprefix("W/") for t in if_none_match.split(",")]
    return "*" in tags or etag in tags


# Stores live as long as the `Services` they answer for (one per process; one
# per harness in the tests), like discover.py's kept copies.
_stores: WeakKeyDictionary[Any, dict[str, Kept]] = WeakKeyDictionary()


def store(svc: Any, name: str, make: Callable[[], Kept]) -> Kept:
    """The store called `name` for `svc`, made on first use."""
    stores = _stores.get(svc)
    if stores is None:
        stores = _stores[svc] = {}
    if (kept := stores.get(name)) is None:
        kept = stores[name] = make()
    return kept


# --- what this process wrote -----------------------------------------------------


class Writes:
    """How many committed writes this process has made, per table and per
    repository: what a stamp is made of. Counted from every ORM session (the
    listeners below), so no code that writes has to say so."""

    def __init__(self) -> None:
        # table -> commits that wrote it at all.
        self.tables: Counter[str] = Counter()
        # Tables someone has asked about per repository (`repo`). Only these
        # are counted per repository, so the counts below stay as small as
        # the repositories those few tables hold.
        self.watched: set[str] = set()
        # (table, repo_key) -> commits that wrote that repository's rows.
        self.rows: Counter[tuple[str, str]] = Counter()
        # table -> commits that wrote rows this can't name (UPDATE ... WHERE,
        # DELETE ..., a row with no `repo_key`).
        self.unnamed: Counter[str] = Counter()

    def table(self, *tables: str) -> tuple[int, ...]:
        """Changes when any of `tables` is written."""
        return tuple(self.tables[t] for t in tables)

    def repo(self, repo_key: str, *tables: str) -> tuple[int, ...]:
        """Changes when `repo_key`'s rows in any of `tables` are written
        (from the first time it is asked: an answer is built after that)."""
        self.watched.update(tables)
        return tuple(n for t in tables for n in (self.rows[t, repo_key], self.unnamed[t]))


_writes: WeakKeyDictionary[Any, Writes] = WeakKeyDictionary()
_PENDING = "holt_cache_written"


def writes(svc: Any) -> Writes:
    """The count of what `svc`'s database sessions have written."""
    return _writes_of(svc.db.engine.sync_engine)


def _writes_of(engine: Any) -> Writes:
    if (found := _writes.get(engine)) is None:
        found = _writes[engine] = Writes()
    return found


@event.listens_for(Session, "after_flush")
def _flushed(session: Session, _context: Any) -> None:
    written = session.info.setdefault(_PENDING, set())
    for row in (*session.new, *session.dirty, *session.deleted):
        table = getattr(row, "__tablename__", None)
        if table:
            written.add((table, getattr(row, "repo_key", None)))


@event.listens_for(Session, "do_orm_execute")
def _executed(state: Any) -> None:
    if state.is_insert or state.is_update or state.is_delete:
        table = getattr(getattr(state.statement, "table", None), "name", None)
        if table:
            state.session.info.setdefault(_PENDING, set()).add((table, None))


@event.listens_for(Session, "after_commit")
def _committed(session: Session) -> None:
    written = session.info.pop(_PENDING, None)
    if not written or session.bind is None:
        return
    counts = _writes_of(getattr(session.bind, "engine", session.bind))
    for table in {t for t, _ in written}:
        counts.tables[table] += 1
    for table, key in written:
        if table not in counts.watched:
            continue
        if key is None:
            counts.unnamed[table] += 1
        else:
            counts.rows[table, key] += 1


@event.listens_for(Session, "after_rollback")
def _rolled_back(session: Session) -> None:
    session.info.pop(_PENDING, None)
