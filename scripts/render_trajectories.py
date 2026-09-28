"""Render recorded runs into trajectories a person can follow.

The raw JSONL is the record; this is the reading copy. It interleaves what the
agent asked its tools, what came back, what each stage concluded, what
verification removed, and how the rules turned that into a verdict -- in the
order it happened.

Every prompted arm in the project gets a reading copy, not just the pipeline:
the two baseline solutions and the memorisation probe (which are scored arms in
the headline table), Path Finder, and the contributor profiler. A reader
checking "one trajectory per agent" should not have to open a JSONL file.

Runs entirely from committed fixtures and trajectories. No key, no spend.

Run:  PYTHONPATH=. uv run python scripts/render_trajectories.py
"""

from __future__ import annotations

import json
from pathlib import Path

from eval import baseline, baseline_matched
from holt.agent.pipeline import analyze
from holt.evidence.fixtures import FixtureProvider
from holt.model import PRICES, ReplayModel, TRAJECTORY_DIR
from holt.types import Window

OUT = Path("trajectories")
FEATURED = ["is-a-dev/register", "NixOS/nixpkgs", "SecureBananaLabs/bug-bounty"]

# The one repository where the baseline solution and Holt disagree outright, so
# the comparison arms are worth reading side by side on it.
COMPARISON = "is-a-dev/register"
PATHFINDER_CASE = "NixOS/nixpkgs"
PROFILE_CASE = ("home-assistant/core", "epenet")


def fname(slug: str) -> str:
    return slug.replace("/", "__") + ".jsonl"


def load_calls(slug: str, root: Path = TRAJECTORY_DIR) -> list[dict]:
    return [json.loads(l) for l in (root / fname(slug)).read_text().splitlines() if l.strip()]


def cost_of(call: dict) -> float:
    u = call.get("usage", {})
    ri, ro = PRICES.get(call["model"], (0, 0))
    return u.get("input_tokens", 0) / 1e6 * ri + u.get("output_tokens", 0) / 1e6 * ro


def call_block(call: dict, title: str, prompt_chars: int = 1500,
               response_chars: int = 1800) -> list[str]:
    """One model call, rendered: instructions, what it was shown, what it said."""
    u = call.get("usage", {})
    return [
        f"## {title}",
        "",
        f"*Model:* `{call['model']}` · *{u.get('input_tokens', 0)} in / "
        f"{u.get('output_tokens', 0)} out tokens · ${cost_of(call):.4f}*",
        "",
        "<details><summary>Instructions given to the model</summary>",
        "",
        "```",
        call["system"].strip(),
        "```",
        "</details>",
        "",
        f"<details><summary>Evidence it was shown (first {prompt_chars} chars)</summary>",
        "",
        "```",
        call["prompt"][:prompt_chars].strip(),
        "```",
        "</details>",
        "",
        "**What it answered:**",
        "",
        "```json",
        json.dumps(call["response"], indent=1)[:response_chars],
        "```",
        "",
    ]


