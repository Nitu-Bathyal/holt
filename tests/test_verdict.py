"""The verdict is deterministic, so it can be tested exhaustively rather than sampled."""

from __future__ import annotations

from holt.agent.findings import Findings
from holt.agent.signals import Signals
from holt.agent.verdict import classify, contested_kind, rule_codes
from holt.report import Verdict


def signals(**over) -> Signals:
    base = dict(
        total_threads=20,
        outsider_threads=10,
        outsider_merged=4,
        outsider_ignored=1,
        median_first_response_hours=12.0,
        bot_share=0.1,
        distinct_outsider_authors=4,
        distinct_merged_authors=4,
        reviewed_share=0.5,
        merge_rate=0.4,
    )
    base.update(over)
    return Signals(**base)


def findings(**fields) -> Findings:
    f = Findings()
    for k, v in fields.items():
        f.add(k, v, evidence_ids=("repo:a/b:readme",))
    return f


def test_a_healthy_repo_is_viable():
    v, trace = classify(findings(repo_kind="real_software"), signals())
    assert v is Verdict.VIABLE and trace


def test_registries_are_not_viable_however_active():
    """The whole point: high merge volume must not rescue a registry."""
    v, trace = classify(
        findings(repo_kind="registry"),
        signals(outsider_merged=400, distinct_outsider_authors=150),
    )
    assert v is Verdict.NOT_VIABLE
    assert trace[0].code == "non_software_kind"
    assert "software" in trace[0]


def test_archived_beats_every_other_signal():
    v, _ = classify(findings(repo_kind="real_software", is_archived=True), signals())
    assert v is Verdict.NOT_VIABLE


def test_mirrors_are_not_viable():
    assert classify(findings(repo_kind="mirror"), signals())[0] is Verdict.NOT_VIABLE


def test_no_attempts_is_insufficient_not_hostile():
    v, trace = classify(findings(repo_kind="real_software"), signals(outsider_threads=0))
    assert v is Verdict.INSUFFICIENT_EVIDENCE
    assert "nothing to judge" in trace[0] and trace[0].code == "no_attempts"


def test_ignored_attempts_with_no_merges_is_not_viable():
    v, _ = classify(
        findings(repo_kind="real_software"),
        signals(outsider_threads=10, outsider_merged=0, outsider_ignored=9),
    )
    assert v is Verdict.NOT_VIABLE


def test_one_person_merging_repeatedly_is_not_a_pattern():
    v, _ = classify(
        findings(repo_kind="real_software"),
        signals(outsider_merged=5, distinct_outsider_authors=1, distinct_merged_authors=1),
    )
    assert v is Verdict.INSUFFICIENT_EVIDENCE


def test_two_merges_by_one_person_among_many_who_tried_is_not_a_pattern():
    """The pass rule counted people who tried, not people who got merged:
    lazygit's 2 merges were one person's, out of 35 who tried."""
    v, trace = classify(
        findings(repo_kind="real_software"),
        signals(outsider_merged=2, distinct_outsider_authors=35, distinct_merged_authors=1),
    )
    assert v is Verdict.INSUFFICIENT_EVIDENCE
    assert rule_codes(trace)[-1] == "few_people"
    assert "came from one person" in trace[-1]


def test_a_response_slower_than_a_week_blocks_viable():
    v, trace = classify(
        findings(repo_kind="real_software"), signals(median_first_response_hours=400.0)
    )
    assert v is Verdict.INSUFFICIENT_EVIDENCE
    assert "slow" in rule_codes(trace)


def test_classify_is_pure():
    """Same inputs, same answer -- the property the reproduction claim rests on."""
    f, s = findings(repo_kind="real_software"), signals()
    assert classify(f, s) == classify(f, s)


def test_a_handful_of_ignored_attempts_is_not_proof_of_hostility():
    """Four ignored pull requests out of four is four data points, not a policy."""
    v, trace = classify(
        findings(repo_kind="real_software"),
        signals(outsider_threads=4, outsider_merged=0, outsider_ignored=4,
                median_first_response_hours=None, distinct_outsider_authors=3),
    )
    assert v is Verdict.INSUFFICIENT_EVIDENCE
    assert "too_few_attempts" in rule_codes(trace)


