// What a reader opens: the pages, how often each, and how to tell a good
// answer from a bad one. Only GETs of pages that are already cached, so a
// reader costs no GitHub points and starts no check.
import { fail, sleep } from "k6";
import { Rate } from "k6/metrics";
import { get } from "./target.js";

/** Requests that didn't give the page: a bad status, or a 200 showing the error panel. */
export const pageBad = new Rate("page_bad");

export function lines(text) {
  return text.split("\n").map((s) => s.trim()).filter((s) => s && !s.startsWith("#"));
}

// Reports staging already has (repos/cached.txt), shown signed out as a
// teaser, and the examples anyone reads in full (web/src/lib/examples.ts).
// A full report also loads its starter issues, so only examples whose
// starter issues are cached belong in FULL_REPOS.
const CACHED = lines(open(import.meta.resolve("../repos/cached.txt")));
const FULL = (__ENV.FULL_REPOS || "pallets/flask,home-assistant/core").split(",").map((s) => s.trim()).filter(Boolean);

// name, share of page views, paths, and text that is only there when the page worked.
const MIX = [
  { name: "report_teaser", weight: 40, paths: CACHED.filter((r) => !FULL.includes(r)).map((r) => `/${r}`), marker: "data-teaser" },
  { name: "report_full", weight: 10, paths: FULL.map((r) => `/${r}`), marker: "data-verdict-block" },
  { name: "landing", weight: 20, paths: ["/"], marker: "data-cat-section" },
  { name: "discover", weight: 15, paths: ["/discover", "/discover?sort=stars", "/discover/python", "/discover/javascript"], marker: "data-tab" },
  { name: "find", weight: 10, paths: ["/find"], marker: "data-tab" },
  { name: "examples", weight: 5, paths: ["/examples"], marker: "href=\"/pallets/flask\"" },
];

export const PAGES = MIX.map((p) => p.name);

// ONLY=discover,find loads just those pages, to price one kind of page.
const ONLY = (__ENV.ONLY || "").split(",").map((s) => s.trim()).filter(Boolean);

const pick = (list) => list[Math.floor(Math.random() * list.length)];

function good(res, page) {
  return res.status === 200 && typeof res.body === "string" && res.body.includes(page.marker) && !res.body.includes('role="alert"');
}

/**
 * Open every page once, one at a time, before the load: a first view may look
 * a repo up on github.com, and that should happen once, not 200 times at once.
 * Returns the mix with only the paths that answered properly.
 */
export function prime(target) {
  const mix = [];
  for (const page of MIX.filter((p) => !ONLY.length || ONLY.includes(p.name))) {
    const paths = page.paths.filter((path) => good(get(path, target, { step: "setup", page: page.name }, { timeout: "30s" }), page));
    const dropped = page.paths.length - paths.length;
    if (dropped) console.warn(`${page.name}: ${dropped} of ${page.paths.length} paths left out (no cached report, or the page didn't answer)`);
    if (!paths.length) fail(`${page.name}: no page answered properly; nothing to load-test`);
    mix.push({ name: page.name, weight: page.weight, marker: page.marker, paths });
  }
  if (!mix.length) fail(`ONLY=${ONLY.join(",")} names no page; the pages are ${PAGES.join(", ")}`);
  return mix;
}

/** One page view, tagged with the window it falls in, then a reader's pause. */
export function view(mix, target, step) {
  let roll = Math.random() * mix.reduce((sum, p) => sum + p.weight, 0);
  const page = mix.find((p) => (roll -= p.weight) < 0) || mix[0];
  const tags = { step, page: page.name };
  const res = get(pick(page.paths), target, tags, { timeout: "30s" });
  pageBad.add(!good(res, page), tags);
  const min = Number(__ENV.THINK_MIN || 0.5);
  const max = Number(__ENV.THINK_MAX || 1.5);
  sleep(min + Math.random() * Math.max(0, max - min));
}
