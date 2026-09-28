"""The engine and the web label findings with the same words."""

from __future__ import annotations

from pathlib import Path

from holt.agent import labels

FORMAT_TS = Path(__file__).resolve().parents[1] / "web" / "src" / "lib" / "format.ts"


def test_the_web_uses_the_engines_labels():
    source = FORMAT_TS.read_text(encoding="utf-8")
    for table in (labels.OUTCOMES, labels.FIELDS):
        for key, label in table.items():
            assert f'{key}: "{label}"' in source, (key, label)


def test_labels_never_show_an_enum_value():
    assert labels.outcome("closed_dismissive", quoted=False) == "Closed with no explanation"
    assert labels.value("repo_kind", "real_software") == "a software project"
    assert labels.value("governance_flags", ["cla_required", "read_only"]) == (
        "a contributor licence agreement to sign, read-only")
    # Something new still reads as words.
    assert labels.value("onboarding", "brand_new") == "brand new"
    assert labels.field("some_field") == "Some field"