def test_many_ignored_attempts_still_reads_as_hostile():
    v, _ = classify(
        findings(repo_kind="real_software"),
        signals(outsider_threads=40, outsider_merged=0, outsider_ignored=36),
    )
    assert v is Verdict.NOT_VIABLE


def test_a_rubber_stamp_is_rejected_even_when_everything_else_looks_healthy():
    """Landing easily and drawing no review is the registry signature."""
    v, trace = classify(
        findings(repo_kind="real_software"),
        signals(reviewed_share=0.09, merge_rate=0.69),
    )
    assert v is Verdict.NOT_VIABLE
    assert "rubber_stamp" in rule_codes(trace)


def test_unreviewed_but_hard_to_land_is_not_a_rubber_stamp():
    """nixpkgs merges without visible review because review happened elsewhere.

    This is the case that killed the first rejection rule, so it has a test.
    """
    v, _ = classify(
        findings(repo_kind="real_software"),
        signals(reviewed_share=0.09, merge_rate=0.15),
    )
    assert v is Verdict.VIABLE


def test_reviewed_and_easy_to_land_is_a_welcoming_project():
    v, _ = classify(
        findings(repo_kind="real_software"),
        signals(reviewed_share=0.80, merge_rate=0.75),
    )
    assert v is Verdict.VIABLE


def test_the_time_budget_changes_what_counts_as_too_slow():
    """A five-day median reply is fine with three months and fatal with three days."""
    s = signals(median_first_response_hours=120.0)
    assert classify(findings(repo_kind="real_software"), s, contributor_days=90)[0] is Verdict.VIABLE
    v, trace = classify(findings(repo_kind="real_software"), s, contributor_days=3)
    assert v is Verdict.INSUFFICIENT_EVIDENCE
    assert any("3 days you have" in t for t in trace)


# ─── contesting the kind ────────────────────────────────────────────────────
#
# `repo_kind` is the only model-derived field that can decide the answer alone,
# and Stage D cannot check it. These hold the rule that checks it against the
# evidence, and — as importantly — the cases it must leave alone.


def test_a_catalogue_claim_survives_evidence_that_looks_like_a_catalogue():
    """`is-a-dev/register`, `plugin-hub`, `homebrew-cask`: one file, one place."""
    f = findings(repo_kind="registry")
    s = signals(merged_with_files=40, merged_files_median=1.0, merged_dirs_median=1.0)
    assert contested_kind(f, s) is None
    assert classify(f, s)[0] is Verdict.NOT_VIABLE


def test_a_registry_of_three_file_manifests_is_still_a_registry():
    """The regression that killed the first version of this rule.

    A `microsoft/winget-pkgs` entry is three YAML manifests — installer, locale,
    version — in one package directory. A median-files threshold called that a
    hallucination on all four of its recordings. Landing in one place is what
    makes a catalogue entry, not weighing little.
    """
    f = findings(repo_kind="registry")
    s = signals(merged_with_files=180, merged_files_median=3.0, merged_dirs_median=1.0)
    assert contested_kind(f, s) is None


def test_a_catalogue_claim_over_work_that_spans_the_tree_is_contested():
    f = findings(repo_kind="registry")
    s = signals(merged_with_files=66, merged_files_median=9.5, merged_dirs_median=3.0)
    reason = contested_kind(f, s)
    assert reason and "set aside" in reason and reason.code == "kind_contested"


def test_a_contested_kind_decides_nothing_and_the_arithmetic_decides_instead():
    f = findings(repo_kind="registry")
    s = signals(merged_with_files=66, merged_dirs_median=3.0)
    f.drop("repo_kind")  # what the pipeline does with a contested field
    verdict, trace = classify(f, s)
    assert verdict is Verdict.VIABLE
    assert not any("repo_kind" in line for line in trace)


def test_too_few_merges_to_have_a_shape_contests_nothing():
    """Four merged pull requests is not a description of what a merge is here."""
    f = findings(repo_kind="registry")
    assert contested_kind(f, signals(merged_with_files=4, merged_dirs_median=4.0)) is None


