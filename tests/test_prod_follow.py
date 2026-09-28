"""Production deploys itself from main, but only a commit that passed.

`deploy/prod/follow.sh` is the timer's loop: when origin/main moves, it runs
`deploy.sh` for the new commit once CI is all green on it and staging is
live on it. What must never happen: a deploy on red or pending CI, a deploy
of a commit staging hasn't run, a failed commit tried again and again, or
the follower undoing a rollback someone made by hand.

The script runs here for real against a throwaway origin whose commits carry
stub `deploy.sh` and `warm.sh` (the follower runs the ones from the commit it
deploys). `gh` is a stub that prints the check runs, staging's `/__build` is
a file:// URL, and `docker` is a stub. Nothing is built or fetched from the
network.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

FOLLOW = Path("deploy/prod/follow.sh").resolve()

pytestmark = pytest.mark.skipif(
    sys.platform == "win32" or not all(shutil.which(t) for t in ("bash", "git", "flock", "curl")),
    reason="the production scripts are bash and run on the Linux server",
)

# deploy.sh at a commit: writes down how it was called, then does what
# $STUB_DEPLOY says (ok, fail, busy).
DEPLOY_STUB = """#!/bin/sh
echo "$1" >> "$STUB_DIR/deploys"
case "${STUB_DEPLOY:-ok}" in
    ok)   echo "$1" > "$HOLT_PROD_HOME/current"; echo "live" ;;
    busy) echo "2026-01-01T00:00:00Z ERROR: another deploy is in progress"; exit 75 ;;
    *)    echo "2026-01-01T00:00:00Z ERROR: $1 failed its health check; rolled back"; exit 1 ;;
esac
"""
WARM_STUB = """#!/bin/sh
echo "$*" >> "$STUB_DIR/warm"
"""
GH_STUB = """#!/bin/sh
# gh api --paginate <url> --jq ...: the TSV the real --jq would print
case "$3" in
    *check-runs*) cat "$STUB_DIR/checks" 2>/dev/null ;;
    *actions/runs*) cat "$STUB_DIR/workflows" 2>/dev/null ;;
esac
exit 0
"""
DOCKER_STUB = """#!/bin/sh
echo "docker $*" >> "$STUB_DIR/docker"
case " $* " in
    *" ps "*) [ -f "$STUB_DIR/warm_running" ] && echo abc123 ;;
