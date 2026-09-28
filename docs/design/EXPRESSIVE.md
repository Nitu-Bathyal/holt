# Expressive Holt

*28 Sep 2026. The direction behind "make the whole site more expressive… the content is too static". Prototyped in #142 (`/lab/expressive`, never merged); the user approved it on 29 Sep with the changes under "Decisions". Nothing here changes a verdict, a number or the engine.*

Skills used: `frontend-design:frontend-design` (lead), `mattpocock-skills:prototype` (the /lab route), `marketing-skills:cro` (motion never hides or delays the primary action).

## What the reference taught (principles, not assets)
We studied getbags.app frame by frame (scroll, hover, reduced motion). What makes it feel alive:
- **The product shows itself.** A simulated exchange plays when you reach it, instead of a paragraph describing it.
- **Type is the picture.** Headlines sized to the screen, with big scale contrast against small labels.
- **Scroll is a timeline.** Things fill, light up or advance as you read, tied to scroll position.
- **Never quite still.** One or two small ambient loops (a turning mark, a drifting band).
- **A closing moment.** The last call to action is set as a big type moment before a real footer.
- **Reduced motion gets the finished state**, not a broken one: their demo prints the whole log at once.

We took none of their layout, copy, colours, outline type, all-caps headlines or code.

## Where Holt is static today
- **Landing:** since #135 every pane is one screen tall, but its content kept its old size (headline capped at 3.15rem, a 148px rail, an 860px column). It floats small in a big, empty screen. Eight sections share one template (rail, h2, paragraph, list), so there's no rhythm or scale contrast. Motion is fade-ups, the desktop cat and the OPEN/SOURCE band.
- **Report page:** a cached report is static text. The answer never "arrives". The stats are plain tiles.
- **/find, /discover, saved:** a grid of cards whose only response to the pointer is a border colour.
- **Loading:** a progress bar and a pulsing dot. It says "working" but doesn't show what Holt is doing.
- **Footer:** two columns of small links, no call to action, no personality. The page ends in a dead end.

## Principles for Holt
1. **Show the work.** Holt reads PR threads and applies written rules. Motion should act that out: logs printing, counts landing, receipts highlighted. That's our reason to move, not decoration.
2. **The cat reacts, it doesn't perform.** It answers what's happening (typing, a verdict, a hover), per VOICE.md: a face, not a character.
3. **Size to the screen.** Headlines use `min(vw, svh)` with rem floors, so a pane is full at 1440×900 and still fits at 1280×720. Phones keep readable floors.
4. **One moment per screen.** Each pane gets at most one orchestrated motion, and the rest stays quiet.
5. **Content first.** The server HTML is the finished state. Text is never hidden while waiting for an animation. Anything that "plays" is only wound back when it starts below the fold.
6. **Cheap.** Transform and opacity only. No new dependency. CSS and IntersectionObserver first. GSAP stays desktop-only (MOTION.md). Loops pause off screen. Scroll-linked effects use CSS view timelines where supported and play once elsewhere.
7. **Reduced motion is a design, not an off switch.** Every pattern has a static version that reads well (the lab bar toggles it).

## Decisions (29 Sep, from the user)
- **Keep what already works on the landing:** the cat companion (`motion/cat-companion.tsx`: it walks to the side, changes mood per section and looks at the pointer), the scroll reveals, and the OPEN / SOURCE band that moves with scroll. New patterns join that GSAP/Lenis setup; they don't replace it. Text should turn up as you scroll, never sit static. Each landing PR lists every existing animation as kept, changed or removed, and nothing is removed without an OK.
- **Replay (3) has two modes**, "on the web" (default: the web progress, then the report landing) and "in your terminal" (the real `holt analyze` output).
- **The "three answers" pane gets a new design**, not a restyle. Each verdict has to read instantly: what it means for you and what to do next.
- **Footer (7):** the sign-off is a terminal line, `$ git commit --to-the-right-repo`, with a blinking cursor. It has no "Holt only reads public GitHub data…" line.
- **Hero:** the headline, paste box and badges respond to the pointer a few px, eased (a gentle parallax). Nothing on touch, and nothing under reduced motion.
- **One cat on the landing.** At the end of the page the scroll companion glides into the footer cat's spot (top right of the footer, on every page) and becomes it. Scrolling back up, it lifts out again. Reduced motion: no travel; the companion stays with the hero and the footer cat sits on the right. Phones have no companion, as before.
- **Landing section 08** (the closing paste box) is removed: the footer's form closes the landing.

## The patterns
✓ = in the prototype. Cost: **P** = performance, **A** = accessibility.

