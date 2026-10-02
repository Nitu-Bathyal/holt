# Every Holt email on made-up data: the owner's text

What `account_mail.samples()` must give, block for block: each sample's
subject, preview line and text part. `test_server_account_mail.py` reads it.

## 1. Welcome  (`welcome`)

**Subject:** Welcome to Holt

**Preview line:** Before you spend your weekend on a repo, see how it treats newcomers.

**Body:**

```text
Welcome to Holt.

Found a repo you like? Before you spend a weekend on a PR, it helps to know how the repo treats newcomers.

Holt checks a repo's recent PRs so you can get a better idea of what you're walking into. Whether newcomers actually get replies and whether their work gets merged.

A couple of places to start:

Check any repo: replace `github.com` with `githolt.com` in its address.
https://githolt.com

Find projects that welcome first-time contributors, filtered by language.
https://githolt.com/find

Or just pick a repo and see what Holt finds.

Go get merged. The cat's rooting for you.

--
Stop these emails: https://githolt.com/alerts/unsubscribe?t=sample
```

## 2. Pass confirmation  (`receipt`)

**Subject:** You're on Holt Pro

**Preview line:** Your Pro pass is live. Here's what you get through 31 October.

**Body:**

```text
You're on Pro.

Your pass is live through 31 October.

Here's what you've got:

30 merge plans a month. Get your first PR in a repo broken down into numbered steps, based on what actually gets merged there and who reviews it.

PR alerts. We'll let you know when a maintainer replies to one of your PRs.

Make a merge plan: https://githolt.com

₹99 · 1 month pass · paid 1 Oct · one-time, no auto-renewal
Payment ID pay_Q7hXw2LmN4vT9c (keep it for refunds)
Refund policy: https://githolt.com/refunds
```

## 3. Alerts ending, a pass on sale  (`trial_ending`)

**Subject:** Your free PR alerts end on 3 October

**Preview line:** Your alerts are ending. Your Holt account isn't.

**Body:**

```text
Your free PR alerts end on 3 October.

You've had 14 days of alerts. After that, Holt will stop watching your open PRs for maintainer replies.

Everything else is still yours. Reports, Find, and your pull requests page stay free.

See your pull requests: https://githolt.com/me/contributions

If you want to keep the alerts running, Holt Pro has you covered:
https://githolt.com/pricing

--
Stop these emails: https://githolt.com/alerts/unsubscribe?t=sample
```

## 4. Alerts ending, no pass on sale  (`trial_ending`)

**Subject:** Your free PR alerts end on 3 October

**Preview line:** Your alerts are ending. Your Holt account isn't.

**Body:**

```text
Your free PR alerts end on 3 October.

You've had 14 days of alerts. After that, Holt will stop watching your open PRs for maintainer replies.

No worries. Reports, Find, and your pull requests page are still free.

See your pull requests: https://githolt.com/me/contributions

--
Stop these emails: https://githolt.com/alerts/unsubscribe?t=sample
```

## 5. Alerts ended, a pass on sale  (`trial_ended`)

**Subject:** Your free PR alerts have ended

**Preview line:** Your alerts are gone, but the rest of Holt is still free.

**Body:**

```text
Your 14 days of PR alerts are up.

As of 3 October, Holt has stopped watching your open PRs for maintainer replies.

The rest of Holt is still free: Reports, Find, and your pull requests page.

See your pull requests: https://githolt.com/me/contributions

Want the alerts back? Get them with Holt Pro:
https://githolt.com/pricing

--
Stop these emails: https://githolt.com/alerts/unsubscribe?t=sample
```

## 6. Alerts ended, no pass on sale  (`trial_ended`)

**Subject:** Your free PR alerts have ended

**Preview line:** Your alerts are gone, but the rest of Holt is still free.

**Body:**

```text
Your 14 days of PR alerts are up.

As of 3 October, Holt has stopped watching your open PRs for maintainer replies.

The rest is still free. Reports, Find, and your pull requests page.

See your pull requests: https://githolt.com/me/contributions

--
Stop these emails: https://githolt.com/alerts/unsubscribe?t=sample
```

## 7. Pass ending, a pass on sale  (`pass_ending`)

**Subject:** Your Holt Pro pass ends on 4 October