def render(slug: str) -> str:
    provider = FixtureProvider(Window.PRE_T)
    model = ReplayModel(TRAJECTORY_DIR / fname(slug))
    assessment, trace = analyze(slug, provider, model)
    calls = {c["label"]: c for c in load_calls(slug)}

    fetches = [c for c in provider.call_log if c[0] == "fetch"]
    resolves = [c for c in provider.call_log if c[0] == "resolve"]
    hit = sum(1 for c in resolves if c[2])

    out = [
        f"# Trajectory — {slug}",
        "",
        f"**Verdict:** `{assessment.verdict.value}`  ",
        f"**Rule that decided it:** {trace.rules[0] if trace.rules else '(none)'}",
        "",
        "Replayed from committed fixtures and recorded model output. No model ran.",
        "",
        "## 1. Evidence retrieved (tool call)",
        "",
        f"`provider.fetch(\"{slug}\")` → **{fetches[0][2] if fetches else 0} records**, "
        f"every one asserted to be dated at or before the cutoff 2026-06-01.",
        "",
        "## 2. Signals computed — arithmetic, no model",
        "",
        "```",
        json.dumps(trace.signals.as_dict(), indent=1),
        "```",
        "",
    ]

    stage_titles = {
        "classify": "3. Stage A — what kind of repository is this?",
        "opportunity": "4. Stage B — is there a real route in?",
        "outcomes": "5. Stage C — what happened to people who tried?",
    }
    for label, title in stage_titles.items():
        call = calls.get(label)
        if call:
            out += call_block(call, title)

    unresolved = [c[1] for c in resolves if not c[2]]
    out += [
        "## 6. Stage D — verification (tool calls, no model)",
        "",
        f"Every evidence id cited by every finding was looked up against the provider: "
        f"**{len(resolves)} lookups, {hit} resolved, {len(resolves) - hit} did not.**",
        "",
        "Verification works at two levels. An id that does not resolve is stripped "
        "from the finding that cited it. A finding left with *no* resolving id at "
        "all is dropped entirely — not softened, not hedged, removed.",
        "",
        f"Findings before verification: **{trace.before_verification}**  ",
        f"Findings after verification: **{trace.after_verification}**  ",
        f"Findings dropped outright: **{len(trace.dropped)}**  ",
        f"Individual citations stripped: **{len(unresolved)}**",
        "",
    ]
    if unresolved:
        out += ["Ids that did not resolve, and were removed from the claims citing them:", ""]
        out += [f"- `{u}`" for u in unresolved[:10]]
        if len(unresolved) > 10:
            out += [f"- …and {len(unresolved) - 10} more"]
        out += [""]
    if trace.dropped:
        out += ["Findings dropped outright, with the ids they cited:", ""]
        out += [f"- `{d.field}` citing `{list(d.evidence_ids)}`" for d in trace.dropped]
        out += [""]
    else:
        out += [
            "No finding lost every one of its citations on this run, so none was "
            "dropped outright.",
            "",
        ]

    out += [
        "",
        "## 7. Verdict — a plain function, no model",
        "",
        "`verdict.py` turned the surviving findings and the signals into a verdict.",
        "The model was not consulted and could not have overridden it.",
        "",
        "```",
        *[f"{r}" for r in trace.rules],
        f"=> {assessment.verdict.value}",
        "```",
        "",
        "## 8. Stage E — narration",
        "",
        "The verdict above was passed to Stage E as an input it cannot change.",
        "",
        "---",
        "",
        assessment.render(),
    ]
    return "\n".join(out)


def render_comparison_arms(slug: str) -> str:
    """The three scored comparison arms, on the case where they disagree.

    `baseline` and `baseline_matched` are solutions with their own entry points,
    so they are *run* here rather than read out of the record. `name_only` is a
    probe that only ever existed inside the harness, so its recorded call is
    rendered directly.
    """
    base_model = ReplayModel(TRAJECTORY_DIR / fname(slug))
    base = baseline.assess(slug, FixtureProvider(Window.PRE_T), base_model)

    matched_model = ReplayModel(TRAJECTORY_DIR / fname(slug))
    matched = baseline_matched.assess(slug, FixtureProvider(Window.PRE_T), matched_model)

    holt, trace = analyze(slug, FixtureProvider(Window.PRE_T),
                          ReplayModel(TRAJECTORY_DIR / fname(slug)))

    calls = {c["label"]: c for c in load_calls(slug)}
    probe = {c["label"]: c for c in load_calls(slug, TRAJECTORY_DIR / "run1")}.get("name_only")

    out = [
        f"# Trajectory — the comparison arms on {slug}",
        "",
        "Three methods are scored against Holt in the headline table, and each is "
        "one model call. This is all three on the repository where they part "
        "company with Holt: a domain registry where an outsider's merged pull "
        "request is one line of their own name in a data file.",
        "",
        "| Arm | What it is shown | Verdict here |",
        "|---|---|---|",
        f"| `name_only` (memorisation probe) | the repository name, nothing else | "
        f"`{probe['response'].get('verdict') if probe else 'n/a'}` |",
        f"| `baseline` (the baseline solution) | README + repository metadata | "
        f"`{base.verdict.value}` |",
        f"| `baseline_matched` (evidence-matched ablation) | the same signals and "
        f"threads Holt reads, in one prompt | `{matched.verdict.value}` |",
        f"| **Holt** | the full pipeline | **`{holt.verdict.value}`** |",
        "",
        f"Holt's rule: {trace.rules[0] if trace.rules else '(none)'}",
        "",
        "The full Holt walkthrough for this repository is "
        f"[`{fname(slug).replace('.jsonl', '.md')}`]({fname(slug).replace('.jsonl', '.md')}).",
        "",
        "Replayed from committed recordings. No model ran.",
        "",
        "---",
        "",
    ]

    if probe:
        out += call_block(probe, "1. `name_only` — what a chat model recalls from the name",
                          prompt_chars=400)
    if "baseline" in calls:
        out += call_block(calls["baseline"],
                          "2. `baseline` — one prompt over README and metadata")
        out += [
            "**The report it produced:**",
            "",
            "---",
            "",
            base.render(),
            "",
            "---",
            "",
            "Note what the rendering does *not* do: the baseline cites nothing, "
            "because it was shown nothing citable. Its reasons are impressions of "
            "a README, and the report says so rather than dressing them as "
            "evidence.",
            "",
        ]
    if "baseline_matched" in calls:
        out += call_block(calls["baseline_matched"],
                          "3. `baseline_matched` — the same evidence, one call")
        out += [
            "This arm exists to separate two claims that are easy to confuse: "
            "*reading pull request history beats reading a landing page*, and "
            "*a staged pipeline beats one call*. It gets the same signals and the "
            "same thread digest Holt reads. What differs is only the "
            "architecture — one model call decides, instead of typed findings "
            "passing through verification into a model-free verdict function.",
            "",
            f"Its verdict here: `{matched.verdict.value}`. Out of sample it scores "
            "MCC 0.32 against Holt's 0.63, and specificity 0.47 against 0.83 — "
            "most of the remaining gap is the rejection rule the model cannot "
            "override.",
            "",
        ]
    return "\n".join(out)


