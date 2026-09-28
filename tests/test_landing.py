"""Where outsider work landed — a count, not a claim.

This section makes no prediction, so nothing here is about accuracy. It is about
not misleading: an attempt counted once per pull request rather than once per
file, a directory named "never landed" only when enough people tried for the
statement to mean anything, and silence when there is nothing to report.
"""

from __future__ import annotations

from datetime import timedelta

from holt.agent.landing import MIN_ATTEMPTS, area_of, compute, render
from holt.agent.signals import Thread
from holt.types import T_CUTOFF

BEFORE = T_CUTOFF - timedelta(days=10)


def thread(n: int, author: str, files: list[str], merged: bool, day: int = 0) -> Thread:
    return Thread(
        key=f"pr:a/b#{n}", number=n, author=author, author_is_bot=False,
        opened_at=BEFORE + timedelta(days=day), files=files, merged=merged,
    )


def landing_for(threads: list[Thread]):
    return compute({t.key: t for t in threads})


def test_a_path_is_cut_to_two_segments():
    assert area_of("pkgs/by-name/fo/foo/package.nix") == "pkgs/by-name"
    assert area_of("README.md") == "(root)"
    assert area_of("tests/conftest.py") == "tests/conftest.py"


def test_a_wide_pull_request_counts_once_per_area():
    """Forty files in one directory is one attempt at it, not forty."""
    wide = thread(1, "newcomer", [f"src/core/f{i}.py" for i in range(40)], merged=True)
    # Padding so the area-to-thread ratio does not trip the regrouping fallback,
    # which is a different behaviour tested separately.
    others = [thread(10 + i, f"new{i}", ["src/core/x.py"], merged=False, day=i)
              for i in range(4)]
    result = landing_for([wide, *others])
    assert [(a.path, a.landed, a.attempted) for a in result.landed] == [("src/core", 1, 5)]


def test_an_author_stops_being_an_outsider_after_their_first_merge():
    """Their second landing says nothing about whether a stranger could land.

    Outsider status is decided per thread in time order, so the same person's
    first pull request counts and their later ones do not. Without this, a repo
    where one prolific newcomer merged forty times would look wide open.
    """
    threads = [
        thread(1, "regular", ["core/one/first.py"], merged=True, day=0),
        thread(2, "regular", ["core/one/second.py"], merged=True, day=1),
        thread(3, "regular", ["core/one/third.py"], merged=True, day=2),
        thread(4, "regular", ["core/one/fourth.py"], merged=True, day=3),
        # Other newcomers in the same area, so the regrouping fallback (tested
        # separately) does not fire on a one-thread sample.
        *[thread(10 + i, f"new{i}", ["core/one/x.py"], merged=False, day=4 + i)
          for i in range(3)],
    ]
    landed = landing_for(threads).landed
    assert [(a.path, a.landed, a.attempted) for a in landed] == [("core/one", 1, 4)]


def test_a_directory_nobody_landed_in_is_reported_separately():
    threads = [thread(i, f"new{i}", ["hard/area/x.py"], merged=False, day=i)
               for i in range(MIN_ATTEMPTS)]
    result = landing_for(threads)
    assert result.landed == []
    assert [(a.path, a.attempted) for a in result.never] == [("hard/area", MIN_ATTEMPTS)]


def test_one_lone_failure_is_not_called_a_dead_end():
    """A single unmerged attempt is not evidence that a door is shut."""
    result = landing_for([thread(1, "newcomer", ["hard/area/x.py"], merged=False)])
    assert result.never == []


def test_nothing_to_say_renders_nothing():
    """No heading over an empty section, and no section over an empty repository."""
    assert render(landing_for([])) == []


def test_the_rendered_section_states_what_it_is_not():
    threads = [thread(i, f"new{i}", ["shut/door/x.py"], merged=False, day=i)
               for i in range(MIN_ATTEMPTS)]
    out = "\n".join(render(landing_for(threads)))
    assert "not a rule" in out
    assert "only a couple of people ever tried" in out


