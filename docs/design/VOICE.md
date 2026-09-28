# Holt's voice

*28 Sep 2026. Applies to every page on githolt.com. Report wording from the engine (`src/holt/`) follows its own rules; don't rewrite it from the web.*

**The one line:** find out if a repo merges outsiders' PRs before you write one.
Every page is some version of that sentence. If a line doesn't help it, cut the line.

## Who we're talking to
A student about to make their first pull request, up to someone who has made fifty and wants to pick the next project well. Assume they know what GitHub is. Don't assume they know what "triage", "CODEOWNERS" or a "median" is.

## How Holt sounds
- **Direct.** Say the thing. The first sentence is the answer.
- **A bit dry, a bit playful.** One small joke a section, at most. Never at the reader's expense.
- **Confident.** No "may", "can help", "aims to". If Holt does it, say it does it. If it doesn't, don't say it.
- **On the contributor's side, never snarky about maintainers.** Silent repos are usually busy people, not bad ones. We say "outside PRs go unanswered", not "maintainers ignore you".
- **Short.** Most sentences under 15 words. Most paragraphs one or two sentences. The UI already shows a lot; don't narrate it.

## The cat `(=^•ω•^=)`
The cat is a face, not a character. It reacts (happy, sad, thinking) next to verdicts and in empty states. It doesn't talk, have a name beyond Holt, or get a backstory. Use it where a reaction helps; leave it out of explanations.

## Do / don't (real lines from this site)

| Don't | Do |
|---|---|
| Holt returns a clear verdict, the numbers behind it, the folders where outside work actually gets merged, and open issues you could pick up today. | The answer, with receipts. *(The figure below shows the rest.)* |
| Stars and issue counts describe how popular a project is. Holt looks at the path you will actually take: … | Stars won't tell you who gets merged. |
| Use it, inspect it, improve it. | Open source. We merge outsiders too. |
| Useful enough to guide you. Open enough to question. | Don't take our word for it. |
| Holt started as a benchmarked competition entry; that evaluation is now historical research, not a live product claim. | That 55/55 is from Holt's competition days. Treat it as history, not a promise. |
| Paste a GitHub repository, like pallets/flask or https://github.com/pallets/flask | That doesn't look like a repo. Try pallets/flask or a github.com link. |
| Pick where to spend your evenings by what gets merged, not by stars. | Spend your evenings where outside work gets merged. |

## Habits to break
- **Explaining the UI.** If the screen shows it, the copy doesn't repeat it.
- **Saying it twice.** Headline and body shouldn't make the same point in different words.
- **Lists of three.** "Use it, inspect it, improve it." Pick the one that matters.
- **"Not X, but Y."** Just say Y.
- **Em-dash asides and semicolons.** Use a full stop.
- **Hedges and fillers:** actually, really, just, simply, very, "in order to".
- **Pre-announcing.** "Here's how it works:" Just show how it works.

## Buttons and links
- Say what happens: `check this repo`, `[ find a project → ]`, `[ sign in for 3 free AI reports → ]`. Not "learn more" or "get started".
- One loud action per section (the outlined `[ … → ]` link). Anything else in the section is a quiet text link.
- A short question in front earns the click: "No repo yet?", "Rather browse a ranked list?"
- Every page ends on something to do. No dead ends.

## Words
| Use | Avoid |
|---|---|
| repo, PR, pull request | repository (in headings), contribution artefact |
| outsiders, outside PRs, people outside the team | external contributors, non-members, `CONTRIBUTOR` |
| gets merged, gets a reply | acceptance rate, responsiveness |
| Worth your time / Not worth your time / Not enough evidence (exactly these) | viable, `not_viable`, score, rating |
| the rules, written rules | algorithm, heuristics, our AI |
| check, look, find out | leverage, seamless, effortless, powerful, unlock, empower, robust, supercharge |
| typical (for a median) | median, mean, p-value, MCC |

## Fixed points
- The brand is **Holt**. The hook is **swap hub for holt**. Don't reword either.
- The verdict comes from written rules. A model may explain it and never picks it. Copy must never suggest otherwise.
- Holt only reads. Never imply it posts, comments, opens PRs or contacts anyone.
- Plain English for beginners. No internal names, no stats jargon (research detail lives in `docs/research/EVALUATION.md`).
- Don't promise what the product doesn't do. When unsure, check the code, then write less.
