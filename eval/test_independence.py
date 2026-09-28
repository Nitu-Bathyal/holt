"""Labels must not be able to see the agent.

A label that imports the thing it is grading is not a label. This is checked
structurally, by reading the import graph, rather than trusted to review.
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

LABELS_DIR = Path(__file__).parent / "labels"
FORBIDDEN_PREFIXES = ("holt.agent", "eval.baseline")


def label_modules() -> list[Path]:
    return sorted(p for p in LABELS_DIR.glob("*.py") if p.name != "__init__.py")


def imported_names(source: str) -> set[str]:
    names: set[str] = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            names.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            names.add(node.module)
            names.update(f"{node.module}.{alias.name}" for alias in node.names)
    return names


def test_there_are_label_modules_to_check():
    """Guards against the import test passing because it found nothing."""
    assert label_modules(), "no label modules found; this test would pass vacuously"


@pytest.mark.parametrize("path", label_modules(), ids=lambda p: p.name)
def test_labels_do_not_import_the_agent(path: Path):
    offending = sorted(
        name
        for name in imported_names(path.read_text())
        if name.startswith(FORBIDDEN_PREFIXES)
    )
    assert not offending, (
        f"{path.name} imports {offending}. Labels are computed independently of "
        "the system being graded; sharing code between them makes the measured "
        "improvement circular."
    )
