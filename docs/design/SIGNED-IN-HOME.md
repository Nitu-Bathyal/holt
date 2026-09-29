# The signed-in home

Status: **round 2, built** (28 Sep 2026). **Superseded** for navigation and `/me`
by [DASHBOARD.md](DASHBOARD.md) (29 Sep): the sidebar is five places now. Round 1 (PR #123) put `/me` in
place. The user's verdict: a pile of unrelated boxes, and the signed-in pages
bolted onto the nav at random. This redoes the navigation (two shells) and
`/me`. What sign-in does and the `/` redirect stay as they are.

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

## Navigation: two shells, one system

The user's direction (28 Sep): the signed-in options go in a **sidebar**, not
the nav bar, and the signed-out nav jumps around the landing page. Which
shell a page wears is one rule, `shellFor(pathname, signedIn)` in
`lib/shell.ts`:

- **Signed out:** every page wears the marketing shell.
- **Signed in:** the pages that explain or sell Holt (`/`, `/how-it-works`,
  `/pricing`, legal pages, `/badge`, `/signin`) keep the marketing shell.
  Everything else, reports included, wears the app shell.

**Marketing shell.** Top nav = the landing page's sections, as jump links
that glide on `/` (Lenis anchors) and go to `/#section` from anywhere else
`the answer` · `what it checks` ·
`the verdicts` · `open source` · `pricing`, then `try an example` and a
`sign in` button. Signed in: an `open Holt →` button to `/me` and the account menu instead.
The footer stays. Phones: the same links in the ☰ sheet.

**App shell.** A slim top bar (☰ below lg, logo → `/me`, a small repo box,
theme, account menu) and a left sidebar: a rail from lg up that folds to
icons (a cookie remembers it), and a drawer below lg holding the same list.
No footer: privacy, terms and GitHub sit at the sidebar's foot.

```
SIDEBAR                              ACCOUNT MENU (avatar)
⌂  Home               /me             Aahil Khan
▣  Check a repo       focuses a box   3 AI reports left
⌕  Find a project     /find           Home
☰  Browse repos       /discover       AI reports
▥  Compare repos      /compare        Settings
❦  Hacktoberfest      October only    Sign out
Yours
⑂  Your pull requests /me/contributions
▯  Saved repos        /me/saved
↺  Repos you checked  /me/history
⑂✓ Check your PR      /preflight (where pre-flight runs)
Account
⚙  Settings           /settings/profile
     Profile · AI reports · Accounts · Privacy   (while in settings)
?  How Holt works     /how-it-works
⇥  Sign out
─────
3 AI reports left · Privacy · Terms · GitHub ↗
«  Fold the sidebar
```

- **Settings** has no second side list any more. From lg up its sections
  are the sidebar's sub-items; below lg, tabs at the top of the page.
- **Check a repo** is an action, not a page. It focuses the nearest repo
  box on the page (/me's paste box, else the top bar's) and flashes it. With
  none in sight (phones) it goes to `/me#check`, which does the same.
- **browse repos** is `/discover` under a name that says what you do there.

**Retired or merged**

| Was | Now | Why |
|---|---|---|
| `/for-you` page | the **Picked for you** section on `/me`; `/for-you` → `/me#picks` (308) | Same list twice. The API returns ten at most, which fits on `/me` |
| Header nav for signed-in pages, a 9-item avatar menu | the sidebar; the menu keeps account items only | One home for every option |
| "about Holt" (`/?landing=1`) in the menu | gone from the menu; URL unchanged, the marketing nav's jump links use it | |
| `/me` rows: welcoming \<language\>, fastest replies, trending, Hacktoberfest | one "Rather browse?" line to the boards | They're `/discover` and `/hacktoberfest` |
| "Get set up" checklist | one dismissible nudge, only for what's missing | A list at 3 of 4 is a nag |
| "Your next step" card | gone; waiting PRs lead the PR section and the status line | It fought the paste box for the accent |

## `/me`

**One primary action per state. It's the only accent button on the page.**

| State | When | Primary action |
|---|---|---|
| **New** | nothing to come back to: no checks, no saved repos, no PRs | **Find a project**: the profile questions inline (one at a time) until answered or skipped, then `find a project →` |
| **Returning** | at least one check, saved repo or PR | **Check a repo**: the paste box, top of the page |

In the new state a small repo box sits one line down, with a quiet button
("Have a repo in mind?"). In the returning state the sidebar has Find a
project; the page doesn't repeat it.

Sections, in this order, each hidden when empty:

1. **Your pull requests** (connected only). Grouped by repo, waiting first
   (PR #130's `groupPulls`); PRs to your own repos left out. Link: `all your
   pull requests`. One card per repo; more than one PR shows as a stack and
   opens to list them.
2. **Saved**, up to 6. Link: `all saved`.
3. **Picked for you** (`#picks`), up to 10, with the one-line "Matched on …". Pro-locked picks as one line. Link: `edit your profile`.
4. **Recently checked**, up to 6. Link: `all checks`.
5. One line: "Rather browse? most welcoming · trending · by language" (to
   `/discover`), plus Hacktoberfest in October.

**One nudge at most**, one line, with ×: no profile → "Tell Holt your
languages to get picks." Else not connected → "Connect GitHub to see your
PRs here." Dismissing sets a cookie. Nothing else about setup.

**One visual system.** Defined once, used on every app-shell page:

| Piece | Where | What |
|---|---|---|
| Shell tokens | `globals.css` (`--topbar-h`, `--rail-w`, `--rail-w-folded`) | Bar height and rail widths |
| Sidebar item | `.side-item`, `.side-group-label`, `.side-subitem` | 44px row, icon + label; selected = 2px blue rule + ink, the settings-tab mark |
| Icons | `components/shell/icons.tsx` | 16px line icons, one stroke, `currentColor` |
| Page header | `AppPageHeader` (`components/shell/app-page.tsx`) | h1 at the `/discover` size, one lead line, no backdrop |
| Section heading | `SectionHead` + `.section-head` | h2 left, one quiet link right |
| Cards | `RepoGrid`/`RepoCard`, `PullCard` (same family), `CheckedList` | 3 columns on desktop, 1 on a phone |
| One accent | `.btn-primary` (green) | Only the page's primary action |

Used by `/me`, `/me/saved`, `/me/history`, `/me/contributions` and
`/settings/*`. `/find`, `/discover` and `/compare` keep their own heads
for now (other workers' files).

### Wireframes

`/me` sits in the app shell: the sidebar on the left from lg up, the drawer
below. Only the page is drawn here.

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
else goes to `/me`. `/` always shows the landing page, signed in or out (no redirect);
`/?landing=1` renders the same page. First-time and returning people
share one URL; the page tells them apart from what the account has, not
from a stored flag.

## Build notes

- Shell: `lib/shell.ts` (which shell, sidebar items, jump links, retired
  URLs) with `lib/shell.test.ts`; components in `components/shell/`; the
  root layout picks the shell from the live pathname (`ShellFrame`), since
  it stays mounted across client navigations.
- `/me` state rules (`homeKind`, `primaryAction`, `homeNudge`,
  `statusLine`) are pure functions in `lib/home.ts`, tested in
  `lib/home.test.ts`. Reused: PR #130's `groupPulls`/`outsidePulls` and
  `savedNames`-style save buttons on `RepoGrid`; #132's `ProfileFlow`.
- No server changes. Own-repo PRs are filtered by login on the web
  (`outsidePulls`) until the server PR lands.
