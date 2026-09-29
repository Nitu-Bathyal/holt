"""The cat, its moods, and the colour it wears today.

One line, one kaomoji, no block art — so the mascot costs zero vertical space
and can sit in a masthead or a status line without a layout of its own.

**The face is not decoration, because it reports state.** Each mood below is
tied to something the engine actually decided: a run in progress, a verdict, a
claim Stage D removed. That is the whole justification for it being here — a
mascot that only looked nice would be the one element in an interface built on
"colour and shape carry meaning" that carried none.

Animation works the same way. The cat blinks slowly at rest and looks about
while a run is going, so motion means *something is happening* exactly as the
stage spinner does. Nothing loops to be lively.

The accent is chosen fresh each launch. That is deliberate and it is the only
colour in the app allowed to be arbitrary: it identifies a *session*, not a
state, so it is drawn from cool hues that cannot be mistaken for the verdict
green, the clay of a negative verdict, the red of a dropped claim, or the teal
of a resolvable evidence id. Those five keep their meanings whatever the cat is
wearing today.
"""

from __future__ import annotations

import os
import random

# ─── moods ──────────────────────────────────────────────────────────────────
#
# Frames are held by repetition: a frame listed eight times dwells eight ticks.
# Reading the tuple tells you the rhythm without a second table of durations.

TICK = 0.12

IDLE = ("(=^･ω･^=)",) * 9 + ("(=^-ω-^=)",)
WORKING = (
    ("(=^･ω･^=)",) * 2
    + ("(=^○ω○^=)",) * 2
    + ("(=^･ω･^=)",) * 2
    + ("(=^-ω-^=)",)
)
WORTH = ("(=^▽^=)",) * 11 + ("(=^-^=)",)
NOT_WORTH = ("(=^￣ω￣^=)",) * 14 + ("(=^-ω-^=)",)
NOT_ENOUGH = ("(=^¬_¬^=)",) * 13 + ("(=^-_-^=)",)
DROPPED = ("(=^○ω○^=)",) * 6 + ("(=^･ω･^=)",) * 2 + ("(=^○ω○^=)",) * 4

#: Mood name → frames. Anything not listed falls back to `idle`, so a state the
#: engine grows later shows a calm cat rather than raising.
MOODS: dict[str, tuple[str, ...]] = {
    "idle": IDLE,
    "working": WORKING,
    "worth_time": WORTH,
    "not_worth_time": NOT_WORTH,
    "not_enough_evidence": NOT_ENOUGH,
    "claim_dropped": DROPPED,
}

#: Verdict value → mood. Read through `.get`, never matched exhaustively:
#: `holt.report.Verdict` owns the enum and may grow a fourth member.
VERDICT_MOODS: dict[str, str] = {
    "viable": "worth_time",
    "long_shot": "not_enough_evidence",
    "not_viable": "not_worth_time",
    "insufficient_evidence": "not_enough_evidence",
    "personal": "idle",
}


def frames(mood: str) -> tuple[str, ...]:
    return MOODS.get(mood, IDLE)


def still(mood: str) -> str:
    """The resting frame, for when motion is off or the cat is not animated."""
    return frames(mood)[0]


def mood_for_verdict(value: str) -> str:
    return VERDICT_MOODS.get(value, "idle")


# ─── the accent of the day ──────────────────────────────────────────────────

#: Cool hues only. Deliberately excludes green, clay, red and teal, which are
#: the four colours that mean something elsewhere in the interface.
ACCENTS: tuple[str, ...] = (
    "#7e87c4",  # periwinkle
    "#9a7fc4",  # violet
    "#b07cb8",  # plum
    "#6f8fd0",  # steel blue
    "#8f7fd0",  # lilac
    "#7fa0c9",  # dusty blue
    "#a87fd0",  # amethyst
    "#8ca0d8",  # cornflower
)


def pick_accent() -> str:
    """A different colour each launch, unless one is pinned.

    `HOLT_TUI_ACCENT` fixes it — for a screenshot that should not change under
    you, and for the tests, which should not assert against a coin flip.
    """
    pinned = os.environ.get("HOLT_TUI_ACCENT", "").strip()
    if pinned:
        return pinned
    return random.choice(ACCENTS)


# ─── the words beside it ────────────────────────────────────────────────────

#: From `holt.cli`'s own docstring. The tool's description of itself, not a
#: second one written for the interface.
TAGLINE = "is this repository worth your time?"

#: The three things worth knowing before you type anything. Facts about how it
#: behaves, not a feature list.
FACTS: tuple[str, ...] = (
    "read-only — never writes to GitHub, never opens a pull request",
    "every claim carries an evidence id you can open and check",
    "a claim whose evidence does not resolve is dropped, not softened",
)
