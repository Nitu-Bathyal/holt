# Changelog

All notable changes to Holt are documented here. Holt follows semantic
versioning once releases are published.

## 0.2.0 — unreleased

The release that makes `pip install holt-cli` useful on its own, for
Hacktoberfest, and gives the command line the same engine as
[githolt.com](https://githolt.com).

This is also the last feature release of the command line and the terminal
interface. They stay free, work with your own AI key (or none), and keep
getting engine updates and fixes. New features go to the web app.

### More honest verdicts

The rules that decide **Worth your time / Not worth your time / Not enough
evidence** were reworked. Some repositories get a different answer than in
0.1.0; each change was checked by hand against the pull requests behind it.

- **Outsiders are people outside the team.** An outside contributor is anyone
  who isn't a maintainer, judged by their role on GitHub and by what the
  history shows them doing (merging or closing other people's pull requests,
  approving others' work). Before, a maintainer's first pull request in the
  sample counted as a newcomer's. The report also says how many attempts came
  from people new to the repository, and how many of those were merged. (#87)
- **Merges outside the merge button count.** Projects that land work through
  a merge bot, a mailing list, Gerrit or an internal sync (Go, PyTorch,
  React Native, OpenSSL, Git and others) used to look as if they merged
  nothing. Holt now recognises those landings and says how they happened.
  Mirrors and forks where nothing lands say where contributions really go. (#86)
- **Only maintainers' replies count as replies.** A comment from the author,
  a bot (CLA checkers, coverage bots) or a passer-by no longer makes a pull
  request look answered. (#85)
- **Registries and lists are recognised.** When most outside pull requests
  add one entry to a data file or a list (domain registries, package
  manifests, awesome-lists), the answer is Not worth your time, with the
  reason spelled out: merged entries there are not software contributions.
  (#89)
- **A settled sample.** Rates count only pull requests opened at least 14
  days before the reading, so work still waiting for its first review isn't
  counted against the project. On busy repositories Holt reads further back
  to find enough of them. Drafts and pull requests labelled spam or invalid
  are left out, and pull requests closed without a word are counted apart
  from ones that were answered. (#97, #104)
- **A 5% floor.** Worth your time needs at least 5 in 100 outside pull
  requests merged. A project with no merge and no push in 90 days is Not worth
  your time. (#104)
- **Slow replies are a note, not a verdict.** A project that merges work from
  several outside people is Worth your time even when replies are slow; the
  report adds a line such as "Replies are slow here: typically 9.5 days, beyond
  your 7-day budget." (#104)
- **Renamed repositories work.** Asking about an old name (for example
  `facebook/react-native`) reads the repository under its current name. (#87)

### Report wording

- The report says "outside contributors" rather than "newcomers", gets
  singular and plural right ("Only 1 pull request"), gives the dates of the
  sample it counted, and adds a plain line when work landed outside the merge
  button. (#85, #87, #97, #104)
- With an AI model set up, the written explanation reads only outside
  contributors' threads, quotes only what someone other than the author said,
  and drops any sentence with a figure it cannot back up. (#88)
- `holt models --help` names an example model for each provider. (#49)

### Added

- `holt start`: open starter issues in repositories that actually merge
  newcomers' work, found by language, topic or `--hacktoberfest`, or listed for
  one repository. Each issue says why it was picked. (#5)
- `holt token` saves a GitHub token readable only by you. Holt also finds a
  token in `GITHUB_TOKEN` or through `gh auth token`. (#8)
- `--json` output for `holt analyze` and `holt compare`. (#8)
- OpenRouter as a named model provider. (#8)
- Terminal interface: a first-run prompt for the GitHub token, `?` for help on
  any screen, and `o` to open evidence on GitHub. (#8)
- Typed GitHub errors (not found, rate limited, bad token, GitHub down) that
  callers can act on. (#7)

### Changed

- Without an AI model set up, every command gives the free rules-only report
  instead of failing. The terminal interface uses the provider chosen with
  `holt models`. (#8)
- Commands read GitHub live when there is no committed evidence for the
  repository, which is always the case for a PyPI install. (#8)
- User data lives in the platform's data and config directories
  (`~/.local/share/holt`, `~/.config/holt`, and the macOS and Windows
  equivalents), never in the current directory. (#8)
- Errors are one plain-English sentence with the command that fixes it, and
  never a traceback. Reports link every piece of evidence to its pull request,
  render as formatted text on a terminal, and use "Worth your time" instead of
  internal names. (#8)
- The rules that decide a verdict are explained in plain English. (#7)
- The README presents the web app, the command line and the browser
  extension as equals. Research and reproduction guides moved under
  `docs/research/`, the usage and release guides under `docs/`, with
  `docs/README.md` as the index.
- A model call records a trajectory only when `HOLT_RECORD_TRAJECTORIES=1`. (#7)

### Fixed

- Pull requests opened in the last 48 hours no longer count as ignored on live
  runs. (#7)
- GitHub timeouts, server errors and short rate limits are retried with
  backoff instead of failing the run. (#7)
- Repository text shown to a model is fenced as data, so a README cannot give
  it instructions. (#7)
- Pasted GitHub URLs (with `/tree/...`, `.git`, `?tab=...`) are understood, and
  anything that is not a GitHub repository gets a sentence saying what to type
  instead. (#7)
- `holt start` skips issues someone has already claimed, issues more than a
  year old, batches filed from a template or a script, and brand-new tiny
  repositories. (#71)
- `holt --version` prints the installed version, or `holt dev` when run from
  a source tree. It no longer asks an unrelated package called `holt`. (#50)

### Removed

- The hidden `holt analyze --baseline` flag. It ran the benchmark's
  one-prompt comparison method, which is research material rather than
  something a contributor needs. It now lives in `eval/` and runs from a clone
  with `python -m eval.baseline <repo>`; the package no longer ships it.

### Licence

- The engine, the command line and the terminal interface (everything in the
  `holt-cli` package) stay under the Apache License 2.0. The web app and its
  server, which are not part of this package, are now AGPL-3.0. (#67)

## 0.1.0 — 2026-09-13

### Added

- Evidence-backed assessments for GitHub repositories.
- Deterministic verdicts over verified findings.
- Live GitHub analysis and model-free analysis.
- Repository comparison, contributor profiles, candidate discovery, and
  follow-up issue ranking.
- Interactive terminal interface with inspectable evidence.
- Configurable OpenAI, Anthropic, Gemini, Ollama, and OpenAI-compatible model
  providers.
- Replayable evaluation fixtures and a temporal-holdout benchmark.
- Apache-2.0 licensing, contributor documentation, issue templates, security
  policy, and project governance.
- Distribution on PyPI as `holt-cli`, installable with
  `uv tool install holt-cli`, with the terminal interface included in the
  default install.
