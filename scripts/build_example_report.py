"""Regenerate the recorded AI report the web app's landing falls back on.

It replays a recorded model run through the current pipeline and the server's
report builder, then writes the finished report to
web/src/lib/example-ai-report.json. Replay only: committed evidence and
recorded model output, so no key, no network and no model spend. A recording
the current prompts no longer match fails loudly instead of calling a model.

Run after any change to the pipeline, the narration/quote checks or the report
shape:

    uv run python scripts/build_example_report.py            # rewrite the file
    uv run python scripts/build_example_report.py --check    # exit 1 if it is stale

tests/test_example_report.py runs the check, so a pipeline change that alters
the example cannot merge without the file being refreshed.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "web" / "src" / "lib" / "example-ai-report.json"

# Popular, and a project a beginner could plausibly aim at. Its recording
# replays through the current pipeline with the outsider-only quote checks.
REPO = "home-assistant/core"


def build(repo: str = REPO) -> dict:
    from holt_server import engine

    from holt.evidence.fixtures import FixtureProvider
    from holt.model import TRAJECTORY_DIR, ReplayModel
    from holt.types import T_CUTOFF, Window

    fixtures = ROOT / "fixtures"
    model = ReplayModel(ROOT / TRAJECTORY_DIR / (repo.replace("/", "__") + ".jsonl"))
    report = engine.analyze(
        repo=repo,
        mode="ai",
        days=7,
        provider=FixtureProvider(Window.PRE_T, root=fixtures),
        model=model,
        emit=lambda stage, value: None,
        as_of=T_CUTOFF,
    )
    # A replay has no real clock: the time the run took and the moment it was
    # made are meaningless here, and either would change on every regeneration.
    report["generated_at"] = report["evidence_until"]
    if report["cost"]:
        report["cost"]["seconds"] = None
        # The site never shows which model wrote a report, so the example doesn't name one.
        report["cost"]["model"] = "ai"
    problems = check_report(report)
    if problems:
        raise SystemExit("The example report is not fit to publish:\n- " + "\n- ".join(problems))
    return report


def check_report(report: dict) -> list[str]:
    """Things that would make this a bad example, so a refresh cannot ship one."""
    problems = []
    if report["mode"] != "ai":
        problems.append("it is not an AI report")
    if not report["bottom_line"] or not report["summary"]:
        problems.append("the AI wrote no bottom line or summary")
    quoted = [e for e in report["evidence"] if e["quote"]]
    if len(quoted) < 3:
        problems.append(f"only {len(quoted)} quoted threads; an example should show real ones")
    for item in report["evidence"]:
        if not item["url"].startswith("https://github.com/"):
            problems.append(f"evidence item without a GitHub link: {item['id']}")
    return problems


def render(report: dict) -> str:
    return json.dumps(report, indent=2, ensure_ascii=False) + "\n"


def recorded_on(report: dict) -> str:
    return datetime.fromisoformat(report["evidence_until"]).strftime("%-d %B %Y")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--check", action="store_true", help="exit 1 if the committed file is stale")
    args = parser.parse_args(argv)

    report = build()
    text = render(report)
    if args.check:
        current = OUT.read_text(encoding="utf-8") if OUT.exists() else ""
        if current != text:
            print(f"{OUT.relative_to(ROOT)} is stale. Run: uv run python scripts/build_example_report.py")
            return 1
        print(f"{OUT.relative_to(ROOT)} is up to date ({report['repo']}, recorded {recorded_on(report)}).")
        return 0
    OUT.write_text(text, encoding="utf-8")
    print(f"Wrote {OUT.relative_to(ROOT)}: {report['repo']}, recorded {recorded_on(report)}, "
          f"{len(report['evidence'])} evidence items.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