def render_recorded(path: Path, title: str, preamble: list[str],
                    call_title: str, index: int = 0) -> str:
    calls = [json.loads(l) for l in path.read_text().splitlines() if l.strip()]
    out = [f"# Trajectory — {title}", "", *preamble, "",
           f"Rendered from `{path}`, one of {len(calls)} recorded call(s) in that "
           "file. Replayed from committed recordings; no model ran.", "", "---", ""]
    out += call_block(calls[index], call_title, prompt_chars=2000)
    return "\n".join(out)


INDEX = """# Agent trajectories

Each file walks one run from the instructions the agent was given to the result
it produced, in the order it happened: the evidence it retrieved, what each
stage was asked and answered, which findings verification removed, and how the
rules turned what survived into a verdict.

All of it replays from committed fixtures and recorded model output, so nothing
here needs a key.

## The full pipeline, end to end

| Trajectory | Verdict | Why it is worth reading |
|---|---|---|
| [`is-a-dev/register`](is-a-dev__register.md) | `not_viable` | A registry with hundreds of merged outsider pull requests. The baseline solution calls it viable. |
| [`NixOS/nixpkgs`](NixOS__nixpkgs.md) | `viable` | A genuine opportunity that the naive label ranked 17th of 22. |
| [`SecureBananaLabs/bug-bounty`](SecureBananaLabs__bug-bounty.md) | `not_viable` | A thousand inbound attempts, nothing merged. |

Each covers Stages A, B and C (one model call each), Stage D verification (tool
calls, no model), the verdict function, and Stage E narration.

## The other prompted agents

| Trajectory | What it is |
|---|---|
| [comparison arms on `is-a-dev/register`](comparison-arms--is-a-dev__register.md) | all three scored comparison arms — `name_only`, `baseline`, `baseline_matched` — on the case where they disagree with Holt |
| [Path Finder on `NixOS/nixpkgs`](pathfinder--NixOS__nixpkgs.md) | ranking a repository's open issues by how likely an outsider is to land a fix; ships behind a flag that prints its own losing number |
| [contributor profile, `home-assistant/core`](profile--home-assistant__core__epenet.md) | turning one contributor's merged work into a competence profile for `holt next` |

Together with the pipeline files above, that is one reading copy per prompted
agent in the project. The one exception is `describe()`
(`src/holt/agent/progression.py`), which has no recorded calls because the model
call it wraps moved 0 of 88 rankings when measured and was cut — `holt next`
runs no model at all.

## The raw record

[`../fixtures/trajectories/`](../fixtures/trajectories/) holds every model call
made anywhere in the project, one JSON object per call with the full system
prompt, prompt, response and token usage. The benchmark directories carry all
seven scored labels for all 22 pool-1 repositories —

```
baseline 22   baseline_matched 22   name_only 22
classify 22   opportunity 22        outcomes 22   narrate 22
```

— with `pathfinder/` (57 calls), `progression/` (88), `discover/`, `control/`
and `dev/` alongside them.

## Retries, and where a human decides

**No retry appears in these trajectories because the design has nowhere to put
one.** Output shape is enforced at the API with a strict JSON schema, so a
malformed answer is impossible rather than retried; the only retries in the
system are transport-level (`max_retries = 4` on the client in
`src/holt/model.py`, for network and 5xx failures) and they never produce a
second answer to the same question. A stage that returns a finding whose
evidence does not resolve is not re-prompted either — Stage D drops the finding.
Verification subtracts; it never asks again.

**There is no human approval step mid-run because there is no consequential
action to approve.** Holt never writes to GitHub, opens a pull request or
contacts a maintainer; it reads public data. The human decisions are the ones
before and after: what to ask (`holt profile`, `--days`), whether to spend
anything at all (`--replay` and `--no-model` against `--live`), a cap on how
many full analyses a discovery session may run (`--survivors`), and reading the
evidence section before committing a week. In the terminal interface, the two
questions that destroy work — stopping a live run, quitting with runs in flight
— are confirmed before they happen.

Regenerate everything here with
`PYTHONPATH=. uv run python scripts/render_trajectories.py`.
"""