def test_a_portfolio_is_not_contested_by_the_shape_of_its_diffs():
    """Its reason is whose project it is. A portfolio being real code is not a
    contradiction, and treating it as one would gut the rule."""
    f = findings(repo_kind="portfolio")
    s = signals(merged_with_files=22, merged_files_median=8.0, merged_dirs_median=3.0)
    assert contested_kind(f, s) is None
    assert classify(f, s)[0] is Verdict.NOT_VIABLE


def test_a_mirror_that_merges_outsiders_is_contested():
    """`pytorch/pytorch` called a mirror of `pytorch/pytorch`. GitHub says it is
    not a mirror, and outsiders' pull requests merge."""
    f = findings(repo_kind="mirror")
    s = signals(outsider_merged=15, distinct_merged_authors=15)
    reason = contested_kind(f, s, {"is_mirror": False})
    assert reason and "doesn't mark it as a mirror" in reason


def test_a_real_mirror_keeps_its_verdict():
    """Metadata alone must not decide it: GitHub sets `is_mirror` only for
    repositories created as mirrors, so a genuine mirror reports false. With no
    merges there is nothing disproving the claim, and the rule stands."""
    f = findings(repo_kind="mirror")
    s = signals(outsider_merged=0, distinct_merged_authors=0)
    assert contested_kind(f, s, {"is_mirror": False}) is None
    assert classify(f, s)[0] is Verdict.NOT_VIABLE
    # And a repository GitHub *does* call a mirror is never contested.
    assert contested_kind(
        f, signals(outsider_merged=15, distinct_merged_authors=15), {"is_mirror": True}
    ) is None


# --- ticket 08: rules for live readings ---------------------------------------

LIVE = 14 * 24.0  # a live reading carries the settle window it counted with


def test_the_merge_rate_floor_turns_a_long_shot_down():
    """flask: 5 of 171 decided outside pull requests merged."""
    s = signals(outsider_threads=171, outsider_merged=5, distinct_merged_authors=4,
                distinct_outsider_authors=147, merge_rate=5 / 171, settle_hours=LIVE)
    v, trace = classify(findings(), s)
    assert v is Verdict.NOT_VIABLE
    # Decided before the merge count, which it overrules.
    assert rule_codes(trace)[-1] == "long_odds" and "merges" not in rule_codes(trace)
    assert trace[-1].startswith("Only 5 of 171 pull requests") and "1 in 34" in trace[-1]


def test_the_floor_is_not_applied_to_the_frozen_benchmark():
    s = signals(outsider_threads=171, outsider_merged=5, merge_rate=5 / 171)
    assert classify(findings(), s)[0] is Verdict.VIABLE


def test_five_percent_or_more_passes_the_floor():
    """...into Long shot, which fewer than 1 in 10 merged is."""
    s = signals(outsider_threads=40, outsider_merged=2, distinct_merged_authors=2,
                merge_rate=0.05, settle_hours=LIVE)
    v, trace = classify(findings(), s)
    assert v is Verdict.LONG_SHOT and rule_codes(trace)[-1] == "few_merged"


def test_the_rubber_stamp_reads_outside_merges_only_on_a_live_reading():
    """plantuml: the owner merges his own commits unreviewed (19% overall),
    while 47% of outside merges got a comment."""
    s = signals(outsider_threads=53, outsider_merged=43, merge_rate=43 / 53,
                reviewed_share=0.19, outsider_reviewed_share=0.47, settle_hours=LIVE)
    assert classify(findings(), s)[0] is Verdict.VIABLE
    waved = signals(outsider_threads=53, outsider_merged=43, merge_rate=43 / 53,
                    reviewed_share=0.5, outsider_reviewed_share=0.1, settle_hours=LIVE)
    v, trace = classify(findings(), waved)
    assert v is Verdict.NOT_VIABLE and rule_codes(trace)[-1] == "rubber_stamp"
    assert "from outside contributors" in trace[-1]


def test_the_rubber_stamp_needs_ten_outside_merges():
    few = signals(outsider_threads=4, outsider_merged=3, merge_rate=0.75,
                  reviewed_share=0.0, outsider_reviewed_share=0.0, settle_hours=LIVE)
    assert classify(findings(), few)[0] is Verdict.VIABLE
    # The frozen benchmark keeps the rule it was scored with.
    frozen = signals(outsider_threads=4, outsider_merged=3, merge_rate=0.75, reviewed_share=0.0)
    assert classify(findings(), frozen)[0] is Verdict.NOT_VIABLE


