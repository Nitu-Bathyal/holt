"""The baseline solution: one prompt, the README, and the repository metadata.

This is a *solution*, not a comparator -- it has its own entry point
(`python -m eval.baseline <repo>`) and produces the same Assessment the full
pipeline does. It is what a competent engineer would build in an afternoon, and
it is the thing the rest of the system has to beat.

It reads through the same EvidenceProvider, so it is bound by the same holdout
and runs in the same fixture and replay modes. Same task, same cases, same
evidence, different method.

It is benchmark material, so it lives here and not in the PyPI package. From a
clone, replaying the committed recording (no key, no network):

    PYTHONPATH=. uv run python -m eval.baseline NixOS/nixpkgs
"""

from __future__ import annotations

import argparse
import sys

from holt import model as model_mod
from holt.evidence.fixtures import FixtureProvider
from holt.evidence.provider import EvidenceProvider
from holt.model import ModelClient
from holt.report import Assessment, Claim, Verdict
from holt.types import Window

SYSTEM = """You assess whether a GitHub repository is a worthwhile place for an \
outside developer -- someone with no prior connection to the project -- to spend \
a week contributing.

Answer with one of three verdicts:
  viable                 an outsider could realistically land a meaningful change
  not_viable             an outsider could not, or the work would not be software
  insufficient_evidence  the material does not support a call either way

Prefer insufficient_evidence to a confident guess."""

SCHEMA = {
    "type": "object",
    "properties": {
        "verdict": {"type": "string", "enum": [v.value for v in Verdict]},
        "summary": {"type": "string"},
        "reasons": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["verdict", "summary", "reasons"],
    "additionalProperties": False,
}


def _prompt(repo: str, meta: dict, readme: str | None) -> str:
    parts = [f"Repository: {repo}", "", "Metadata:"]
    for key in (
        "description",
        "primary_language",
        "stargazer_count",
        "pushed_at",
        "is_archived",
        "is_fork",
        "is_mirror",
        "homepage_url",
    ):
        parts.append(f"  {key}: {meta.get(key)!r}")
    parts += ["", "README:", readme or "(no README found at the cutoff)"]
    return "\n".join(parts)


def assess(repo: str, provider: EvidenceProvider, model: ModelClient) -> Assessment:
    records = provider.fetch(repo)
    meta = next(
        (r.payload for r in records if r.evidence_id.endswith(":meta")),
        {},
    )
    readme = next(
        (r.payload.get("text") for r in records if r.evidence_id.endswith(":readme")),
        None,
    )

    result = model.complete(
        label="baseline",
        system=SYSTEM,
        prompt=_prompt(repo, meta, readme),
        schema=SCHEMA,
    )

    # The baseline cites nothing beyond what it was shown. That is the honest
    # rendering of a method that never looked at a pull request: its reasons are
    # impressions of a README, and the report should not dress them as evidence.
    claims = [Claim(text=r, evidence_id=None) for r in result.get("reasons", [])]
    return Assessment(
        repo=repo,
        verdict=Verdict(result["verdict"]),
        summary=result["summary"],
        claims=claims,
        method="baseline (single prompt over README and metadata)",
        replayed=model.replayed,
        models=list(model.usage.models),
    )


def main(argv: list[str] | None = None) -> int:
    """Replay the baseline on one repository's committed evidence."""
    parser = argparse.ArgumentParser(prog="python -m eval.baseline")
    parser.add_argument("repo", help="owner/name with committed evidence")
    args = parser.parse_args(argv)
    # A replay resolves against the pinned ids that made the recording, never
    # a model chosen with `holt models`, as `holt analyze --replay` does.
    model_mod.enable_user_models_config(model_mod.ModelsConfig())
    client = model_mod.build(args.repo, replay=True)
    print(assess(args.repo, FixtureProvider(Window.PRE_T), client).render())
    return 0


if __name__ == "__main__":
    sys.exit(main())