esac
exit 0
"""


def _git(cwd: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@t", *args],
        cwd=cwd, check=True, capture_output=True, text=True,
    ).stdout.strip()


class Rig:
    def __init__(self, tmp: Path):
        self.tmp = tmp
        self.home = tmp / "home"
        self.state = tmp / "state"
        self.stubs = tmp / "stubs"
        self.origin = tmp / "origin.git"
        self.work = tmp / "work"
        for d in (self.home / ".local" / "bin", self.state, self.stubs, self.work):
            d.mkdir(parents=True)
        for name, body in (("gh", GH_STUB), ("docker", DOCKER_STUB)):
            p = self.home / ".local" / "bin" / name
            p.write_text(body, encoding="utf-8")
            p.chmod(0o755)
        subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(self.origin)], check=True)
        _git(self.work, "init", "-q", "-b", "main")
        prod = self.work / "deploy" / "prod"
        prod.mkdir(parents=True)
        for name, body in (("deploy.sh", DEPLOY_STUB), ("warm.sh", WARM_STUB)):
            (prod / name).write_text(body, encoding="utf-8")
            (prod / name).chmod(0o755)
        (self.work / "src" / "holt").mkdir(parents=True)
        self.engine(1)
        _git(self.work, "remote", "add", "origin", str(self.origin))
        self.commit("first")
        self.staging_on("")

    def engine(self, n: int) -> None:
        (self.work / "src" / "holt" / "engine_version.py").write_text(
            f"ENGINE_VERSION = {n}\n", encoding="utf-8")

    def commit(self, msg: str) -> str:
        _git(self.work, "add", "-A")
        _git(self.work, "commit", "-q", "--allow-empty", "-m", msg)
        _git(self.work, "push", "-q", "origin", "HEAD:main")
        return _git(self.work, "rev-parse", "HEAD")

    def ci(self, checks: list[tuple[str, str, str]], workflows=(("CI", "completed", "success"),)) -> None:
        tsv = lambda rows: "".join("\t".join(r) + "\n" for r in rows)  # noqa: E731
        (self.stubs / "checks").write_text(tsv(checks), encoding="utf-8")
        (self.stubs / "workflows").write_text(tsv(workflows), encoding="utf-8")

    def green(self) -> None:
        self.ci([("tests", "completed", "success"), ("web", "completed", "skipped")])

    def staging_on(self, sha: str) -> None:
        (self.tmp / "staging.json").write_text(
            json.dumps({"live": {"main": {"sha": sha}}}), encoding="utf-8")

    def live(self, sha: str) -> None:
        (self.state / "current").write_text(sha + "\n", encoding="utf-8")

    def tick(self, *args: str, deploy: str = "ok") -> subprocess.CompletedProcess:
        env = {
            "HOME": str(self.home),
            "PATH": os.environ["PATH"],
            "STUB_DIR": str(self.stubs),
            "STUB_DEPLOY": deploy,
            "HOLT_PROD_HOME": str(self.state),
            "HOLT_PROD_PROJECT": "follow-test",
            "HOLT_FOLLOW_REMOTE": str(self.origin),
            "HOLT_FOLLOW_STAGING_URL": (self.tmp / "staging.json").as_uri(),
        }
        return subprocess.run(["bash", str(FOLLOW), *args], env=env, capture_output=True,
                              text=True, timeout=60)

    def status(self) -> dict:
        return json.loads((self.state / "autodeploy.json").read_text(encoding="utf-8"))

    def calls(self, name: str) -> list[str]:
        p = self.stubs / name
        return p.read_text(encoding="utf-8").split("\n")[:-1] if p.exists() else []


@pytest.fixture
def rig(tmp_path: Path) -> Rig:
    return Rig(tmp_path)


def _ready(rig: Rig) -> str:
    """A live commit, and a new one on main with CI and staging green."""
    old = _git(rig.work, "rev-parse", "HEAD")
    rig.live(old)
    new = rig.commit("new")
    rig.green()
    rig.staging_on(new)
    return new


def test_red_ci_waits(rig: Rig) -> None:
    new = _ready(rig)
    rig.ci([("tests", "completed", "success"), ("web", "completed", "failure")])
    r = rig.tick()
    assert r.returncode == 0, r.stderr
    assert rig.status()["state"] == "blocked"
    assert "web (failure)" in rig.status()["message"]
    assert rig.status()["sha"] == new
    assert rig.calls("deploys") == []


@pytest.mark.parametrize("checks,workflows", [
    ([("tests", "in_progress", "")], [("CI", "completed", "success")]),
    ([("tests", "completed", "success")], [("CI", "queued", "")]),
    ([], []),                                               # nothing registered yet
    ([("tests", "completed", "cancelled")], []),            # cancelled is not green
])
def test_anything_but_all_green_does_not_deploy(rig: Rig, checks, workflows) -> None:
    _ready(rig)
    rig.ci(checks, workflows)
    rig.tick()
    assert rig.status()["state"] in {"waiting", "blocked"}
    assert rig.calls("deploys") == []


def test_waits_until_staging_runs_the_same_commit(rig: Rig) -> None:
    new = _ready(rig)
    rig.staging_on("0" * 40)
    rig.tick()
    assert rig.status()["state"] == "waiting"
    assert "staging isn't live on it yet" in rig.status()["message"]
    assert rig.calls("deploys") == []

    rig.staging_on(new)
    rig.tick()
    assert rig.calls("deploys") == [new]
    assert rig.status()["state"] == "deployed"


def test_green_deploys_that_exact_commit_and_shows_it_on_build(rig: Rig) -> None:
    new = _ready(rig)
    (rig.state / "build").mkdir()
    (rig.state / "build" / "build.json").write_text(
        json.dumps({"site": "https://githolt.com", "live": {"tag": "x"}}), encoding="utf-8")
    r = rig.tick()
    assert r.returncode == 0, r.stdout + r.stderr
    assert rig.calls("deploys") == [new]
    build = json.loads((rig.state / "build" / "build.json").read_text(encoding="utf-8"))
    assert build["live"] == {"tag": "x"}          # deploy.sh's part is kept
    assert build["autodeploy"]["state"] == "deployed"
    assert build["autodeploy"]["sha"] == new
    assert set(build["autodeploy"]) == {"state", "sha", "at", "message"}
    assert rig.calls("warm") == []                 # the engine didn't change

    rig.tick()                                     # nothing new: no second deploy
    assert rig.calls("deploys") == [new]
    assert rig.status()["state"] == "up_to_date"


def test_a_failed_commit_is_not_retried(rig: Rig) -> None:
    new = _ready(rig)
    r = rig.tick(deploy="fail")
    assert r.returncode == 1
    assert rig.status()["state"] == "failed"
    assert "failed its health check" in rig.status()["message"]

    for _ in range(2):
        rig.tick()
    assert rig.calls("deploys") == [new]
    assert rig.status()["state"] == "held"

    newer = rig.commit("fix")                      # main moves on: that one is tried
    rig.green()
    rig.staging_on(newer)
    rig.tick()
    assert rig.calls("deploys") == [new, newer]


def test_retry_forgets_the_failure(rig: Rig) -> None:
    new = _ready(rig)
    rig.tick(deploy="fail")
    rig.tick("--retry")
    rig.tick()
    assert rig.calls("deploys") == [new, new]
    assert rig.status()["state"] == "deployed"


def test_busy_is_not_a_failure(rig: Rig) -> None:
    new = _ready(rig)
    rig.tick(deploy="busy")
    assert rig.status()["state"] == "busy"
    rig.tick()
    assert rig.calls("deploys") == [new, new]
    assert rig.status()["state"] == "deployed"


def test_an_engine_bump_restarts_the_stale_only_warm_pass(rig: Rig) -> None:
    rig.live(_git(rig.work, "rev-parse", "HEAD"))
    rig.engine(2)
    new = rig.commit("engine 2")
    rig.green()
    rig.staging_on(new)
    (rig.stubs / "warm_running").touch()
    rig.tick()
    assert rig.calls("warm") == ["--stale-only"]
    assert "docker stop follow-test-warm" in rig.calls("docker")
    assert "warm pass started" in rig.status()["message"]


def test_pause_and_resume(rig: Rig) -> None:
    new = _ready(rig)
    rig.tick("--pause", "launch day")
    rig.tick()
    assert rig.status()["state"] == "paused"
    assert "launch day" in rig.status()["message"]
    assert rig.calls("deploys") == []

    rig.tick("--resume")
    rig.tick()
    assert rig.calls("deploys") == [new]


def test_the_pause_file_alone_pauses(rig: Rig) -> None:
    _ready(rig)
    (rig.state / "AUTODEPLOY_PAUSED").touch()
    rig.tick()
    assert rig.status()["state"] == "paused"
    assert rig.calls("deploys") == []


def test_a_rollback_by_hand_pauses_instead_of_being_undone(rig: Rig) -> None:
    first = _git(rig.work, "rev-parse", "HEAD")
    new = _ready(rig)
    rig.tick()
    assert rig.calls("deploys") == [new]

    rig.live(first)                                # deploy.sh <first>, by hand
    rig.tick()
    rig.tick()
    assert rig.status()["state"] == "paused"
    assert "rolled back by hand" in rig.status()["message"]
    assert rig.calls("deploys") == [new]
