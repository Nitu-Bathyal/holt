"""An evidence-matched baseline: one prompt, everything Holt sees.

The original baseline reads a README and repository metadata. Holt reads two
hundred pull request threads. Comparing them measures mostly "pull request
history beats a landing page", which is true but is not the claim the
architecture is making.

This baseline closes that gap. It receives the *same* arithmetic signals Holt
computes and the *same* twelve-thread digest Stage C reads, and is asked for the
same three-valued verdict in a single call. What differs is only the
architecture: one model call decides, instead of typed findings passing through
verification into a model-free verdict function.

If Holt does not beat this, the pipeline is not earning its complexity, and that
is worth knowing and publishing.
"""

from __future__ import annotations

from holt.agent.signals import build_threads, compute
from holt.agent.stages import _render_thread
from holt.evidence.provider import EvidenceProvider
from holt.model import ModelClient
from holt.report import Assessment, Claim, Verdict

SYSTEM = """You assess whether a GitHub repository is a worthwhile place for an \
outside developer -- someone with no prior connection to the project -- to spend \
a week contributing.

You are given the repository's README, its metadata, arithmetic measured from its
pull request history before the cutoff, and a sample of its pull request threads.

Judge what a merged contribution here actually *is*. A repository where merged
work means appending an entry to a catalogue -- package manifests, domain
records, plugin listings -- is easy to contribute to and is not a place to spend
a week writing software.

Answer with one of three verdicts:
  viable                 an outsider could realistically land a meaningful change
  not_viable             an outsider could not, or the work would not be software
  insufficient_evidence  the material does not support a call either way

Prefer insufficient_evidence to a confident guess. Cite evidence ids you were
given for the reasons you list."""

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

THREAD_SAMPLE = 12


RECORDED_SIGNAL_FIELDS = (
    "total_threads",
    "outsider_threads",
    "outsider_merged",
    "outsider_ignored",
    "median_first_response_hours",
    "bot_share",
    "distinct_outsider_authors",
    "distinct_merged_authors",
    "reviewed_share",
    "merge_rate",
)


def assess(repo: str, provider: EvidenceProvider, model: ModelClient) -> Assessment:
    records = provider.fetch(repo)
    meta = next((r.payload for r in records if r.evidence_id.endswith(":meta")), {})
    readme = next(
        (r.payload.get("text") for r in records if r.evidence_id.endswith(":readme")), None
    )
    threads = build_threads(records)
    signals = compute(threads)

    talkative = sorted(
        (t for t in threads.values() if not t.author_is_bot),
        key=lambda t: (len(t.responses), t.additions + t.deletions),
        reverse=True,
    )[:THREAD_SAMPLE]

    parts = [f"Repository: {repo}", "", "Metadata:"]
    for key in ("description", "primary_language", "stargazer_count", "pushed_at",
                "is_archived", "is_fork", "is_mirror", "homepage_url"):
        parts.append(f"  {key}: {meta.get(key)!r}")
    parts += ["", "Measured from pull request history before the cutoff:"]
    # The exact ten fields this prompt was recorded with, listed rather than
    # taken from `as_dict()`. This is the *comparison* method: a signal added to
    # the pipeline must not silently change what the baseline is shown, or the
    # ablation stops being the same experiment -- and every recorded
    # `baseline_matched` call becomes a replay miss the moment anyone adds one.
    measured = signals.as_dict()
    parts += [f"  {k}: {measured[k]}" for k in RECORDED_SIGNAL_FIELDS]
    parts += ["", "README:", (readme or "(none at the cutoff)")[:6000], ""]
    parts += ["Pull request threads:", ""]
    parts += [_render_thread(t) for t in talkative]

    result = model.complete(
        label="baseline_matched", system=SYSTEM, prompt="\n".join(parts), schema=SCHEMA
    )
    return Assessment(
        repo=repo,
        verdict=Verdict(result["verdict"]),
        summary=result["summary"],
        claims=[Claim(text=r, evidence_id=None) for r in result.get("reasons", [])],
        method="baseline, evidence-matched (one prompt, the same signals and threads Holt reads)",
        replayed=model.replayed,
        models=list(model.usage.models),
    )
