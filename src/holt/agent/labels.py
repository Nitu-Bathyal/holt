"""Plain words for the values the model stages return.

The stages answer in enum values (`real_software`, `closed_dismissive`),
because a rule or a check has to compare them. A reader should never see one:
the evidence list printed "repo kind: real_software" and the web cards
"Closed dismissive, with nothing said". Every place that shows a finding to a
person goes through here. `web/src/lib/format.ts` keeps the same table for the
web's labels; a test holds the two together.
"""

from __future__ import annotations

# What happened to one outside pull request (stages.OUTCOMES_SCHEMA).
OUTCOMES = {
    "merged_after_review": "Merged after review",
    "merged_without_engagement": "Merged without review comments",
    "changes_requested": "Changes requested",
    "closed_with_guidance": "Closed, with a pointer elsewhere",
    "closed_dismissive": "Closed with no way forward",
    "ignored": "No reply",
}

# The same, when the model quoted nothing from the thread.
OUTCOMES_UNQUOTED = {
    **OUTCOMES,
    "closed_dismissive": "Closed with no explanation",
}

# The finding a claim is about.
FIELDS = {
    "repo_kind": "Kind of project",
    "onboarding": "Contributor guide",
    "outsider_posture": "How outside contributors are treated",
    "governance_flags": "Before you contribute",
    "is_archived": "Archived",
    "inactive": "Activity",
    "contribute_elsewhere": "Where to contribute",
}

# Values, by field. A value missing here is shown with its underscores
# replaced, which is still words, never an identifier.
VALUES = {
    "repo_kind": {
        "real_software": "a software project",
        "registry": "a catalogue of entries",
        "awesome_list": "a curated list of links",
        "portfolio": "a personal project",
        "course_material": "course material",
        "docs": "a documentation site",
        "mirror": "a read-only copy of a project developed elsewhere",
        "unclear": "unclear",
    },
    "onboarding": {
        "substantive": "clear enough to follow",
        "boilerplate": "generic, with little to follow",
        "absent": "none",
        "assumes_insider": "written for people already on the team",
    },
    "outsider_posture": {
        "welcoming": "welcoming",
        "mixed": "mixed",
        "discouraging": "discouraging",
        "absent": "no threads to judge from",
    },
    "governance_flags": {
        "cla_required": "a contributor licence agreement to sign",
        "corporate_controlled": "run by a company",
        "read_only": "read-only",
    },
    "is_archived": {"True": "yes", "False": "no"},
}


def _words(value: str) -> str:
    return value.replace("_", " ")


def outcome(value: str, quoted: bool = True) -> str:
    """"Closed with no way forward", or with nothing quoted, "Closed with no explanation"."""
    table = OUTCOMES if quoted else OUTCOMES_UNQUOTED
    return table.get(value) or _words(value).capitalize()


def field(name: str) -> str:
    return FIELDS.get(name) or _words(name).capitalize()


def value(name: str, raw: object) -> str:
    """A finding's value in words; a list is joined."""
    if isinstance(raw, list | tuple):
        return ", ".join(value(name, v) for v in raw)
    text = str(raw)
    return VALUES.get(name, {}).get(text) or _words(text)
