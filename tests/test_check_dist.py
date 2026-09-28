"""The release check refuses what does not belong in the PyPI package."""

from __future__ import annotations

import importlib.util
import zipfile
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "check_dist.py"
spec = importlib.util.spec_from_file_location("check_dist", SCRIPT)
check_dist = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check_dist)


def wheel(tmp_path: Path, members: list[str]) -> Path:
    path = tmp_path / "holt_cli-0.0.0-py3-none-any.whl"
    with zipfile.ZipFile(path, "w") as archive:
        for name in members + ["holt_cli-0.0.0.dist-info/licenses/LICENSE",
                               "holt_cli-0.0.0.dist-info/licenses/NOTICE"]:
            archive.writestr(name, "")
    return path


def test_a_clean_wheel_passes(tmp_path):
    assert check_dist.check_archive(wheel(tmp_path, ["holt/cli.py"])) == []


def test_benchmark_baselines_are_refused(tmp_path):
    errors = check_dist.check_archive(
        wheel(tmp_path, ["holt/cli.py", "holt/baseline.py", "holt/baseline_matched.py"]))
    assert len(errors) == 2
    assert all("benchmark-only" in e for e in errors)