def main() -> None:
    OUT.mkdir(exist_ok=True)
    written = []

    def write(name: str, build) -> None:
        try:
            (OUT / name).write_text(build() + "\n")
            written.append(name)
            print(f"  rendered {name}")
        except Exception as exc:
            print(f"  SKIPPED {name}: {type(exc).__name__}: {exc}")

    for slug in FEATURED:
        write(fname(slug).replace(".jsonl", ".md"), lambda s=slug: render(s))

    write(
        "comparison-arms--" + fname(COMPARISON).replace(".jsonl", ".md"),
        lambda: render_comparison_arms(COMPARISON),
    )

    write(
        "pathfinder--" + fname(PATHFINDER_CASE).replace(".jsonl", ".md"),
        lambda: render_recorded(
            TRAJECTORY_DIR / "pathfinder" / fname(PATHFINDER_CASE),
            f"Path Finder on {PATHFINDER_CASE}",
            [
                "Path Finder ranks a repository's open issues by how likely an "
                "outsider is to land a fix. It is in the repository, behind a "
                "flag, printing its own losing number: precision@3 **0.173** "
                "against GitHub's own `good first issue` label at **0.187**, over "
                "3,613 issues. It was cut on a condition written before the "
                "feature existed, and it ships anyway because the ranking is "
                "still readable evidence and the comparison is the point.",
            ],
            "The Path Finder call",
        ),
    )

    repo, login = PROFILE_CASE
    write(
        "profile--" + repo.replace("/", "__") + f"__{login}.md",
        lambda: render_recorded(
            TRAJECTORY_DIR / "progression" / f"{repo.replace('/', '__')}__{login}.jsonl",
            f"contributor profile — {login} in {repo}",
            [
                "`holt next` ranks open issues for somebody who has already "
                "merged work in a repository. This agent turns that person's "
                "merged pull requests and the review feedback on them into a "
                "competence profile, which feeds exactly one term in the "
                "ranking.",
                "",
                "It was measured and cut: adding the profile term moved **0 of "
                "88** rankings — 0 wins, 0 losses, 88 ties — which is why the "
                "shipped `holt next` runs no model call and costs nothing. The "
                "call is here because the experiment is in the changelog and the "
                "record should be readable.",
            ],
            "The profile call",
        ),
    )

    (OUT / "README.md").write_text(INDEX)
    print(f"\nwrote {len(written)} trajectories + index to {OUT}/")


if __name__ == "__main__":
    main()