| # | Pattern | Where | Why it helps | Cost |
|---|---|---|---|---|
| 1 ✓ | **Panes at full scale.** Headline `clamp(2.3rem, min(8.6–11vw, 12svh), 9.5rem)`, spacing in svh, a wider measure (to 1680px), no side rail. The sub-line sits beside the headline from 1280px. | Every landing pane, /how-it-works | The answer to "what is this" fills the first screen. The paste box stays above the fold at every size tested (1024×768 to 2560×1440, phones). | P: none (CSS). A: rem floors, no overflow, no horizontal scroll. |
| 2 ✓ | **hub flips to holt.** Split-flap letters, looping only while on screen. Tap to flip. | Landing hero line, URL-trick section, 404 | Teaches the hook in one glance instead of a sentence. | P: 4 small transforms. A: the label reads the whole swap. Reduced: before and after, side by side. |
| 3 ✓ | **Watch Holt check a repo.** A terminal replays a real recorded check (the example report's numbers): command, steps, counts, verdict stamp. The cat thinks, then reacts. | Landing section 02 | Shows *how* Holt decides in about 4 seconds, which builds trust before anyone pastes. | P: timers, 1 rAF per counted line. A: the full log is in an sr-only line. Reduced: the finished log. |
| 4 ✓ | **The answer lands.** The verdict bar draws, the headline stamps down (desktop only, never fades), the cat reacts, numbers count up and meters fill. | Report page, **only for a report that just finished**. Cached reports stay still. | The moment of payoff feels like one. | P: CSS plus one rAF per tile, 700ms. A: counters carry the final value as a label. Phones: the LCP headline never moves. |
| 5 ✓ | **Cards that answer the pointer.** The odds bar fills in legend order as the card scrolls in. Hover or focus: the bar thickens, the short numbers crossfade to the full count per colour, the cat shows the verdict mood, and a light follows the pointer. | /find, /discover, signed-in home, saved | The detail is on demand, in the same space, so there's no layout shift and no extra click. | P: transform-only light layer. A: works on focus as well as hover. The bar keeps its text label. |
| 6 ✓ | **Read the receipts as you scroll.** A highlighter (in the verdict's colour) runs under the deciding words of each PR thread. It's tied to scroll where supported. | Landing section 05, report evidence list | The point ("both say closed, only one is good news") lands without a paragraph. | P: CSS view timeline, no JS per frame. A: the text is always legible. Reduced: already highlighted. |
| 7 ✓ | **A footer that signs off.** `$ git commit --to-the-right-repo` waves once and its cursor blinks. One cat follows the pointer, reads along as you type, cheers at a valid repo, puzzles at a bad one and softens over the open-source links. The last CTA is a `githolt.com/` address bar (the URL trick as a form) plus find a project. A "recently checked" strip of real reports drifts past. Links in three groups: product, open source, legal. | Every page | No page ends in a dead end. The friendliest spot on the site carries the last action. | P: one CSS loop (paused on hover and off-motion), data from `GET /v1/reports` cached 5 min. A: form errors use role=alert. Ticker copies are aria-hidden. |
| 8 | **Progress as a log.** The live analysis screen prints each stage as a line, in pattern 3's style, with the cat thinking. | Report loading (`analysis-progress.tsx`) | Waiting feels like watching the work, and the stages mean something. | P: none new. A: aria-live on the current line only. |
| 9 | **The cat follows state site-wide.** Reacts in the hero paste box (as in the footer), on errors, on the 404, when saving a repo. | Paste box, errors, 404, save button | Instant, friendly feedback before any text is read. | P: glyph swaps. A: aria-hidden, never the only signal. |
| 10 | **Empty and loading states with direction.** No results: the cat plus the one next thing to try. Skeletons crossfade to content (MOTION.md §4). | /find, /discover, /me | An empty screen becomes an invitation to act. | P: none. A: plain text first. |
| 11 | **Numbers count into place** when they are new to this visitor (pattern 4's counter). | /me stats, discover totals | Change is noticed. | Same as 4. |

**Left out on purpose:** parallax, cursor trails, scroll-jacking or pinned scroll sections (they fight Lenis and phones), and any intro animation that delays the paste box.

## Rollout
Page-sized PRs from main, each with a `staging` label and no prototype code:

1. **Footer** (pattern 7). It's global and self-contained: `footer.tsx`, `reactive-cat.tsx`, `/api/recent-checks` (a cached `listReports` read that loads only when the footer is near), and CSS. Whether landing section 08 goes is up to the user.
2. **Landing panes at full scale** (patterns 1 and 2 in the hero). `.pane` content scales to fill, and the header's measure widens to match the content edge. The header's owner needs to agree on that one-line change. The PR must fit at 1280×720 and 1366×768 without overflow, and phones stay readable.
3. **Landing story:** the replay (3, web and terminal modes) in 02, receipts (6) in 05, the redesigned answers pane in 06, and more scroll reveals, all joined to the existing cat companion and ScrollTrigger setup.
4. **Report page:** the answer lands (4) for fresh reports, and progress as a log (8).
5. **Cards** (5): one shared change to `repo-card` and `odds-bar`. It reaches /find, /discover, the signed-in home and saved.
6. **States:** the cat site-wide (9), empty and loading states (10), count-ups (11).

Each PR re-runs `e2e/lighthouse.mjs` (it must stay at 90 or above on `/`, `/pallets/flask` and `/find`) and checks reduced motion with Playwright (`reducedMotion: "reduce"`: no running transform animations).
