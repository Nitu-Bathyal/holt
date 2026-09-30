# 1. The server reads GitHub as a GitHub App owned by holt-oss

Date: 2026-09-30. Status: accepted.

## Context

The server reads arbitrary public repositories: pull requests with their
reviews, comments and timelines, a few files, and searches. Until now it
did this with the owner's personal tokens (`GITHUB_TOKENS`). All of those
tokens share one account's budget, which the owner's own `gh` and CLI use
also draws on. Abuse detection or a leaked token would land on that
personal account. Before the public launch, the server has to read GitHub
as an identity that belongs to the `holt-oss` organisation, not to a person.

The two candidates:

- **(a)** a GitHub App owned by `holt-oss`, installed on `holt-oss`, reading
  with installation access tokens;
- **(b)** a dedicated machine user (such as `holt-bot`) with fine-grained
  personal access tokens.

The evidence, quoted from GitHub's docs, is in
[research/github-app-vs-machine-user.md](../research/github-app-vs-machine-user.md).

## What a report costs

A report that isn't cached reads 8 pages of 25 pull requests, the
repository's facts and its docs. That comes to **10 GraphQL points**. A busy
repository needs up to 8 more pages. Measured over the 304 reports of the
30 September production re-run
([REVIEW-2026-09-30.md](../research/REVIEW-2026-09-30.md), section 5), the
average was **12 points** and the most was 18. Checking that a repository
exists before a report is queued costs 1 more point.

## What each option gets

| | (a) GitHub App installation | (b) Machine user |
|---|---|---|
| GraphQL budget | 5,000 points/hour. It grows by 50 for each repository past 20 and each org member past 20, up to 12,500. The Enterprise Cloud tier (10,000) needs a paid org. | 5,000 points/hour for the account |
| Uncached reports per hour (13 points each) | about **380**, up to 960 at the cap | about **380** |
| Search, secondary limits | the same for both: REST search 30/min, 2,000 GraphQL points/min, 100 requests at once | the same |
| Credential | 1-hour tokens made from a private key; the key never leaves the server | long-lived tokens that work from anywhere until revoked or expired |
| Whose account | the organisation's; nobody signs in as it | a user account that a person must set up and is responsible for; one free machine account per person |
| Reads public repositories it isn't installed on | every REST endpoint Holt uses says installation tokens work "without … permissions if only public resources are requested". The docs never say it in so many words for GraphQL. | documented: fine-grained tokens "include read access to public repositories" |

Neither option has more budget than the other at `holt-oss`'s size. They
are equal on rate limits. The App wins on everything else:

- its tokens expire in an hour;
- the key stays on the server;
- no human account sits behind it;
- it needs no seat or password;
- its limit grows with the organisation instead of staying at 5,000.

## Decision

**(a) The GitHub App.** The server swaps an RS256 JWT for an installation
token and renews it 10 minutes before it expires
(`server/holt_server/github_app.py`). When the App isn't set up, it falls
back to `GITHUB_TOKENS`. Staging uses the same App as production. It runs
one job at a time, so its share of the budget is small.

The docs leave one question open: can an installation token read public
repositories outside the org through GraphQL? The verify command
(`python -m holt_server.github_app`, in [ops/github-app.md](../ops/github-app.md))
answers it before production switches over. It reads `pallets/flask` the
way a report does, and a user by id. If that fails, unset the three
variables: the server is back on `GITHUB_TOKENS`, and (b) is next.

## What we won't do

We won't pool identities to raise the limit: several apps, several
installations, several machine users, or other people's tokens.
GitHub's API terms say "You may not share API tokens to exceed GitHub's
rate limitations", and the Acceptable Use Policies forbid putting an
"undue burden" on GitHub's servers. `GITHUB_TOKENS` still accepts a list,
so a fallback token can be replaced without downtime. The list is not
for stacking accounts.

If Holt outgrows 5,000 points an hour, there are two legitimate ways up:

- the budget growing with the organisation, as above;
- asking GitHub for a higher limit, which the docs say it can grant per app.

## Consequences

- The owner creates the App and installs it once
  ([ops/github-app.md](../ops/github-app.md)). Nothing changes until the
  three variables are set.
- Production and staging share one budget of 5,000 points an hour. The warm
  pass's floor (`HOLT_WARM_MIN_POINTS`, 1,500) and the pool's `LOW_POINTS`
  skip keep background work from spending it all.
- Logs name the identity ("the GitHub App", "token #2"), never a token.
- The CLI and TUI are unchanged: they read with the user's own token.