def test_a_split_that_groups_nothing_falls_back_to_one_segment():
    """A registry where every entry is its own directory.

    At two segments this produced ninety single-merge rows that looked like
    insight and carried none. It must collapse to the one true statement:
    everything lands in `plugins`.
    """
    threads = [thread(i, f"new{i}", [f"plugins/thing-{i}/manifest"], merged=True, day=i)
               for i in range(20)]
    landed = landing_for(threads).landed
    assert [(a.path, a.landed) for a in landed] == [("plugins", 20)]


def test_a_split_that_does_group_is_kept():
    """The fallback must not fire on a repository with real structure."""
    threads = [thread(i, f"new{i}", [f"pkgs/by-name/x{i}.nix"], merged=True, day=i)
               for i in range(10)]
    threads += [thread(50 + i, f"other{i}", [f"nixos/modules/y{i}.nix"], merged=True, day=i)
                for i in range(10)]
    paths = {a.path for a in landing_for(threads).landed}
    assert paths == {"pkgs/by-name", "nixos/modules"}


def test_rows_that_tie_on_merges_are_ordered_by_the_better_odds():
    """The order has to be a function of the evidence, not of the hash seed.

    `Counter.most_common` breaks ties by insertion order, and insertion order
    was set-iteration order, so two replays of the same recording printed
    different fourth rows in `NixOS/nixpkgs`. One merge of two attempts and one
    merge of seven are not interchangeable, and the reader should always see the
    same one.
    """
    threads = [
        thread(1, "a", ["pkgs/servers/x.nix"], merged=True),
        thread(2, "b", ["pkgs/servers/y.nix"], merged=False, day=1),
        thread(3, "c", ["nixos/modules/x.nix"], merged=True, day=2),
        *[thread(10 + i, f"n{i}", ["nixos/modules/y.nix"], merged=False, day=3 + i)
          for i in range(6)],
    ]
    rows = [(a.path, a.landed, a.attempted) for a in landing_for(threads).landed]
    assert rows == [("pkgs/servers", 1, 2), ("nixos/modules", 1, 7)]


def test_the_landing_section_is_identical_under_a_different_hash_seed():
    """The property, tested the only way it can be: in other processes.

    Set iteration order is stable within a run and varies between runs, so a
    single-process assertion cannot see this class of bug at all. Six areas tie
    on merge count and only four rows are printed, which is exactly the shape
    that made `NixOS/nixpkgs` print a different fourth row on a re-render. Under
    the old ordering these three seeds produce three different sets of rows.
    """
    import subprocess
    import sys

    script = (
        "from datetime import timedelta;"
        "from holt.agent.landing import compute, render;"
        "from holt.agent.signals import Thread;"
        "from holt.types import T_CUTOFF;"
        "b = T_CUTOFF - timedelta(days=10);"
        "tied = [f'z{i}/s' for i in range(1, 7)];"
        "ts = [Thread(key=f'pr:a/b#{i}', number=i, author=f'm{i}',"
        " author_is_bot=False, opened_at=b + timedelta(days=i),"
        " files=[f'{a}/f.py' for a in tied], merged=True) for i in range(3)];"
        "ts += [Thread(key=f'pr:a/b#{9 + i}', number=9 + i, author=f'u{i}',"
        " author_is_bot=False, opened_at=b + timedelta(days=9 + i),"
        " files=['z1/s/f.py', 'z2/s/f.py'], merged=False) for i in range(2)];"
        "print(chr(10).join(render(compute({t.key: t for t in ts}))))"
    )
    outputs = set()
    for seed in ("0", "1", "12345"):
        result = subprocess.run(
            [sys.executable, "-c", script],
            capture_output=True, text=True, env={"PYTHONHASHSEED": seed, "PATH": ""},
        )
        assert result.returncode == 0, result.stderr[-2000:]
        outputs.add(result.stdout)
    assert len(outputs) == 1, "the landing section changed with the hash seed"



def test_an_area_that_is_one_file_says_so():
    """A path cut to two segments can be a file; the web adds "/" only to folders."""
    paths = ["tests/conftest.py"] * 2 + ["src/pkg/a.py"] * 3
    where = landing_for([thread(n, f"u{n}", [p], merged=False) for n, p in enumerate(paths)])
    assert {a.path: a.is_file for a in where.never} == {"tests/conftest.py": True, "src/pkg": False}
