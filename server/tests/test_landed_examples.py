"""Rules-mode examples say how a pull request GitHub shows as closed went in."""

from __future__ import annotations

from golden import golden
from holt.agent.signals import build_threads
from holt_server.report import counted_examples


def test_examples_say_how_an_off_button_merge_landed():
    # Go lands pull requests through Gerrit; GitHub shows every one as closed.
    _, records = golden.read_recording("golang/go")
    by_id = {r.evidence_id: r for r in records}
    merged = [e for e in counted_examples(build_threads(records), by_id)
              if e["value"] == "merged"]
    assert merged
    assert all("landed through Gerrit" in e["text"] for e in merged)


def test_examples_of_button_merges_still_say_merged():
    _, records = golden.read_recording("pallets/flask")
    by_id = {r.evidence_id: r for r in records}
    merged = [e for e in counted_examples(build_threads(records), by_id)
              if e["value"] == "merged"]
    assert merged and all(" was merged" in e["text"] for e in merged)