**Preview line:** Your pass is ending soon. No renewal, no surprise charge.

**Body:**

```text
Your Pro pass ends on 4 October.

Nothing will renew and you won't be charged again. It was a one-time pass.

Your merge plans and PR alerts will end with the pass. Reports, Find, and your pull requests page will keep working as usual.

If you want another pass:
https://githolt.com/pricing

--
Stop these emails: https://githolt.com/alerts/unsubscribe?t=sample
```

## 8. Pass ending, no pass on sale  (`pass_ending`)

**Subject:** Your Holt Pro pass ends on 4 October

**Preview line:** Your pass is ending soon. No renewal, no surprise charge.

**Body:**

```text
Your Pro pass ends on 4 October.

No renewal, no surprise charge. It was a one-time pass.

Your merge plans and PR alerts will end with it. Reports, Find, and your pull requests page will keep working.

Open Holt: https://githolt.com/me

--
Stop these emails: https://githolt.com/alerts/unsubscribe?t=sample
```

## 9. PR watch: your turn  (`alert_now`)

**Subject:** @davidism asked for changes on click #2811

**Preview line:** Your turn. Fix shell completion for nested groups

**Body:**

```text
@davidism asked for changes on your PR.

Looks like it's your turn:
pallets/click #2811 · Fix shell completion for nested groups

Open the PR: https://github.com/pallets/click/pull/2811
Holt's report: https://githolt.com/pallets/click

All your pull requests: https://githolt.com/me/contributions

--
Alerts until 14 Oct. Your turn right away, the rest at 8:00.
Settings: https://githolt.com/settings/alerts
Stop these emails: https://githolt.com/alerts/unsubscribe?t=sample
```

## 10. PR watch: your turn, two pull requests  (`alert_now`)

**Subject:** 2 of your PRs need a look

**Preview line:** Two maintainers replied. One asked for changes, and one left a reply.

**Body:**

```text
Two maintainers replied to your pull requests.

First up, @davidism asked for changes:
pallets/click #2811 · Fix shell completion for nested groups
Open the PR: https://github.com/pallets/click/pull/2811
Holt's report: https://githolt.com/pallets/click

And @charliermarsh replied here:
astral-sh/ruff #14022 · Add a rule for unused loop variables
Open the PR: https://github.com/astral-sh/ruff/pull/14022
Holt's report: https://githolt.com/astral-sh/ruff

All your pull requests: https://githolt.com/me/contributions

--
Alerts until 14 Oct. Your turn right away, the rest at 8:00.
Settings: https://githolt.com/settings/alerts
Stop these emails: https://githolt.com/alerts/unsubscribe?t=sample
```

## 11. PR watch: daily  (`alert_daily`)

**Subject:** Here's what happened on your PRs today

**Preview line:** 4 updates: one waiting, one getting close to stale, one approved, and one closed.

**Body:**

```text
Here's where your pull requests stand, Thursday 1 October.

p5.js #7120 is on day 6 with no reply yet. Most PRs here get one within 4 days.
processing/p5.js #7120 · Add describe() to the textToPoints reference
Open the PR: https://github.com/processing/p5.js/pull/7120
Holt's report: https://githolt.com/processing/p5.js

free-programming-books #11020 has been quiet for 25 days. The bot closes PRs here after 30.
EbookFoundation/free-programming-books #11020 · Add Rust books in Hindi
Open the PR: https://github.com/EbookFoundation/free-programming-books/pull/11020
Holt's report: https://githolt.com/EbookFoundation/free-programming-books

efcore #3310 was approved by @jrios.
dotnet/efcore #3310 · Translate DateOnly.DayNumber on SQLite
Open the PR: https://github.com/dotnet/efcore/pull/3310
Holt's report: https://githolt.com/dotnet/efcore

moment #6120 was closed without merging.
moment/moment #6120 · Add an Odia locale
Open the PR: https://github.com/moment/moment/pull/6120
Holt's report: https://githolt.com/moment/moment

All your pull requests: https://githolt.com/me/contributions

--
Alerts until 14 Oct. Your turn right away, the rest at 8:00.
Settings: https://githolt.com/settings/alerts
Stop these emails: https://githolt.com/alerts/unsubscribe?t=sample
```
