# The signed-in app

Status: **approved, rolling out** (29 Sep 2026). The user approved the prototype
(#156, `/lab/dashboard`, never merged) and asked for the rollout below. This
replaces the `/me` and navigation parts of [SIGNED-IN-HOME.md](SIGNED-IN-HOME.md).
The report page isn't covered here: its redesign is #144. Only the shell around it is.

Skills used: `mattpocock-skills:research` (the product study below),
`frontend-design:frontend-design` (lead, the prototype), `marketing-skills:onboarding`
(new vs returning, time to value), `marketing-skills:site-architecture` (the IA),
`pm-product-strategy:value-proposition` (what home is for), `mattpocock-skills:prototype`.

## What home is for

**Your next move in open source, and why.** Someone who gives their evenings to
open source opens Holt to learn one thing: *what do I do now?* Which of my PRs needs
me, and where should the next one go? Holt answers from what gets merged, not from
what's popular. GitHub's home can't do that. goodfirstissue.dev and CodeTriage don't
know you.

## What's wrong today (audit, 29 Sep, local mock, three people)

Walked as a **day-one student** (no PRs), a **returning contributor** (connected,
4 PRs, 1 waiting, 2 saved) and an **experienced dev** (one repo to check).

Ranked:

1. **Home doesn't answer "what now?"** `/me` is an index: four lists (PRs, saved,
   picks, checked) stacked by *type*, each a preview of another page, all at the same
   weight. Nothing is ranked across them. The eye lands on the green button, then
   scans identical boxes.
2. **Your PRs answer the wrong question.** A PR card leads with the *repo's* verdict
   ("Worth your time"), which the person settled when they opened the PR. What they
   want: is it going anywhere? Two days' wait where replies usually come in 15 hours
   is news. A merge from 3 months ago is not. Today both get the same box.
3. **The same thing lives in two to four places.** Picks: `/me`, a card on
   `/me/contributions`, and `/find` (a personalised search). The profile prompt: a
   `/me` nudge, "What are you after?" on `/find` and `/hacktoberfest`, and settings.
   AI reports left: the `/me` status line, the sidebar foot, the account menu and
   settings. Check a repo: a sidebar item, the `/me` box and the top-bar box (which
   `/me` hides). Sign out: sidebar and account menu. One repo can show as a PR card
   and a saved card on the same screen.
4. **Too many doors with near-synonym names.** Twelve sidebar items in three groups:
   *Your pull requests* vs *Check your PR*, *Find a project* vs *Browse repos*,
   *Saved repos* vs *Repos you checked*. *How Holt works* is filed under Account.
5. **The new/returning split is too coarse.** One check makes you "returning": a
   student who checked one repo from the landing loses the find path and gets a paste
   box. The nudge "Tell Holt your languages" sits above picks already "Matched on
   Python and Rust".
6. **It doesn't look like Holt.** The landing is big mono type, warm light, the marker
   and the cat. The app is a small grey admin: every section is the same h2 plus a
   grid of the same boxed card with the same shadow. Page widths change between pages
   (`/me` wide, PRs narrow and centred, `/find` with its own tinted head), so content
   jumps sideways.
