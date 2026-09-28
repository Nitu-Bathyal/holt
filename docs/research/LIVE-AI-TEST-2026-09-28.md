# Live AI test, 28 Sep 2026 (ticket 47)

The first run of every AI feature against a real model. Until now everything
ran on replays and fake clients.

- **Model:** `gpt-5-mini` (`gpt-5-mini-2025-08-07`) on OpenAI's API, with the
  user's key. The hard cap was $1.00.
- **Spent: $0.141 in total** (CLI $0.107 + local stack $0.034). Costs are the
  provider's reported token usage × gpt-5-mini list prices ($0.25 / $2.00 per
  million tokens in / out). Cached-input discounts are ignored, so this is an
  upper bound.
- **What ran:**
  - 8 CLI AI reports.
  - On a local stack (server + web + Postgres + holt-pro, ports 20000–20005):
    1 AI report through the web UI, 1 playbook unlock through the web UI and
    1 pre-flight with summary through the web UI.
  - Direct to holt-pro: 2 more playbooks and 2 more pre-flight summaries.
  - The example-report regeneration (#98), replay only.
- **Tested code:** Holt `main` at 48e8744 (before #107 and the 30 Sep verdict
  review) and holt-pro `main` at 89f90d5.
- **Nothing touched prod or staging.** Credits were granted with the admin
  CLI on the local database only.

## Headline

1. **The verdict never drifts.** On all 8 repos, the verdict is the same with
   and without a model (`--no-model`). Registry detection now works in the
   free tier too: is-a-dev is "Not worth your time" either way. No written
   report contradicted its verdict outright.
2. **Quotes can come from bystanders, not only from the project.** "Speaker-aware"
   only removes the PR author's own words, so any third party's comment is
   presented as the project's response.
   - react-native #58527 is labelled "changes requested". The quote is from
     another user asking whether the fix is safe in production. The narration
     turned it into "maintainers asking about safety/production use and
     requesting changes".
   - pallets/click #3720 is labelled "closed dismissive" with the quote
     "Retracted.", posted by an unrelated account (association `NONE`).
3. **Staff are still read as outsiders on big corporate repos.**
   - pytorch: the Outcomes stage read threads by `anijain2305`, `bobrenjc93`
     and `pdesupinski` (Meta, per their GitHub profiles) and by `huydhn`, and
     labelled several of them "ignored".
   - react-native: it read `Abbondanzo` (Meta).
   - Cause: both repos land merges through a bot or an internal sync, so
     `people.maintainers()` never sees a human merge.
4. **The narration contradicts the numbers printed under it**, because the
   prompt's legacy rule line says "N first-time merges … out of
   `outsider_threads` attempts" while the page says "out of `outsider_judgeable`":

   | Repo | Narration | "What decided it" |
   |---|---|---|
   | python-humanize | "37 first-time merges … out of 99 attempts" | "out of 90 attempts" |
   | react-native | "54 first-time contributor PRs were merged … out of 117" | "out of 71 attempts" |
   | nixpkgs (sentence removed by the check) | "40 of 134" | "out of 46" |

   "First-time" is also wrong: these are all outside merges. The narration
   check can't catch this, because every number in these sentences was
   measured.
5. **Playbook: promising, but its best section is almost always empty.**
   - "Why outside pull requests were closed" kept 2 of 8 items on
     pallets/click, 0 on astral-sh/uv and 0 on excalidraw.
   - The claim checker splits sentences inside quotes and treats PR numbers as
     uncounted figures. What survives on click has a visible fragment:
     `Use your own repos to learn how to use Git/GitHub.".`
6. **Pre-flight summary adds nothing and leaks internal ids.** It restates the
   rule checks and appends "(tests)", "(issue)", "(ci, size)". On uv it wrote
   "`ci` reports … `template` shows …". The rule-based checks themselves are
   fast (1.5 s, no model) and useful.

## Cost and latency

CLI: wall time for `holt analyze <repo> --live` (GitHub reads + 4 model stages).
The CLI does not log per-stage latency. The server's report records total
`seconds`.

| Run | Tokens in / out | Cost | Latency |
|---|---|---|---|
| CLI pallets/flask | 6,418 / 5,209 | $0.0120 | 82 s |
| CLI pytorch/pytorch | 10,878 / 5,357 | $0.0134 | 71 s |
| CLI facebook/react-native | 8,904 / 5,550 | $0.0133 | 84 s |
| CLI home-assistant/core | 7,775 / 6,218 | $0.0144 | 87 s |
| CLI excalidraw/excalidraw | 10,056 / 6,826 | $0.0162 | 97 s |
| CLI python-humanize/humanize (small, welcoming) | 9,090 / 5,876 | $0.0140 | 82 s |
| CLI is-a-dev/register | 5,476 / 4,073 | $0.0095 | 65 s |
| CLI NixOS/nixpkgs | 10,384 / 5,905 | $0.0144 | 75 s |
| **Web AI report**, pallets/click: classify / opportunity / outcomes / narrate | 7,405 / 5,533 | $0.0129 | 88 s click-to-render (model: 8.9 + 13.1 + 31.7 + 14.4 s; classify and opportunity overlap) |
| **Web playbook unlock**, pallets/click | 5,868 / 3,882 | $0.0092 | 85 s click-to-render (GitHub evidence ~35 s, model 44 s) |
| **Web pre-flight + summary**, pallets/click#3859 | 511 / 771 | $0.0017 | 13 s (model 8.9 s). Without the summary: 6 s, no model |
| holt-pro playbook, astral-sh/uv | 2,078 / 1,726 | $0.0040 | 69 s (evidence 51 s, model 17.7 s) |
| holt-pro playbook, excalidraw/excalidraw | 1,888 / 1,660 | $0.0038 | 60 s (model 16.6 s) |
| holt-pro pre-flight summary, astral-sh/uv#22032 | 551 / 554 | $0.0012 | 7.2 s (model 6.0 s) |
| holt-pro pre-flight summary, excalidraw#12187 | 505 / 401 | $0.0009 | 7.0 s (model 6.0 s) |
| Example AI report regeneration (#98), replay | — | $0 | 1.2 s, output identical to the committed file |
| **Total** | | **$0.141** | |

**What the numbers mean for pricing:**
- An AI report costs about $0.013 (₹1.1) and takes about 1.5 minutes.
- A playbook costs $0.004–0.009 and takes 1–1.5 minutes. Most of that time is
  reading GitHub.
- A pre-flight summary costs about $0.001.
- Reasoning tokens are 40–75% of output on every call.
- The server stages run serially apart from the first two. Running Outcomes
  (the 32 s stage) alongside classify and opportunity would cut about 20 s.

## Checks, per output

✅ = pass, ❌ = fail, ⚠️ = pass with a caveat.

- **Outsider-only:** the author association of every thread the Outcomes
  stage read, from GitHub. On pytorch and react-native it was also checked
  against known staff.
- **Speaker:** each quote was found in GitHub's comments and its speaker
  compared with the PR author and the team.
- **Jargon, numbers:** the final prose, after the narration check.
- **Drift:** the heading vs the rules-only verdict, plus a read of the text.

| Output | Outsider-only | Speaker-correct | No internal names | No unsupported numbers | No verdict drift | Bottom line useful |
|---|---|---|---|---|---|---|
| CLI flask | ✅ | ✅ 7/7 from maintainers | ✅ | ✅ | ✅ | ✅ "some PRs are closed bluntly over suspected LLM/junk submissions" |
| CLI pytorch | ❌ Meta staff read as outsiders | ⚠️ "@claude review these changes" and an AI review template quoted as maintainer review | ✅ | ⚠️ "0 ignored threads" beside 6 threads labelled "ignored" (too new to count) | ✅ | ⚠️ accurate but generic |
| CLI react-native | ❌ Meta staff (`Abbondanzo`) | ❌ #58527: a bystander's question presented as maintainers requesting changes | ✅ | ❌ "54 … out of 117" vs "out of 71" on the page | ✅ | ✅ "first maintainer reply in about a day" |
| CLI home-assistant | ⚠️ integration code owners read as outsiders (arguable) | ⚠️ 4 quotes from code owners without a maintainer tag | ✅ | ✅ | ✅ | ✅ |
| CLI excalidraw | ✅ | ⚠️ 3 quotes from people with no role tag | ✅ (the check caught `insufficient_evidence`) | ✅ | ⚠️ explains "Not enough evidence" as "insufficient evidence of reliably timely newcomer support", which is the meaning of a different verdict | ⚠️ "median first response was 388.1 hours": the rules line says 16.2 days |
| CLI humanize | ✅ | ✅ 9/9 | ✅ | ❌ "37 first-time merges … out of 99" vs "out of 90" | ✅ | ✅ |
| CLI is-a-dev | ✅ | ✅ (no quotes) | ✅ | ✅ | ✅ | ✅ explains it's a subdomain registry, not code review |
| CLI nixpkgs | ✅ | ⚠️ 1 quote without a role tag | ⚠️ the check removed a sentence naming `outsider_ignored`. It was the lead sentence, so the paragraph now opens with "Bot activity is low (6%)" | ⚠️ the removed sentence had "40 of 134" | ✅ | ✅ |
| Web AI report, click | ✅ | ❌ #3720 "Retracted." from an unrelated account (the other 7 from maintainers) | ⚠️ evidence cards read "Closed dismissive, with nothing said" | ✅ | ✅ | ✅ |
| Playbook, click (web) | n/a | ✅ kept quotes are by maintainers | ✅ | ✅ | ✅ (says it doesn't change the verdict) | n/a |
| Playbook, uv / excalidraw | n/a | n/a (no quotes survived) | ✅ | ✅ | ✅ | n/a |
| Pre-flight summary ×3 | n/a | n/a | ❌ `tests`, `issue`, `ci`, `size`, `template` | ✅ | ✅ ("doesn't predict whether this will be merged") | ❌ restates the checks |

## Excerpts

**AI report, pallets/click (web), bottom line.** Clear and readable, but
the numbers are already on the free card:

> You will encounter an active maintainer team that responds quickly to most
> external PRs and merges first-time contributors; expect fast, practical review
> for small-to-medium changes. The repo's onboarding is minimal and a few outsider
> PRs were closed without reply as spam or policy enforcement, so follow the
> project's contributing rules and guidance.

**AI report, flask (CLI).** This is the kind of detail the free tier can't
give:

> …several closed PRs include comments like "Do not submit LLM junk to projects"
> and links to the Pallets LLM policy.

**The bystander problem, react-native #58527.** The thread as the model saw it:

```
opened by wneel
[AdarshJais] Hi @wneel, have you added this fix to any of your production apps?
Just wanted to understand if it's safe to add, as I'm facing the similar issue…
```

The report's version: *"changes requested — "Hi @wneel, have you added this fix
to any of your production apps?…""* and *"maintainers asking about
safety/production use and requesting changes"*.

**pytorch evidence list.** These are not what a newcomer should read as
maintainer review:

> - changes requested — "@claude review these changes" — #198598
> - merged after review — "## Review summary 🔴 1 blocker · 🟠 1 major · ⚪ 1 nit" — #198704
> - (narration) "Review comments are substantive (examples include "LGTM." …)"

**Playbook, pallets/click (web).** Useful for experienced contributors:

> @kdeldycke reviewed 14 of 21 merged pull requests from people outside the
> project that touched src/.
> Typical merged pull requests from people outside the project changed about 20
> lines in 1 file; 23 of 30 changed 67 lines or fewer, while closed pull requests
> typically changed about 45 lines.

Confusing for a beginner: the data says tests don't separate merged from
closed PRs, but it's written up as a rule:

> Of merged pull requests … that changed code, 12 of 24 added or changed tests,
> while of those closed without merging 59 of 70 did.
> (checklist) If you change code, add or update tests.

The broken "why closed" item:

> Told the contributor to use their own repos or called the PR not a playground
> Use your own repos to learn how to use Git/GitHub.".

**Playbook, excalidraw / uv (direct).** Advice a newcomer can't act on:

> Make these checks pass before asking for a review: `CodeRabbit`, `Vercel – excalidraw`, `cancel`, `coverage`, `label-scope`, `lint`.
> Consider adding a changelog entry; 1 of 19 merged PRs that changed code added one.
> (uv) Run `cargo publish --dry-run` as that check ran on 58 of 62 merged pull requests…
> (uv) Smaller contributions are common: of the merged pull requests that changed code, 39 of 59 also changed tests…

**Pre-flight summary, astral-sh/uv#22032:**

> What looks fine: `ci` reports all 60 checks passed; `tests` notes the pull
> request adds or changes tests; `size` shows it changes 168 lines in 2 files …;
> `template` shows the description kept 0 of the 2 headings…

Screenshots (desktop and phone) are in
[`live-ai-test-2026-09-28/`](live-ai-test-2026-09-28/):
- [AI explanation](live-ai-test-2026-09-28/ai-report-desktop.jpg) ([phone](live-ai-test-2026-09-28/ai-report-phone.jpg))
- [unlocked playbook](live-ai-test-2026-09-28/playbook-desktop.jpg)
- [pre-flight with summary](live-ai-test-2026-09-28/preflight-desktop.jpg) ([phone](live-ai-test-2026-09-28/preflight-phone.jpg))

On the phone crops, the sticky site header is drawn over the section. That
comes from stitching element screenshots together; it is not how the page
looks.

## Would you pay for this?

| Feature | Newcomer | Experienced contributor | Verdict |
|---|---|---|---|
| AI report ($0.013, ~1.5 min) | Yes, the bottom line reads well. But most of it repeats the free card, and on 3 of 9 reports the numbers contradict the card beneath them. | Only for the quotes (flask's LLM-junk warnings, pytorch's review culture), and those are the least reliable part. | **Not yet.** Keep it as the free explanation. After fixes 1–3 it is a fair "3 free a month". |
| Playbook ($0.004–0.009, 1–1.5 min) | Some. Size and "who reviews" are concrete. The checklist sometimes gives advice the data contradicts (tests, changelog, CodeRabbit). | Yes. "@kdeldycke reviews src/" and "typical merged PR: 20 lines, 1 file" are what you'd spend an hour digging for. | **Yes, after fixes 5–6.** It's the strongest paid feature, but "why outside PRs were closed" has to work. |
| Pre-flight checks (rules, no model, 1.5 s) | Yes. "Changes code but no tests; no linked issue" is actionable. | Yes, as a quick lint before asking for review. | **Yes**, as is. |
| Pre-flight summary ($0.001) | No. It repeats the checks with internal ids. | No. | **Drop it**, or rewrite it as "fix this first" (fix 7). |

## Fixed in this PR

- **Credits copy** (`web/src/lib/format.ts`, `web/src/components/report/ai-start.tsx`).
  - Before: the AI tab said "13 free AI reports left" when 10 of the 13 were
    purchased (granted) credits.
  - Now it says "N AI reports left" whenever the balance includes purchased
    credits, and "N free AI reports left" otherwise.
  - Moved to `format.ts` with a test.

## Follow-up tickets

Nothing below was trivial enough for this PR. Engine changes touch the golden
set and the recorded replays. The holt-pro changes are in a separate repo.

1. **Outcomes quotes must come from the team** (engine, `stages.outsider_conversations` / `verify`).
   - Today any third party's comment counts as the project's response
     (react-native #58527; click #3720 "Retracted.", from a spam-like account).
   - Fix: for an outcome's quote, keep only replies from `people.maintainers()`.
     Show other replies as "another contributor said", or drop them.
   - Then update the AI tab's promise ("comes from someone other than the
     person who opened the pull request") to "from the project's team".
2. **Staff on bot-merged repos** (engine, `people.maintainers`).
   - pytorch (pytorchmergebot) and react-native (internal sync) have no human
     merge actor, so Meta staff read as outsiders and their PRs as ignored
     outsider work.
   - Fix: count as team the person who asked the merge bot to merge, and
     `APPROVED` reviewers on bot-landed PRs.
   - Check against pytorch's `huydhn`, `anijain2305`, `bobrenjc93` and
     `pdesupinski`.
3. **Narration prompt uses the legacy rule line.** `verdict.py:380`: the
   `legacy=` text says "first-time merges" and uses `outsider_threads` as the
   denominator.
   - Fix: send the user-facing rule text instead. Also send `hours_phrase()`
     values, not raw hours ("388.1 hours").
   - This re-records replays and the example report, and needs a golden diff.
4. **AI and bot review bodies quoted as maintainers** (engine, `automated_body`).
   - Treat "@claude …"/"@copilot …" mentions and AI review templates
     ("## Review summary 🔴 … blocker") as automated.
   - Pass thread age to Outcomes, so a PR under 14 days old isn't labelled
     "ignored" while the rules say 0 were ignored.
5. **holt-pro playbook: "why closed" is empty.** Kept 2 of 8 on click, 0 on uv
   and 0 on excalidraw.
   - Have the model return `{reason, pr, quote}` as fields, instead of prose
     with PR numbers and quotes inline. The checker then verifies the quote
     against that PR's comments, and never has to parse numbers out of the
     sentence.
   - Also fixes the dropped-fragment artifact
     (`Git/GitHub.".`) and the false "figure not counted (3792)" drops.
6. **holt-pro playbook: advice quality.**
   - Leave out third-party and meta checks (CodeRabbit, Vercel, `cancel`,
     `label-scope`) from "make these pass".
   - Only turn a practice into a checklist item when merged PRs do it clearly
     more often than closed ones: tests on click are 50% of merged vs 84% of
     closed, and changelog on excalidraw is 1 of 19.
   - Don't tell contributors to run CI-only commands (`cargo publish --dry-run`).
   - Collapse per-directory reviewer lines for the same person.
7. **holt-pro pre-flight summary.** Drop it, or rewrite it as one "fix this
   first" sentence. If kept, reject backticked check ids (the prose check
   ignores backticked spans today). Also, when `tests` is worth fixing but
   closed PRs had tests more often than merged ones, say that tests aren't
   the deciding factor here.
8. **holt-pro can't point at a non-OpenRouter endpoint.**
   `playbook/model.py` hardcodes the URL and sends OpenRouter-only fields
   (`max_tokens`, `reasoning`, `usage.include`).
   - This test went through a local translating proxy (scratchpad only, not
     committed), with the URL patched at runtime rather than in code.
   - Fix: add `HOLT_PRO_MODEL_URL` and a provider switch for
     `max_completion_tokens` / `reasoning_effort`.
   - The same applies to the server's `OPENROUTER_BASE_URL`: its client always
     sends `max_tokens` for provider `openrouter`, which OpenAI's API doesn't
     accept for gpt-5 models. That comes from reading the code; it wasn't
     tested directly.
9. **Labels in evidence lists.**
   - The CLI prints `repo kind: real_software`, `onboarding: boilerplate`.
   - The web cards read "Closed dismissive, with nothing said".
   - Map them to plain labels ("Closed with no explanation").
10. **The narration check removes the lead sentence.** On nixpkgs, one leaked
    field name cost the paragraph its main point.
    - Consider one retry of the narrate stage when the check removes a
      sentence from `bottom_line` or the first paragraph (about $0.002).
11. **Latency isn't logged per stage** in the engine (the CLI or the server's
    report). The numbers above came from the proxy.
    - Record `ms` per call in `Usage`, as holt-pro already does.

## How this was run

- **Key handling.** The key was read by name from `~/.config/holt/secrets.env`
  into the test processes' environment only. It was never printed or logged.
  The GitHub token came from `gh auth token`.
- **CLI.** `HOLT_CONFIG_DIR` was set to a scratch `models.toml`
  (`provider = "openai"`, `model = "gpt-5-mini"`) and
  `HOLT_RECORD_TRAJECTORIES=1`, then
  `uv run holt analyze <repo> --live --show-verification` was run for each
  repo. The honesty checks read the recorded trajectory and GitHub's REST API.
- **Local stack:**
  - Postgres: `server/compose.yml` under `$COMPOSE_PROJECT_NAME`.
  - `holt-server` on 20001.
  - `next dev` on 20000, with dev sign-in.
  - holt-pro (a clone of `main` at 89f90d5) on 20002.
  - A small proxy on 20005 translated OpenRouter-shaped requests to OpenAI.
    It kept the cost ledger and would refuse every call past $0.90.
- **Flows.** Playwright drove the web flows, using the server's cached
  Chromium.
