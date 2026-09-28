# The signed-in home

Status: **proposal, round 2** (28 Sep 2026). Round 1 (PR #123) put `/me`
in place. The user's verdict: a pile of unrelated boxes, and the signed-in
pages bolted onto the nav at random. This note redoes the layout and the
navigation. What sign-in does and the `/` redirect stay as they are (end of
page).

Skills used: `frontend-design:frontend-design` (lead),
`marketing-skills:site-architecture`, `marketing-skills:onboarding`,
`marketing-skills:cro`, `pm-product-strategy:value-proposition`.

## What exists today

| Page | What it's for | Reached from today |
|---|---|---|
| `/me` | Home: next-step card, paste box, setup list, 8 rows, credits | logo, menu "home", sign-in |
| `/find` | Answer a few questions, get repos with issues to start on | header, footer, next step |
| `/discover` | Ranked lists everyone sees: most welcoming, trending, biggest | header ("discover"), footer |
| `/compare` | Two to four repos side by side | header |
| `/for-you` | Your picks from profile + GitHub, full list | menu "picked for you", `/me` row |
| `/me/saved` | Repos you saved for later | menu, save button |
| `/me/history` | Every repo you checked, AI reports included | menu "your history", `/me` row |
| `/me/contributions` | Your PRs to other people's repos, with the verdict on each | menu "your contributions", `/me` row |
| `/settings` | Titled "Your AI reports": credits, plan, purchases, then profile and GitHub at the bottom | menu |
| `/connect` | Connect GitHub (a one-time flow) | setup list, settings |
| `/preflight` | Check your PR against what the repo merges | report page only |
| `/hacktoberfest` | Seasonal: projects that merge outsiders, by language | a pill on `/`, profile card |
| `/how-it-works`, `/pricing` | Explain Holt, sell AI reports | header, footer |
| `/badge` | For maintainers | footer |
| `/?landing=1` | The landing page, for a signed-in person | menu "about Holt" |

Problems: the header mixes tools (find, discover, compare) with brochure
pages (how it works, pricing) and an outbound link. The menu has nine items
with no grouping, three of which are the same list at two sizes (picks, history
and PRs are each a `/me` row *and* a page). `/me` has two accent buttons, a
setup list that stays at 3 of 4, and five rows of other people's repos that
`/discover` already does better.

## Who opens Holt signed in, and why

**What `/me` is for:** *your open-source to-do list, with Holt's verdict on
each item.* What you're watching (PRs, saved, checked) and what to try next.
Everything about other people's repos in general lives on `/find` and
`/discover`.

| Who | Comes to | Should see first | Noise today |
|---|---|---|---|
| **Day-one student**, no PRs yet | "Where do I start?" | One way in: tell Holt what you know, get repos picked for you | Paste box (they have no repo), five browse rows, setup list |
| **Returning, PRs in flight** | "Is my PR going anywhere? What next?" | Their PRs, waiting ones first; then saved and picks | Setup list, "Welcome back" hero, trending |
| **Experienced, one repo in mind** | "Check this repo, now" | The paste box, focused, at the top | Everything above the paste box |

## Navigation

Header = **tools that work on any repo**. Avatar menu = **your stuff, then
account**. Brochure pages sit in the header only while signed out.

```
SIGNED OUT
(=^•ω•^=) holt   find a project  browse repos  compare  how it works  pricing   ☼ [gh] [ sign in ]
SIGNED IN
(=^•ω•^=) holt   find a project  browse repos  compare                          ☼ [gh] (A)▾
```

- **browse repos** replaces "discover" (the word says what you do there; the
  URL stays `/discover`).
- **github** becomes a small GitHub mark beside the theme toggle, labelled
  "Holt on GitHub". It's not a place in the product.
- **hacktoberfest** joins the header in both states, from 1 to 31 October
  only (the existing `hacktoberfest()` date check).
- The logo goes to `/me` when signed in, as now.
- Phone: the ☰ sheet holds the same header links; the avatar menu is the
  same on every size.

```
AVATAR MENU (signed in)
┌──────────────────────────────┐
│ Aahil Khan                   │
│ 3 AI reports left            │  ← was a footnote on /me
├──────────────────────────────┤
│ home                         │
│ your pull requests           │  /me/contributions
│ saved repos                  │  /me/saved
│ repos you've checked         │  /me/history
├──────────────────────────────┤
│ settings                     │  profile, GitHub, AI reports
│ pricing                      │
│ how it works                 │
├──────────────────────────────┤
│ sign out                     │
└──────────────────────────────┘
```

Everything is one click from the header or menu. The menu's "3 AI reports
left" needs `me()` in the header; if that's too slow per page, it drops to
the `/me` status line instead.

**Retired or merged**

| Was | Now | Why |
|---|---|---|
| `/for-you` page, menu "picked for you" | the **Picked for you** section on `/me`; `/for-you` → `/me#picks` (308) | Same list twice. The API returns ten at most, which fits on `/me` |
| Menu "about Holt" (`/?landing=1`) | footer link; URL unchanged | A pitch page for someone who already signed up is not "your stuff" |
| Menu "privacy" | footer only (already there) | |
| `/me` rows: welcoming \<language\>, fastest replies, trending, Hacktoberfest | gone from `/me`; one line at the bottom links the boards | They're `/discover` and `/hacktoberfest` |
| "Get set up" checklist | one dismissible nudge, only for what's missing | A list at 3 of 4 is a nag. Empty sections do the teaching |
| "Your next step" card | gone; its only real case (a waiting PR) leads the PR section | It fought the paste box for the accent |

## `/me`

**One primary action per state. It's the only accent button on the page.**

| State | When | Primary action |
|---|---|---|
| **New** | nothing to come back to: no checks, no saved repos, no PRs | **Find a project**: the profile questions inline (one at a time) until answered or skipped, then `find a project →` |
| **Returning** | at least one check, saved repo or PR | **Check a repo**: the paste box, top of the page |

In the new state the paste box is still there, one line down, with a quiet
button ("Have a repo in mind?"). In the returning state `find a project` is a
quiet link in the Picks section.

Sections, in this order, each hidden when empty:

1. **Your pull requests** (connected only). Grouped by repo, waiting first
   (PR #130's `groupPulls`); PRs to your own repos left out. Link: `all your
   pull requests`, plus a quiet `check a PR before you open it` (`/preflight`).
2. **Saved**, up to 6. Link: `all saved`.
3. **Picked for you**, up to 10, with the one-line "based on your languages
   and merged PRs". Pro-locked picks as one line. Link: `edit your profile`.
4. **Recently checked**, up to 6. Link: `all checks`.
5. One line: "Rather browse? most welcoming · trending · by language" (to
   `/discover`), plus Hacktoberfest in October.

**One nudge at most**, one line, with ×: no profile → "Tell Holt your
languages to get picks." Else not connected → "Connect GitHub to see your
PRs here." Dismissing sets a cookie. Nothing else about setup.

**One visual system**, borrowed from `/find` and `/discover`:
- h1 at the `/discover` title size, not the display size: "Welcome back,
  Aahil" / "Welcome, Aahil". No backdrop.
- Every repo is the compact `RepoCard` in a `RepoGrid` (3 columns on
  desktop, 1 on a phone; no sideways scrolling), with the save button.
  PR groups use the same card, stacked, and expand to list each PR.
- One section heading style: h2 left, one quiet link right. Same gap
  between every section.
- `check a repo` anywhere (menu, empty states) goes to `/me#check`, which
  focuses the paste box and flashes its outline once.

### Wireframes

```
RETURNING, desktop                              NEW, desktop
┌──────────────────────────────────────────┐    ┌──────────────────────────────────────────┐
│ Welcome back, Aahil                      │    │ Welcome, Priya                           │
│ 1 PR waiting · 3 AI reports left         │    │ ┌──────────────────────────────────────┐ │
│ ┌──────────────────────────────────────┐ │    │ │ Find a project worth your time       │ │
│ │ $ owner/name or a GitHub URL [CHECK] │ │    │ │ Which languages do you write?        │ │
│ └──────────────────────────────────────┘ │    │ │ (python)(js)(go)(rust)(+)    skip    │ │
│ ─ Connect GitHub to see your PRs.  [×]   │    │ │ ●○○○                        [NEXT]   │ │
│                                          │    │ └──────────────────────────────────────┘ │
│ Your pull requests        all your PRs   │    │ Have a repo in mind?                     │
│ ┌──────────┐┌──────────┐┌──────────┐     │    │ ┌──────────────────────────────┐[check] │
│ │o/r  2 PRs││o/r  1 PR ││o/r 4 PRs │     │    │ └──────────────────────────────┘        │
│ │1 waiting ││merged    ││3 merged  │     │    │                                          │
│ └──────────┘└──────────┘└──────────┘     │    │ Rather browse? most welcoming · trending │
│ Saved                         all saved  │    └──────────────────────────────────────────┘
│ [card] [card] [card]                     │
│ Picked for you        edit your profile  │    NEW, phone          RETURNING, phone
│ [card] [card] [card]                     │    ┌─────────────────┐ ┌─────────────────┐
│ Recently checked             all checks  │    │ Welcome, Priya  │ │ Welcome back,   │
│ [card] [card] [card]                     │    │┌───────────────┐│ │ Aahil           │
│ Rather browse? most welcoming · trending │    ││Find a project ││ │ 1 PR waiting    │
└──────────────────────────────────────────┘    ││Languages?     ││ │┌───────────────┐│
                                                ││(py)(js)(go)(+)││ ││$ owner/name   ││
                                                ││skip    [NEXT] ││ ││      [CHECK]  ││
                                                │└───────────────┘│ │└───────────────┘│
                                                │Have a repo?     │ │Your PRs    all →│
                                                │[paste   ][check]│ │[card]           │
                                                │Rather browse? … │ │[card]           │
                                                └─────────────────┘ │Saved       all →│
                                                                    │[card] …         │
                                                                    └─────────────────┘
```

(`[CAPS]` = the one accent button. `[lower]` = quiet.)

## Where sign-in lands (unchanged)

`afterSignIn(callbackUrl)`: a safe callback other than `/` wins, anything
else goes to `/me`. A signed-in `/` redirects to `/me` (307, `proxy.ts`);
`/?landing=1` still shows the landing page. First-time and returning people
share one URL; the page tells them apart from what the account has, not
from a stored flag.

## Build notes

- Reuse, don't rewrite: PR #130's `savedNames()`, the save button on
  `RepoGrid` and `groupPulls`/`outsidePulls` in `lib/home.ts`; the settings
  PR's one-question-at-a-time profile flow if it's a standalone component by
  then (else the current `ProfileOnboarding`), and its section anchors.
- State rules (`homeState`, primary action, which nudge) are pure functions
  in `lib/home.ts` with tests. The `/for-you` redirect is tested too.
- No server changes. Own-repo PRs are filtered by login on the web until the
  server PR lands.