def test_an_inactive_project_is_not_worth_it():
    line = "The last pull request merged here was on 11 Feb 2020, so this project looks inactive."
    v, trace = classify(findings(inactive=line), signals(settle_hours=LIVE))
    assert v is Verdict.NOT_VIABLE
    assert rule_codes(trace) == ["inactive"] and trace[0] == line


def test_slow_replies_on_a_project_that_merges_are_a_note_not_a_reason():
    """efcore: 41 of 44 merged, but first replies take ~12 days."""
    s = signals(outsider_threads=44, outsider_merged=41, distinct_merged_authors=19,
                merge_rate=41 / 44, median_first_response_hours=277.5, settle_hours=LIVE,
                outsider_reviewed_share=1.0)
    v, trace = classify(findings(), s)
    assert v is Verdict.VIABLE
    assert rule_codes(trace)[-2:] == ["merges", "slow_note"]
    assert trace[-1] == "Replies are slow here: typically 11.6 days, beyond your 7-day budget."
    v14, trace14 = classify(findings(), s, contributor_days=14)
    assert v14 is Verdict.VIABLE and "slow_note" not in rule_codes(trace14)
    v1, trace1 = classify(findings(), s, contributor_days=1)
    assert v1 is Verdict.VIABLE and "beyond your 1-day budget" in trace1[-1]


def test_on_a_live_reading_the_budget_never_changes_the_verdict():
    """What `server/report.retime` relies on."""
    shapes = [
        {}, {"outsider_merged": 1}, {"outsider_merged": 0, "outsider_ignored": 9},
        {"outsider_merged": 3, "distinct_merged_authors": 1},
        {"outsider_merged": 0, "outsider_ignored": 4, "outsider_threads": 5},
        {"reviewed_share": 0.1, "outsider_reviewed_share": 0.1, "merge_rate": 0.9,
         "outsider_merged": 12, "outsider_threads": 13},
    ]
    for shape in shapes:
        s = signals(median_first_response_hours=400.0, settle_hours=LIVE, **shape)
        answers = {classify(findings(), s, contributor_days=d)[0] for d in (1, 7, 14, 30, 90)}
        assert len(answers) == 1, shape
        # The reason the evidence is thin is said whatever the budget.
        slow_codes = rule_codes(classify(findings(), s, contributor_days=7)[1])
        fast_codes = rule_codes(classify(findings(), s, contributor_days=30)[1])
        assert [c for c in slow_codes if c not in ("slow", "slow_note")] == fast_codes, shape


# --- verdict tiers: Long shot, the floor from 20 attempts, reason lines ---------


def live(**over) -> Signals:
    """A live reading that is plainly Worth your time unless told otherwise."""
    base = dict(outsider_threads=100, outsider_merged=40, distinct_merged_authors=20,
                distinct_outsider_authors=60, outsider_ignored=10, outsider_answered=80,
                merge_rate=0.4, median_first_response_hours=20.0, settle_hours=LIVE,
                outsider_reviewed_share=0.9)
    base.update(over)
    return signals(**base)


def test_a_live_reading_that_merges_and_answers_is_worth_it():
    v, trace = classify(findings(), live())
    assert v is Verdict.VIABLE and rule_codes(trace)[-1] == "merges"


def test_most_outside_work_unanswered_is_a_long_shot():
    """facebook/react: 21 of 151 merged, 107 got no reply at all."""
    s = live(outsider_threads=151, outsider_merged=21, merge_rate=21 / 151,
             outsider_ignored=107, outsider_answered=44)
    v, trace = classify(findings(), s)
    assert v is Verdict.LONG_SHOT
    assert rule_codes(trace)[-2:] == ["merges", "mostly_silent"]
    assert trace[-1].startswith("107 of 151 pull requests from outside contributors got no reply")


def test_half_unanswered_is_not_yet_a_long_shot():
    assert classify(findings(), live(outsider_ignored=50))[0] is Verdict.VIABLE
    assert classify(findings(), live(outsider_ignored=51))[0] is Verdict.LONG_SHOT


