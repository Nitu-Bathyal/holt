#!/usr/bin/env python3
"""Watch the server while a load test runs, and stop the test if the box suffers.

Every few seconds, one JSON line to --out: the host's load and free memory,
CPU and memory of each container in the staging stack (`docker stats`), the
database's open connections per database, and the job queue. run.sh starts
it next to k6; report.py reads what it wrote.

It is also the guard. The box runs other live services, so when the host's
load passes --max-load, its available memory drops under --min-available-mb,
or staging stops being "live" (a build started), it interrupts the process
given as --stop-pid (k6, which then ends cleanly and still prints its
summary) and says why.

Read-only: `docker stats`, and SELECTs through psql in the stack's db
container. Standard library only.
"""

from __future__ import annotations

import argparse
import json
import os
import signal
import subprocess
import sys
import time
import urllib.request

RUNNING = True


def stop(*_: object) -> None:
    global RUNNING
    RUNNING = False


def run(cmd: list[str], timeout: float = 15) -> str:
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=False).stdout
    except (OSError, subprocess.TimeoutExpired):
        return ""


def host() -> dict:
    with open("/proc/loadavg", encoding="utf-8") as f:
        load1 = float(f.read().split()[0])
    available = 0
    with open("/proc/meminfo", encoding="utf-8") as f:
        for line in f:
            if line.startswith("MemAvailable:"):
                available = int(line.split()[1]) // 1024
    return {"load1": load1, "available_mb": available}


def megabytes(text: str) -> float:
    """docker's "283.5MiB" or "1.152GiB", in MiB."""
    text = text.strip()
    for unit, scale in (("GiB", 1024.0), ("MiB", 1.0), ("KiB", 1 / 1024), ("B", 1 / 1048576)):
        if text.endswith(unit):
            return round(float(text[: -len(unit)]) * scale, 1)
    return 0.0


def containers(stack: str) -> dict:
    """CPU (percent of one core) and memory of each container in the stack, by service."""
    names = run(["docker", "ps", "--filter", f"label=com.docker.compose.project={stack}",
                 "--format", '{{.Names}}\t{{.Label "com.docker.compose.service"}}']).split("\n")
    service = dict(line.split("\t") for line in names if "\t" in line)
    if not service:
        return {}
    out: dict = {}
    stats = run(["docker", "stats", "--no-stream", "--format", "{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}", *service])
    for line in stats.split("\n"):
        parts = line.split("\t")
        if len(parts) != 3:
            continue
        name, cpu, mem = parts
        key = service.get(name, name)
        row = out.setdefault(key, {"cpu": 0.0, "mem_mb": 0.0, "count": 0})
        # Two containers of one service (a deploy swapping them) are added up.
        row["cpu"] = round(row["cpu"] + float(cpu.rstrip("%") or 0), 1)
        row["mem_mb"] = round(row["mem_mb"] + megabytes(mem.split("/")[0]), 1)
        row["count"] += 1
    return out


def psql(db_container: str, user: str, database: str, sql: str) -> list[list[str]]:
    text = run(["docker", "exec", db_container, "psql", "-U", user, "-d", database, "-At", "-F", "\t", "-c", sql])
    return [line.split("\t") for line in text.split("\n") if line]


def database(db_container: str, user: str) -> dict:
    rows = psql(db_container, user, "postgres",
                "select datname, coalesce(state, ''), count(*) from pg_stat_activity "
                "where backend_type = 'client backend' and pid <> pg_backend_pid() and datname is not null "
                "group by 1, 2")
    out: dict = {"open": 0, "active": 0, "by_database": {}}
    for name, state, n in rows:
        out["open"] += int(n)
        out["by_database"][name] = out["by_database"].get(name, 0) + int(n)
        if state == "active":
            out["active"] += int(n)
    return out


def jobs(db_container: str, user: str, database_name: str) -> dict:
    rows = psql(db_container, user, database_name,
                "select count(*) filter (where status = 'queued'), count(*) filter (where status = 'running'), "
                "coalesce(round(extract(epoch from now() - min(created_at) filter (where status = 'queued'))), 0) "
                "from jobs where status in ('queued', 'running')")
    if not rows or len(rows[0]) != 3:
        return {}
    queued, running, oldest = rows[0]
    return {"queued": int(queued), "running": int(running), "oldest_queued_s": int(float(oldest))}


def build_state(url: str) -> str | None:
    """staging's state from /__build ("live", "building", "smoke"...), or None if it can't be read."""
    try:
        with urllib.request.urlopen(url, timeout=3) as res:
            return (json.load(res).get("now") or {}).get("state")
    except (OSError, ValueError):
        return None


class Process:
    """CPU of one process (k6 itself, which shares the box), from /proc."""

    def __init__(self, pid: int) -> None:
        self.pid = pid
        self.ticks = os.sysconf("SC_CLK_TCK")
        self.last: tuple[float, int] | None = None

    def cpu(self) -> float | None:
        try:
            with open(f"/proc/{self.pid}/stat", encoding="utf-8") as f:
                fields = f.read().rsplit(")", 1)[1].split()
        except OSError:
            return None
        used = int(fields[11]) + int(fields[12])  # utime + stime
        now = time.monotonic()
        last, self.last = self.last, (now, used)
        if last is None or now <= last[0]:
            return None
        return round(100 * (used - last[1]) / self.ticks / (now - last[0]), 1)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True, help="file for the samples, one JSON object per line")
    ap.add_argument("--stack", default="stage-holt-new", help="the Compose project to watch")
    ap.add_argument("--db-user", default="holt")
    ap.add_argument("--db-name", default="holt", help="the API server's database, for the job queue")
    ap.add_argument("--interval", type=float, default=5.0, help="seconds between samples")
    ap.add_argument("--stop-pid", type=int, default=0, help="interrupt this process when a limit is passed")
    ap.add_argument("--max-load", type=float, default=20.0, help="the host's 1-minute load")
    ap.add_argument("--min-available-mb", type=int, default=2048, help="the host's available memory")
    ap.add_argument("--build-url", default="", help="staging's /__build; stop when it is no longer live")
    args = ap.parse_args()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    db_container = f"{args.stack}-db-1"
    process = Process(args.stop_pid) if args.stop_pid else None
    stopped = False

    with open(args.out, "a", encoding="utf-8") as out:
        while RUNNING:
            began = time.monotonic()
            sample = {"t": round(time.time(), 1), **host(), "containers": containers(args.stack),
                      "db": database(db_container, args.db_user),
                      "jobs": jobs(db_container, args.db_user, args.db_name)}
            if process is not None:
                sample["k6_cpu"] = process.cpu()

            why = None
            if sample["load1"] > args.max_load:
                why = f"the host's load is {sample['load1']} (limit {args.max_load})"
            elif sample["available_mb"] < args.min_available_mb:
                why = f"the host has {sample['available_mb']} MB available (limit {args.min_available_mb})"
            elif args.build_url:
                state = build_state(args.build_url)
                if state is not None and state != "live":
                    why = f'staging is "{state}", no longer live'
            if why and not stopped:
                sample["stopped"] = why
                print(f"watch: stopping the load test: {why}", file=sys.stderr, flush=True)
                if args.stop_pid:
                    try:
                        os.kill(args.stop_pid, signal.SIGINT)
                    except OSError:
                        pass
                stopped = True

            out.write(json.dumps(sample, separators=(",", ":")) + "\n")
            out.flush()
            while RUNNING and time.monotonic() - began < args.interval:
                time.sleep(0.2)
    return 0


if __name__ == "__main__":
    sys.exit(main())