7. **Over-explaining, against VOICE.md.** Footnotes on PRs and saved ("Found via
   Holt marks…", "Press saved on a card to remove it…"), a lead line on every page
   restating its title, and "Rather browse?" as the last thing on home.

| View | What's wrong |
|---|---|
| Sidebar + top bar | 12 items, synonyms, credits and sign-out twice, "Check a repo" is an action pretending to be a place, all-mono labels at one weight |
| `/me` | An index of other pages. Two "hello" lines (welcome + status). Nudge contradicts picks. Ends on "Rather browse?" |
| `/me/contributions` | Stats tiles first, then a picks card, then the list. Merged, closed and waiting in one flat list with the repo verdict as the loudest thing. A paragraph of footnote. Narrow centred column |
| `/me/saved`, `/me/history` | The same repo list twice: repos with a verdict, one sorted by save, one by check. Different card shapes (grid vs rows). "Not checked recently" block explains itself |
| `/find` | Good page, wrong frame: its own tinted head, a third profile prompt under the results, the default search spinner is the first thing a new user sees |
| `/discover` | A second "find a repo" with a different head and a lead that explains the ranking |
| `/hacktoberfest` | A third one, with its own profile prompt and share buttons above the list |
| `/compare` | Fine on its own. Reached only from the sidebar, not from your repos |
| `/settings/*` | Name as a sub-heading under "Settings", each section a new pattern. `/connect` is a separate legal-looking page with bullets |
| `/settings/ai-reports` | Plan and credits: fine, but it's the fourth place credits show |
| `/preflight` | Looks like the landing inside the app. Belongs to a waiting PR, not the sidebar |

## What similar tools do (principles, not visuals)

Primary sources, read 29 Sep. Full notes stay out of the repo; the links are below.

| Product | Home is for | New user | What to take / avoid |
|---|---|---|---|
| GitLab personal homepage | "Items that need your attention" first, then activity, then recents [GL1] | Tutorial | Take: attention before news. To-dos clear themselves when you act [GL4] |
| GitHub PR dashboard, notifications | PRs grouped by what you must do: needs review, needs fixes, ready [GH10]. Each notification says *why* [GH9] | — | Take: group by next move. Avoid: GitHub forced a new home as default, reverted in a month, re-offered it opt-in [GH3–5] |
| Linear | My Issues in a fixed focus order [LN1] | Auto-subscribed | Avoid: Inbox, My Issues and Pulse are three places to reconcile [LN2, LN3] |
| Vercel | What's live now. Removed the activity stream "to help you get to what matters faster" [VC2] | Import a repo, it deploys [VC1] | Take: current state, not a feed. First run is one real action |
| Duolingo | One path, so there's no choice about what's next [DL1] | Start the first lesson | Take: the smallest unit counts as progress; a one-lesson streak lifted retention [DL3] |
| Exercism | Your tracks, "continue" | Join a track and start immediately [EX1] | Take: first run is doing, not a form |
| OpenSauced | Split across profile tabs, Explore, Insights, Workspaces [OS1, OS2] | Sent to a settings form | Avoid both. Take: merged PRs as something to be proud of [OS3] |
| goodfirstissue.dev, up-for-grabs, CodeTriage | A list of issues [GFI1, UFG1, CT1] | Nothing to set up | Take: zero setup. Avoid: no reason given for why a repo is listed |
| LinkedIn Jobs, Netflix, Spotify | Picks with the reason on the item: "How you match", "Because you watched" [LI2, NF1, SP1] | Preferences | Take: every pick carries its reason; preferences re-rank at once [LI1] |
| YouTube | Ranking by popularity ("one big Trending page") failed; now by what viewers valued [YT1] | — | Take: rank by outcome (does it merge outsiders?), never stars |

**Principles for Holt:**

1. **What needs you comes before what's new.** Your PRs, then picks, then boards.
2. **Group your own work by the next move**, not by type: *needs you*, *waiting on
   them*, *done*.
3. **Things leave "needs you" on their own** once handled. Nothing to clear by hand.
4. **Every pick says why**, on the item, in plain words.
5. **First run is one real action**: pick languages and repos appear, right there.
   The profile is a lever, not a gate.
6. **One home, not several places to reconcile.** One list per kind of thing, one
   page per job.
7. **Current state, not a feed.** Flag only what changed since your last visit.
8. **The check box is always one keystroke away.** People who come to check a repo
   never lose it.

## The structure

```
TOP BAR     holt   [$ check a repo: owner/name]  (press /)          (avatar ▾)
                                                                     AI reports: 3 left
SIDEBAR     ⌂ Home               /me                                 Settings
            ⌕ Find a project     /find · /discover · /hacktoberfest  How Holt works
            ⑂ Your pull requests /me/contributions                   Sign out
            ▯ Your repos         /me/repos  (saved + checked)
            ▥ Compare            /compare
            ─────
            Privacy · Terms · GitHub ↗        « fold
```

Five places, down from twelve. The check box is in the top bar on every app page,
`/me` included, and `/` focuses it. Credits, settings, help and sign-out live in the
account menu only.

| Page | Its one job | Changes |
|---|---|---|
| **Home** `/me` | Your next move | Rebuilt (below) |
| **Find a project** | Pick your next repo | `/find` (for you), `/discover` (most welcoming, trending, by language) and `/hacktoberfest` (October) become **tabs of one section**. The URLs stay (they're public and indexed). One profile prompt: language chips on the *for you* tab |
| **Your pull requests** | Is each PR going anywhere? | Grouped: *needs you*, *waiting* (with a wait bar: days waited vs this repo's typical first reply), *merged*, *closed*. The repo verdict becomes a small line. No picks card, no footnote. Pre-flight is an action on each waiting PR |
| **Your repos** `/me/repos` | Repos you saved or checked, with today's verdict | Merges `/me/saved` and `/me/history` (308 to `?show=saved` / `?show=checked`). Pick 2–4 to compare |
| **Compare** | Side by side | Same page, new frame; also reached from Your repos |
| **Settings** | Profile, AI reports, accounts, privacy | Tabs at the top at every size. Connecting GitHub happens inline in Accounts (same consent), `/connect` redirects there |
| **Pre-flight** `/preflight` | Check a PR before review | Out of the sidebar; opened from a waiting PR |

### Home

The headline is the next move, as one sentence, with the cat reacting to it. Under
it, **the loop**, computed from the account, not a checklist to tick:
`find a repo → pick an issue → open a PR → get it merged`, with where you are lit.

| State | When | Headline (example) | The one primary action |
|---|---|---|---|
| **First repo** | No PRs, nothing saved that's worth your time | Let's find your first repo. | Pick languages → three picks appear at once, each with its reason and a starter issue |
| **Pick an issue** | A saved repo worth your time, no PR yet | Next: pick an issue in pallets/click. | That repo's starter issues |
| **Waiting** | An open PR | Your PR to home-assistant/core has waited 2 days. They usually reply within a day. | Check it with pre-flight, or open it on GitHub |
| **Merged** | A PR merged since your last visit | NixOS/nixpkgs merged your PR. | Your next one: an issue in the same repo, or a pick |

Then, each hidden when empty: **Needs you** (at most three rows, each with its reason
and one action), **In flight** (open PRs with wait bars), **Next repos for you**
(three picks with reasons, language chips re-rank them in place), **Your repos**
(five latest, link to all). No status line, no nudges list, no "Rather browse?".

**Experienced dev:** the top-bar box, focused with `/`, is the fastest path on every
page. Home's headline is one line, so it never stands in the way.

## One visual system for every signed-in page

Derived from the landing (EXPRESSIVE.md), at working size:

- **Page head:** one sentence that answers the page, in the landing's mono display
  (`clamp(1.9rem, 3.6vw, 3rem)`), left-aligned, the cat on the right reacting to the
  state. The marker highlight is home-only. No lead line unless it adds a fact.
- **One frame:** every page shares the same left edge and max width (72rem). No
  centred narrow columns, no tinted heads.
- **Two card families.** *Rows* for your things (PRs, your repos): a state rule on
  the left, the fact, one action on the right. *Cards* for discovery (picks, boards):
  verdict, odds bar, the reason, one starter issue. Your own work is never a grid of boxes.
- **Section head:** h2 plus a faint count, one quiet link on the right. No eyebrows.
- **Colour means something:** green is the page's one primary action. Verdict
  colours only on verdicts. PR states: *needs you* orange, *waiting* blue, *merged*
  green, *closed* muted.
- **Empty states:** the cat, one sentence, one action. **Loading:** skeletons in
  the row or card shape.
- **Motion:** one moment per page. Home: the headline lands word by word and the
  loop fills to your step. PRs: wait bars draw once. Hovers stay quiet: a card
  lifts 2px and lights its border, a row tints. No wobble. Reduced motion shows
  the finished state.

## The prototype

`/lab/dashboard` (#156, not on main) draws the proposed shell over whatever the page wears, on
made-up data. The bar at the bottom switches views: home in its four states
(new, pick an issue, PR waiting, just merged), your PRs, find a project, your
repos, and a reduced-motion preview. Things to try: pick languages on *home: new*,
then save a pick (the loop moves on); press `/` anywhere; remove the saved repo
that turned "not worth your time"; tick two repos in *your repos*. Compare,
settings and pre-flight aren't drawn: they keep their pages and take the new frame.

## Rollout (page-sized PRs, each on staging first)

1. **Shell:** five-item sidebar, the check box in the top bar on every page with `/`,
   account menu holds credits, settings, help and sign-out; settings tabs at
   every size; the shared page frame and page head. (`lib/shell.ts`,
   `components/shell/*`) Hacktoberfest keeps a sidebar item in October until 5.
2. **Your repos:** `/me/repos` merges saved and checked; 308s from the old URLs.
3. **Home:** the loop, needs you, in flight, picks with inline chips, your repos.
   Rules stay pure in `lib/home.ts`. "Since your last visit" is a cookie.
4. **Server, then PRs page:** each PR's repo carries its typical first reply,
   and a per-repo "don't count this" choice (a friend's project, your team's
   repo, a hackathon; engine 4's personal projects are left out by default)
   (#160, `API.md` in the same PR). Then `/me/contributions` grouped by next
   move, with pre-flight per PR, the toggle, and a collapsed "not counted"
   group. It leaves a slot for the contribution-history view another worker is
   exploring. Later: "a maintainer replied" (needs new GitHub fields).
5. **Find a project:** tabs over `/find`, `/discover`, `/hacktoberfest`; one profile prompt.
6. **Compare, settings, AI reports, pre-flight:** the new frame; `/connect` into Accounts.
7. **States and motion pass:** empty, loading, the home moment, wait bars.

Before 1 Oct only item 1 is small enough to land; the rest follows through October.

## Sources

[GL1] docs.gitlab.com/tutorials/personal_homepage · [GL4] docs.gitlab.com/user/todos ·
[GH3] github.blog/changelog/2025-08-28-improvements-to-the-home-dashboard-available-in-public-preview ·
[GH4] github.blog/changelog/2025-09-24-recent-changes-to-the-home-dashboard-disabled ·
[GH5] github.blog/changelog/2025-10-28-home-dashboard-update-in-public-preview ·
[GH9] docs.github.com/en/subscriptions-and-notifications/concepts/about-notifications ·
[GH10] github.blog/changelog/2026-07-09-new-pull-requests-dashboard-is-now-generally-available ·
[LN1] linear.app/docs/my-issues · [LN2] linear.app/docs/inbox · [LN3] linear.app/docs/pulse ·
[VC1] vercel.com/blog/dashboard-redesign · [VC2] vercel.com/changelog/a-new-dashboard-overview-is-now-available ·
[DL1] blog.duolingo.com/new-duolingo-home-screen-design · [DL3] blog.duolingo.com/improving-the-streak ·
[EX1] exercism.org/docs/using/getting-started ·
[OS1–3] github.com/open-sauced/docs (contributors guide, students guide, highlights) ·
[GFI1] goodfirstissue.dev · [UFG1] up-for-grabs.net · [CT1] codetriage.com ·
[LI1] linkedin.com/help/linkedin/answer/a512279 ·
[LI2] linkedin.com/blog/member/career/introducing-how-you-match-on-linkedin-jobs ·
[NF1] netflixtechblog.com/learning-a-personalized-homepage-aa8ec670359a (search excerpt; the page returned 403) ·
[SP1] engineering.atspotify.com/2020/01/for-your-ears-only-personalizing-spotify-home-with-machine-learning ·
[YT1] blog.youtube/inside-youtube/on-youtubes-recommendation-system
