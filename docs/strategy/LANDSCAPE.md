# Is Holt new? The landscape

*Researched 29 Sep 2026, two days before the Hacktoberfest launch. Every claim about another product links to that product's own site, docs, code or paper, read that day. Anything we couldn't fetch is marked.*

> **Is Holt new? Partly.** The question isn't new. Two small command-line tools already ask "will this repo merge an outsider's PR?" and answer with a label: GitSense `radar` (since May 2026) and willitmerge (since Aug 2026, four days before Holt's first commit). What nobody else has is Holt's combination: it finds the team by what people do (merging, closing and formally reviewing others' PRs), counts outsiders only, lets written rules decide, links every claim to its PR, and works for any repo on the web.

---

## The short version

- **The idea has been shown to work, but two tiny tools got there first.** [willitmerge](https://github.com/muhzuhaib/willitmerge) (created 25 Aug 2026, [PyPI 26 Aug](https://pypi.org/project/willitmerge/), 0 stars) and [GitSense `radar`](https://github.com/he-yufeng/GitSense) (repo from Mar 2026, radar added May 2026, 91 stars) both read outsiders' PRs and print a go/no-go label. Holt's first commit was 29 Aug 2026. Neither tool has a web app, an extension or links to the evidence.
- **The big platforms measure health for people choosing dependencies.** [LFX Insights](https://insights.linuxfoundation.org/docs/metrics/health-score), [OpenSSF Scorecard](https://github.com/ossf/scorecard/blob/main/docs/checks.md), [Snyk's package health](https://security.snyk.io/package/npm/snyk) and [deps.dev](https://docs.deps.dev/faq/) all give scores. None of them asks what happens to an outsider's PR.
- **Some tools already find the team from what people do.** LFX Insights, [contributor.info](https://github.com/bdougie/contributor.info/blob/main/docs/implementations/contributor-classification-via-events.md) and [OSS Compass](https://compass.gitee.com/docs/metrics-models/people/productivity/contributor-role-persona/) all do it. But none of them then works out how outsiders' PRs fare. Holt uses the same idea for a different job.
- **Contributor discovery is lists.** goodfirstissue.dev, up-for-grabs, GitHub's `good first issue`, GSoC and the rest pick repos by labels, curation or promises. None of them measures whether outside PRs actually get replies or get merged. The one exception is [goodfirstissues.org](https://goodfirstissues.org/), which grades review speed with no visible team filter.
- **Research agrees and never shipped.** A decade of papers shows insiders' PRs are merged more often ([Tsay et al. 2014](https://herbsleb.org/web-pubs/pdfs/tsay-influence-2013.pdf), [Terrell et al. 2017](https://web.eecs.umich.edu/~weimerw/2018-481/readings/genderpull.pdf), [Zhang et al. 2023](https://yuyue.github.io/res/paper/PRDecision-TSE2022.pdf)). It also shows the newcomer merge rate in popular repos falling from 61.9% to 42.2% between 2021 and 2025 ([Hoshikawa et al. 2026](https://arxiv.org/abs/2604.27532)). We found no running public tool from any of this work.
- **OpenSauced, the closest earlier product, is gone.** It had any-repo pages and an extension, pitched to contributors, but its "Contributor Confidence" measured stargazers turning into contributors, not acceptance. It shut down in late 2024 ([archived announcement](https://web.archive.org/web/2025/https://opensauced.pizza/blog/opensauced-is-joining-the-linux-foundation), [app repo archived](https://github.com/open-sauced/app)).

---

## Comparison table

Columns:

- **Outsider outcomes?** Does it measure whether PRs from people outside the team get replies or get merged?
- **Finds the team by** How it decides who is on the team.
- **Answer** What it gives you:
  - **verdict**: a plain call you can act on.
  - **score**: a number or band.
  - **metrics**: charts and counts.
  - **list**: a set of repos or issues.

| Tool | For | Outsider outcomes? | Finds the team by | Answer | Coverage | Price | Alive |
|---|---|---|---|---|---|---|---|
| **Holt** | contributors | yes: replies, merges, where work lands | GitHub role **plus** merging, closing or formally reviewing others' PRs | verdict (3), each claim linked to a PR | any public repo, on demand (web, CLI, extension) | free (AI explanation metered) | yes |
| [willitmerge](https://github.com/muhzuhaib/willitmerge) | contributors | yes: merge rate, typical and slow merge times, PRs still waiting | GitHub role only ([code](https://github.com/muhzuhaib/willitmerge/blob/main/src/willitmerge/analyze.py)) | verdict: LIKELY / MIXED / UNLIKELY / TOO FEW | any repo, CLI | free, MIT | yes, 0 stars |
| [GitSense `radar`](https://github.com/he-yufeng/GitSense) | contributors | partly: outsiders' **share** of merged PRs | GitHub role only ([code](https://github.com/he-yufeng/GitSense/blob/main/gitsense/radar.py)) | 0–100 score → Go / Watch / Comment first / Avoid for now | any repo, CLI | free, MIT | yes, 91 stars |
| [contributor.info](https://github.com/bdougie/contributor.info) | maintainers | no: splits PR **volume** into external and internal; merge rate covers all PRs | who merges, pushes, closes others' issues ([doc](https://github.com/bdougie/contributor.info/blob/main/docs/implementations/contributor-classification-via-events.md)) | score + band (Intimidating … Welcoming) | any repo, sign-in | free; $19 / $99 plans ([repo doc](https://github.com/bdougie/contributor.info/blob/main/docs/pricing-structure.md)) | yes |
| [LFX Insights](https://insights.linuxfoundation.org/) | organisations picking dependencies | no: reply time and merge ratio cover all PRs | roster or observed review/merge actions ([doc](https://insights.linuxfoundation.org/docs/metrics/health-score)) | 0–100 score, Excellent … Critical | curated index, 13,000+ projects | free | yes, weekly releases ([changelog](https://changelog.lfx.dev/?product=insights)) |
| [OSS Compass](https://oss-compass.org/about) | program offices, researchers | no | "managerial behaviour" ([doc](https://compass.gitee.com/docs/metrics-models/people/productivity/contributor-role-persona/)) | weighted model scores | any submitted GitHub/Gitee repo | free | yes |
| [OpenSauced](https://github.com/open-sauced/docs) | contributors, maintainers | no: Contributor Confidence = stargazers who go on to contribute | "internal" split, method not documented | metrics | any repo (was) | free (was) | **no**, shut down late 2024 |
| [goodfirstissues.org](https://goodfirstissues.org/) | beginners | review speed, no visible team split | not visible | list + review-speed tier | own crawled index | free | yes, operator unknown |
| [IssueScout](https://github.com/turazashvili/issuescout.dev) | beginners | no: first issue comment from anyone, count of merged PRs | none | 0–100 score | search results | free | quiet since Mar 2026 |
| [issues.ecosyste.ms](https://issues.ecosyste.ms/) | researchers, anyone | no: shows PRs by author role, headline numbers cover everyone | GitHub role ([code](https://github.com/ecosyste-ms/issues/blob/main/app/models/issue.rb)) | metrics | any repo | free | yes |
| [OSS Insight](https://ossinsight.io/analyze/pallets/flask) | anyone | no: merge time and first reply over all PRs | none | metrics | any repo, but PR data since mid-2025 under-captured ([its own notice](https://ossinsight.io/)) | free | yes |
| [HyperCRX](https://github.com/hypertrons/hypertrons-crx) + [OpenDigger](https://open-digger.cn/en/docs/user_docs/metrics/metrics_usage_guide) | anyone on github.com | no | none | charts in the GitHub page | indexed repos only | free | yes, [833 users](https://chromewebstore.google.com/detail/hypercrx/ijchfbpdgeljmhnhokmekkecpbdkgabc) |
| [CHAOSS metrics](https://chaoss.community/kb/metric-change-request-acceptance-ratio/), GrimoireLab, [CollectOSS](https://github.com/chaoss/CollectOSS), [8Knot](https://github.com/oss-aspen/8Knot) | community managers | definitions only; fork-vs-branch is an optional split | self-hosted identity tools | metrics, "interpret in context" | self-hosted | free | yes (Augur [archived](https://github.com/chaoss/augur)) |
| [OpenSSF Scorecard](https://github.com/ossf/scorecard/blob/main/docs/checks.md) | security, dependency users | no ("Maintained" counts insiders' activity) | GitHub role | 0–10 per check | 1M projects weekly, any via CLI | free | yes |
| [Snyk package health](https://security.snyk.io/package/npm/snyk) | dependency users | no | none | 0–100 score | npm, PyPI, Go packages | free to view | moved to security.snyk.io ([Feb 2026](https://snyk.io/blog/snyk-advisor-security-database/)) |
| [deps.dev](https://docs.deps.dev/api/v3/) · [Libraries.io SourceRank](https://libraries.io/rubygems/rails/sourcerank) | dependency users | no | none | metrics / score | packages only | free | yes |
| [isitmaintained.com](https://isitmaintained.com/) | anyone | no: typical issue close time, % open | none | 2 numbers + badges | any repo | free | site up, code untouched since [2019](https://github.com/mnapoli/IsItMaintained) |
| [github/issue-metrics](https://github.com/github/issue-metrics) | maintainers | no: time to first response over everything | manual ignore list | report | repos you run it on | free | yes |
| GitHub: [`good first issue`](https://github.blog/open-source/maintainers/how-we-built-good-first-issues/), `/contribute`, [community profile](https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/about-community-profiles-for-public-repositories) | contributors | no: labels, an issue classifier, a file checklist | none | list / checklist | every public repo | free | yes |
| [goodfirstissue.dev](https://github.com/deepsourcelabs/good-first-issue), [up-for-grabs](https://github.com/up-for-grabs/up-for-grabs.net/blob/gh-pages/docs/list-a-project.md), [For Good First Issue](https://github.com/github/forgoodfirstissue), [verto](https://github.com/lucavallin/first-issue), [awesome-for-beginners](https://github.com/MunGell/awesome-for-beginners), [CodeTriage](https://github.com/codetriage/codetriage) | beginners | no: curation, labels, stars; up-for-grabs asks maintainers to *promise* reviews | none | list | curated | free | yes |
| [GSoC](https://google.github.io/gsocguides/mentor/org-application), [LFX Mentorship](https://docs.linuxfoundation.org/lfx/mentorship), [GSSoC](https://gssoc.girlscript.org/), [Outreachy](https://www.outreachy.org/docs/community/) | students | no: orgs vetted by application, mentors commit to respond | n/a | yearly list | ~150–200 orgs (GSoC) | free | yes |
| Bounty boards: [Algora](https://algora.io/algora/home), [Opire](https://opire.dev/) | contributors | only whether an org paid bounties | n/a | payout history | bountied issues | fee-based | yes. Dead or pivoted: [Bountysource](https://github.com/bountysource/core/issues/1586), [Gitcoin bounties](https://support.gitcoin.co/gitcoin-knowledge-base/misc/cgrants-bounties-and-hackathons-sunsetting-faq/whats-happening-to-the-hackathons-and-the-bounties-program), [IssueHunt](https://issuehunt.io/) |
| [DeepWiki](https://cognition.com/blog/deepwiki), [Code Wiki](https://developers.googleblog.com/en/introducing-code-wiki-accelerating-your-code-understanding/), [Gitingest](https://github.com/coderamp-labs/gitingest) | anyone reading code | no: explain the code | n/a | wiki / chat / digest | any repo | free | yes |

---

## The closest competitors

### 1. willitmerge: the same question, the same answer shape

- **What it is.** A dependency-free Python CLI. The tagline: "Before you spend a weekend on a pull request, check whether that repository has ever merged a stranger's." ([README](https://github.com/muhzuhaib/willitmerge))
- **What it measures.** Outsiders' PRs over the last 180 days (`--days` to change). It reports:
  - merged out of decided (merged or closed)
  - merge rate
  - typical and slowest-10% time to merge
  - outsider PRs still open, with the age of the oldest

  It drops bots. ([README](https://github.com/muhzuhaib/willitmerge))
- **The verdict.** Fixed rules:
  - **LIKELY**: at least 70% merged and a typical merge within 7 days.
  - **MIXED**: at least 40% merged.
  - **UNLIKELY**: anything lower.
  - **TOO FEW**: under five decided PRs.

  ([analyze.py](https://github.com/muhzuhaib/willitmerge/blob/main/src/willitmerge/analyze.py))
- **Who counts as an outsider.** Anyone GitHub marks as `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, `FIRST_TIMER` or `NONE` ([analyze.py](https://github.com/muhzuhaib/willitmerge/blob/main/src/willitmerge/analyze.py)). The README admits the role is read today, not when the PR was opened.
- **Coverage, price, life.** Any public repo, run locally with your token. Free, MIT. Created 25 Aug 2026, last push 29 Sep 2026, 0 stars (GitHub API).
- **Where it's ahead of Holt.** No install friction: stdlib only, one command, a table for several repos at once. Its README is a sharp, honest pitch. The "waiting" column puts the oldest unanswered outsider PR front and centre.
- **Where Holt is ahead.**
  - Holt finds the team from behaviour as well as role. Private org members who show up as `CONTRIBUTOR` are caught when they merge, close or formally review others' PRs. It isn't perfect: staff who merge only through a bot still slip through ([our review](../research/REVIEW-2026-09-30.md), "Staff who don't look like staff").
  - Holt counts replies, not just merges. It shows where outsider work lands, and links every claim to its PR.
  - Holt has a web app, the URL swap, an extension chip, a badge and starter issues.
- **Threat level.** Low today (no users), high as a signal: the idea is obvious enough that someone else built it the same week.

### 2. GitSense `radar`: an issue finder that grew a repo check

- **What it is.** An "AI-powered open source contribution finder and repo radar" CLI ([repo](https://github.com/he-yufeng/GitSense), [PyPI `gitsense-radar`](https://pypi.org/project/gitsense-radar/)). `radar` "answers the next question: is this repo actually worth your PR?" ([README](https://github.com/he-yufeng/GitSense)).
- **What it measures.** An additive 0–100 score made of:
  - recent merges
  - stale-PR backlog
  - open-to-merged pressure
  - typical merge time
  - maintainer response time (sampled from merged PRs)
  - "External merged share", the fraction of recent merged PRs whose author GitHub marks as an outsider (±10 points)

  The score maps to **Go** (75+), **Watch** (60+), **Comment first** (45+) or **Avoid for now**. `--explain` prints each factor. ([radar.py](https://github.com/he-yufeng/GitSense/blob/main/gitsense/radar.py))
- **Other commands.** `find` ranks issues against your skills with an LLM. `predict` estimates one PR's merge chance. `triage` gives a next action for each of your open PRs ([README](https://github.com/he-yufeng/GitSense)).
- **Coverage, price, life.** Any repo, CLI, your token plus an optional LLM key. Free, MIT. v0.5.0 on 11 Sep 2026, 91 stars.
- **Where it's ahead of Holt.**
  - It predicts a single PR's merge chance.
  - It triages your open PRs.
  - It matches issues to your skills.
  - It is older, and it has more stars than Holt (91 against [1](https://github.com/holt-oss/holt)).
- **Where Holt is ahead.**
  - Holt asks "do outsiders' PRs get merged?". GitSense asks "what share of merged PRs came from outsiders?", which is a different number. A repo that merges 5 of 500 outside PRs can still score well if the team merges little itself.
  - Holt has an explicit "not enough evidence" answer, not a low score.
  - Holt finds the team from behaviour, and links every claim to its PR.
  - GitSense is a CLI only.

### 3. contributor.info (OpenSauced's successor) and LFX Insights (its data home)

These two share the same caveat, so they're one entry.

- **contributor.info** is what OpenSauced's founder pointed users to when it shut down ([archived announcement](https://web.archive.org/web/2025/https://opensauced.pizza/blog/opensauced-is-joining-the-linux-foundation)).
  - It analyses any public repo.
  - It finds maintainers from "privileged events" such as who merges ([doc](https://github.com/bdougie/contributor.info/blob/main/docs/implementations/contributor-classification-via-events.md)).
  - It shows an external-versus-internal split of PRs ([component](https://github.com/bdougie/contributor.info/blob/main/src/components/features/contributor/self-selection-rate.tsx)).
  - Its Contributor Confidence band runs from "Intimidating" to "Welcoming", with merge rate as a 15% ingredient ([doc](https://github.com/bdougie/contributor.info/blob/main/mintlify-docs/features/contributor-confidence.mdx)).
  - It speaks to maintainers ("your repository"), and its repo lists $19 and $99 plans.
  - The merge rate and response time cover all PRs, not outsiders' ([health metrics code](https://github.com/bdougie/contributor.info/blob/main/src/lib/insights/health-metrics.ts)).
- **LFX Insights** is the most serious platform in the space: free, Linux Foundation-backed and shipping weekly.
  - It finds maintainers from "observed review/merge actions".
  - It scores the "median time for a non-author to respond to newly opened issues and pull requests" and a PR merge ratio ([health score](https://insights.linuxfoundation.org/docs/metrics/health-score)).
  - It is built for dependency choices: "developers and their organizations" ([what is Insights](https://insights.linuxfoundation.org/docs/introduction/what-is-insights)).
  - It covers a curated index of 13,000+ projects ([homepage](https://insights.linuxfoundation.org/), [FAQ](https://insights.linuxfoundation.org/docs/more/faq/index.html)).
  - None of its numbers are computed for outsiders' PRs only.
- **The honest read.** Both have Holt's hardest ingredient, finding the team by behaviour. Either could add an outsider-only view in a release. LFX has the data pipeline and the brand to do it at scale.

---

## What Holt does that we found nowhere else

Only claims we could check against every tool above.

1. **It finds the team by behaviour, then counts outsiders only.**
   - LFX, contributor.info and OSS Compass find maintainers by behaviour, but never compute what happens to outsiders' PRs (see their rows above).
   - willitmerge and GitSense compute outsider numbers, but trust GitHub's role label alone ([willitmerge code](https://github.com/muhzuhaib/willitmerge/blob/main/src/willitmerge/analyze.py), [GitSense code](https://github.com/he-yufeng/GitSense/blob/main/gitsense/radar.py)).
   - Holt does both (`src/holt/agent/people.py`).
2. **Every claim links to the PR behind it.** No other tool in the table cites individual threads. willitmerge and GitSense print numbers. The platforms print charts.
3. **A verdict you can open on the web for any repo, from a github.com link.** willitmerge and GitSense are CLI only. LFX has a web app but only for its index. contributor.info is on the web but gives a maintainer-facing band, not a verdict.
4. **Starter issues only from repos that merge outsiders.** Every other issue list picks by label, stars, curation or a maintainer's promise. goodfirstissues.org grades review speed across all PRs; we couldn't see its backend, so we can't rule out a team filter.
5. **Where outsider work lands.** Holt shows which folders outsiders' merged PRs touch. We found this in no other tool.
6. **A model that explains but can't decide, checked claim by claim.** GitSense uses an LLM to rank issues, not to judge repos. Nobody else pairs a rules verdict with a model explanation whose claims are checked against the record.

**Not unique, so don't claim it:**

- **Rules-based verdict.** willitmerge's is rules too.
- **"Not enough evidence."** willitmerge has `TOO FEW`. contributor.info has "Gray (Insufficient Data)" ([doc](https://github.com/bdougie/contributor.info/blob/main/mintlify-docs/features/repository-health.mdx)).
- **The URL swap.** DeepWiki ("replace github.com with deepwiki.com", [blog](https://cognition.com/blog/deepwiki)) and Gitingest ("replace 'hub' with 'ingest'", [site](https://gitingest.com)) did it first. It's still a great hook. It isn't an invention.
- **A README badge.** isitmaintained, contributor.info and GFI-Bot all have one.
- **A browser extension on github.com.** HyperCRX (833 users) and Refined GitHub ([100,000+ users](https://chromewebstore.google.com/detail/refined-github/hlepfoohegkhhmjieoechaddaejaokhf)) are there. Neither shows a contribution verdict.

## Where others are ahead of Holt

- **Reach and trust.** LFX Insights carries the Linux Foundation name. It is free, has an API, and pulls data from "20+ different sources" ([FAQ](https://insights.linuxfoundation.org/docs/more/faq/index.html)). Holt has 1 GitHub star.
- **Breadth of health signal.** Security, bus factor, releases and lifecycle state (LFX), and Scorecard's supply-chain checks. Holt deliberately ignores these, but a contributor picking a long-term home might want them.
- **Single-PR prediction and PR triage.** GitSense `predict` and `triage` help after you've opened a PR. Holt's "your PRs" lists them but doesn't score them.
- **Zero-install simplicity.** willitmerge compares several repos in one line with no dependencies. Holt's `compare` exists, but the install is heavier.
- **Scale of issue discovery.** GitHub's own good-first-issue classifier runs on every public repo ([GitHub blog](https://github.blog/open-source/maintainers/how-we-built-good-first-issues/)). The curated lists have years of maintainer opt-in, [awesome-for-beginners](https://github.com/MunGell/awesome-for-beginners) alone has 89.7k stars.
- **Mentorship.** GSoC, Outreachy and LFX Mentorship come with a human committed to reviewing your work ([Outreachy](https://www.outreachy.org/docs/community/)). Holt can only point at the record.

## Things to watch

- **Hacktoberfest 2026 no longer counts PRs.** "Pull requests and merge requests will no longer count toward Hacktoberfest rewards." MLH and DEV run it this year, focused on open-source AI ([FAQ](https://hacktoberfest.com/questions/), [mission](https://hacktoberfest.com/mission/)). The site's /hacktoberfest page already says so. Launch posts should too, and shouldn't promise help "hitting your PR count".
- **GitHub now lets repos cap open PRs from people without write access** ([GitHub blog, 18 Jun 2026](https://github.blog/open-source/maintainers/how-pull-request-limits-are-cutting-down-the-noise/)). A repo with a tight cap is a real signal for outsiders, and Holt doesn't read it yet.
- **AI-generated PRs are bending contributor metrics** ([Nesbitt, May 2026](https://nesbitt.io/2026/05/27/chaoss-metrics-in-2026.html)). Maintainers now have tools to triage strangers, such as [SlopScore](https://github.com/hanzili/slopscore). Outsiders' merge rates may fall further, which makes Holt's answer more useful and its thresholds worth re-checking.

---

## Positioning lines

For the site and launch posts, following [VOICE.md](../design/VOICE.md). Each line is backed by the section above. None says "only" or "first", because willitmerge and GitSense exist.

1. **Health scores are for picking a dependency. Holt is for picking where your PR goes.**
2. **Holt skips the team's own PRs. It counts people like you.**
3. **Every claim links to the pull request behind it.**
4. **Starter issues, only from repos that merge outsiders.**
5. **Any public repo. Swap hub for holt.**

### When someone asks…

| They say | Answer with |
|---|---|
| "LFX Insights already scores project health." | It does, for about 13,000 projects, and it's built for choosing dependencies. Holt answers for any repo and counts only people outside the team. |
| "willitmerge / GitSense does this." | Same question, good tools. Holt also finds maintainers who don't hold a GitHub role, links every claim to a PR, and runs in the browser. |
| "GitHub has good first issues." | It shows the issue. It doesn't show whether outside PRs on that repo get merged. |
| "Isn't this just merge rate?" | Merge rate over everyone mostly counts the team merging its own work. Holt removes the team first. |

---

## Method and sources

- **Skills used:**
  - `mattpocock-skills:research`: primary sources only, captured as markdown.
  - `marketing-skills:competitor-profiling`: the same fields for every tool, and honest strengths.
  - `pm-go-to-market:competitive-battlecard`: "where we win / where they win" and the objection table.
- **What we skipped from those skills.** The SEO and review-site steps: no DataForSEO or G2 data exists for tools this small.
- **How the research ran.** Three research passes covered analytics platforms, contributor tools, and research papers with extensions and AI tools. Web search and fetch were used on 29 Sep 2026, and GitHub API reads gave stars, push dates and created dates.
- **What we checked ourselves.** The three closest tools were re-checked by reading their source:
  - willitmerge `analyze.py`
  - GitSense `radar.py`
  - contributor.info's classification doc and components
- **What we couldn't fetch:**
  - opensauced.pizza (TLS failure; the Wayback copy was used)
  - contributor.info's live pricing page (a JS app; prices come from its repo)
  - Bitergia's site
  - Algora's workflow doc (404)
  - the backends of goodfirstissues.org and IssueScout's live service
- **Research papers cited above.** Also [Gousios et al. ICSE 2014](https://gousios.org/pub/exploration-pullreqs.pdf): merged PRs saw little speed difference between insiders and outsiders. And [Dey & Mockus 2020](https://arxiv.org/abs/2003.01153): acceptance is predictable, and they planned a tool that we couldn't find.