def test_fewer_than_one_in_ten_merged_is_a_long_shot():
    """django: 9 of 110."""
    s = live(outsider_threads=110, outsider_merged=9, distinct_merged_authors=6, merge_rate=9 / 110)
    v, trace = classify(findings(), s)
    assert v is Verdict.LONG_SHOT and rule_codes(trace)[-1] == "few_merged"
    assert trace[-1] == ("Only 9 of 110 pull requests from outside contributors were merged, "
                         "fewer than 1 in 10.")
    assert classify(findings(), live(outsider_merged=10, merge_rate=0.1))[0] is Verdict.VIABLE


def test_replies_over_three_weeks_are_a_long_shot_whatever_the_budget():
    """moment/moment: replies typically took about 100 days."""
    s = live(median_first_response_hours=99.7 * 24)
    for days in (1, 7, 30, 90):
        v, trace = classify(findings(), s, contributor_days=days)
        assert v is Verdict.LONG_SHOT and rule_codes(trace)[-1] == "slow_replies"
        assert "99.7 days" in trace[-1] and "slow_note" not in rule_codes(trace)
    assert classify(findings(), live(median_first_response_hours=20 * 24))[0] is Verdict.VIABLE


def test_a_typical_reply_time_needs_five_replies_to_decide():
    """fresco, over its last 12 months: a 26-day "typical" reply from two replies."""
    s = live(median_first_response_hours=627.7, outsider_answered=2)
    assert classify(findings(), s)[0] is Verdict.VIABLE


def test_silence_on_github_says_nothing_where_merges_land_through_another_review_site():
    """golang/go: all 44 outside merges landed through Gerrit; 85 of 152 silent on GitHub."""
    s = live(outsider_threads=152, outsider_merged=44, merge_rate=44 / 152,
             outsider_ignored=85, outsider_answered=2, outsider_landed_elsewhere=44)
    assert classify(findings(), s)[0] is Verdict.VIABLE
    # Merged the ordinary way, the same silence is a long shot.
    assert classify(findings(), live(outsider_threads=152, outsider_merged=44,
                                     merge_rate=44 / 152, outsider_ignored=85))[0] \
        is Verdict.LONG_SHOT


def test_every_long_shot_reason_is_its_own_line():
    s = live(outsider_threads=100, outsider_merged=7, merge_rate=0.07, outsider_ignored=60,
             median_first_response_hours=30 * 24)
    v, trace = classify(findings(), s)
    assert v is Verdict.LONG_SHOT
    assert rule_codes(trace)[-3:] == ["few_merged", "mostly_silent", "slow_replies"]


def test_the_floor_applies_from_twenty_attempts_whatever_merged():
    """vercel/next.js: 1 of 30 merged used to read "Not enough evidence"."""
    s = live(outsider_threads=30, outsider_merged=1, distinct_merged_authors=1,
             merge_rate=1 / 30, outsider_ignored=23, outsider_answered=7)
    v, trace = classify(findings(), s)
    assert v is Verdict.NOT_VIABLE and rule_codes(trace)[-1] == "long_odds"
    assert trace[-1] == ("Only 1 of 30 pull requests from outside contributors was merged, "
                         "about 1 in 30. Almost no outside work gets in here.")


def test_replying_but_never_merging_is_its_own_finding():
    """fastapi/fastapi: 0 of 95 merged, most of them answered."""
    s = live(outsider_threads=95, outsider_merged=0, distinct_merged_authors=0,
             merge_rate=0.0, outsider_ignored=5, outsider_answered=67)
    v, trace = classify(findings(), s)
    assert v is Verdict.NOT_VIABLE and rule_codes(trace)[-1] == "replies_no_merges"
    assert trace[-1].startswith("67 of 95 pull requests from outside contributors got a reply, "
                                "but none were merged.")


def test_under_twenty_attempts_the_floor_waits():
    s = live(outsider_threads=19, outsider_merged=0, distinct_merged_authors=0,
             merge_rate=0.0, outsider_ignored=2, outsider_answered=15)
    v, trace = classify(findings(), s)
    assert v is Verdict.INSUFFICIENT_EVIDENCE and rule_codes(trace)[-1] == "few_merges"
    assert "None of the 19 pull requests" in trace[-1]


def test_one_persons_merges_among_many_attempts_is_a_long_shot():
    s = live(outsider_threads=40, outsider_merged=8, distinct_merged_authors=1,
             merge_rate=0.2, distinct_outsider_authors=25)
    v, trace = classify(findings(), s)
    assert v is Verdict.LONG_SHOT and rule_codes(trace)[-1] == "one_person"
    thin = live(outsider_threads=10, outsider_merged=3, distinct_merged_authors=1, merge_rate=0.3)
    assert classify(findings(), thin)[0] is Verdict.INSUFFICIENT_EVIDENCE


def test_a_personal_project_gets_no_merge_verdict():
    line = "This looks like a hackathon project: every pull request here came from one person."
    v, trace = classify(findings(personal_project=line), live())
    assert v is Verdict.PERSONAL and rule_codes(trace) == ["personal"] and trace[0] == line


def test_the_frozen_benchmark_never_gets_the_new_answers():
    frozen = signals(outsider_threads=151, outsider_merged=21, merge_rate=21 / 151,
                     outsider_ignored=107, distinct_merged_authors=10)
    assert classify(findings(), frozen)[0] is Verdict.VIABLE
    nothing = signals(outsider_threads=95, outsider_merged=0, merge_rate=0.0, outsider_ignored=5)
    assert classify(findings(), nothing)[0] is Verdict.INSUFFICIENT_EVIDENCE


def test_every_reason_is_plain_english():
    shapes = [live(), live(outsider_ignored=60), live(outsider_merged=5, merge_rate=0.05),
              live(median_first_response_hours=600.0),
              live(outsider_threads=30, outsider_merged=1, distinct_merged_authors=1),
              live(outsider_threads=95, outsider_merged=0, distinct_merged_authors=0),
              live(outsider_threads=9, outsider_merged=0, distinct_merged_authors=0)]
    for s in shapes:
        for line in classify(findings(), s)[1]:
            assert "_" not in line and "%" not in line.replace("% of", ""), line


# --- engine 5: people's first pull requests, and catalogues ----------------------


def test_few_newcomers_merged_is_a_long_shot_and_its_reason_comes_first():
    """microsoft/vscode: 1 of 18 people's first pull request merged, while the
    pull request count (28%) cleared every other line. The backtest found this
    share predicts the next newcomers best (docs/research/BACKTEST.md)."""
    s = live(first_pr_people=18, first_pr_merged=1, outsider_ignored=60)
    v, trace = classify(findings(), s)
    assert v is Verdict.LONG_SHOT
    assert rule_codes(trace)[-2:] == ["few_newcomers_merged", "mostly_silent"]
    assert trace[-2] == ("Only 1 of the 18 people who sent their first pull request here "
                         "got it merged.")
    none = classify(findings(), live(first_pr_people=9, first_pr_merged=0))[1]
    assert none[-1] == "None of the 9 people who sent their first pull request here got it merged."


def test_the_newcomer_line_is_three_in_ten_from_eight_people():
    assert classify(findings(), live(first_pr_people=10, first_pr_merged=3))[0] is Verdict.VIABLE
    assert classify(findings(), live(first_pr_people=10, first_pr_merged=2))[0] \
        is Verdict.LONG_SHOT
    # Seven people is too few to say: the other rules decide.
    assert classify(findings(), live(first_pr_people=7, first_pr_merged=0))[0] is Verdict.VIABLE


def test_the_frozen_benchmark_never_reads_the_newcomer_line():
    s = signals(outsider_merged=4, first_pr_people=20, first_pr_merged=1)
    assert classify(findings(), s)[0] is Verdict.VIABLE


def test_a_catalogue_gets_its_own_answer_on_a_live_reading():
    """winget-pkgs, first-contributions: entries get merged easily, so "Not
    worth your time" was a false red on both backtest dates."""
    v, trace = classify(findings(repo_kind="registry"), live(outsider_merged=400))
    assert v is Verdict.CATALOGUE and rule_codes(trace)[-1] == "non_software_kind"
    assert classify(findings(repo_kind="awesome_list"), live())[0] is Verdict.CATALOGUE
    # Portfolio and course material are about whose project it is: unchanged.
    assert classify(findings(repo_kind="course_material"), live())[0] is Verdict.NOT_VIABLE
    # The frozen benchmark keeps the answer it was scored with.
    assert classify(findings(repo_kind="registry"), signals())[0] is Verdict.NOT_VIABLE
