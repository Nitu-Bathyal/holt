import assert from "node:assert/strict";
import { test } from "node:test";
import { aboutNumbers, compactCount, docLinks, flags, helpLinks, houseRules, projectFacts, readmeShown, share, siteLabel } from "./repo-about.ts";
import type { RepoAbout } from "./repo-about.ts";

const base: RepoAbout = {
  description: "The Python micro framework",
  readme_line: "Flask is a lightweight WSGI web application framework.",
  homepage: "https://flask.palletsprojects.com/",
  stars: 69_800,
  forks: 16_300,
  open_issues: 1,
  pull_requests: 4_100,
  open_pull_requests: 12,
  contributors: 812,
  license: "BSD-3-Clause",
  topics: ["wsgi"],
  languages: [{ name: "Python", share: 0.995 }, { name: "HTML", share: 0.004 }],
  created_at: "2010-04-06T00:00:00Z",
  pushed_at: "2026-09-27T00:00:00Z",
  default_branch: "main",
  archived: false,
  fork: false,
  fork_of: null,
  links: [],
  latest_release: null,
  readme: null,
  top_contributors: [],
  fetched_at: "2026-09-29T00:00:00Z",
};

test("compact counts", () => {
  assert.equal(compactCount(0), "0");
  assert.equal(compactCount(999), "999");
  assert.equal(compactCount(1000), "1k");
  assert.equal(compactCount(1234), "1.2k");
  assert.equal(compactCount(91_234), "91k");
  assert.equal(compactCount(999_999), "1M");
  assert.equal(compactCount(1_250_000), "1.3M");
});

test("the numbers, singular when one, and only the known ones", () => {
  assert.deepEqual(aboutNumbers(base), [
    { value: "70k", label: "stars" },
    { value: "16k", label: "forks" },
    { value: "1", label: "open issue" },
  ]);
  assert.deepEqual(aboutNumbers({ ...base, stars: 1, forks: null, open_issues: null }), [{ value: "1", label: "star" }]);
});

test("language shares", () => {
  assert.equal(share(0.995), "100%");
  assert.equal(share(0.42), "42%");
  assert.equal(share(0.004), "<1%");
});

test("homepage as a short label", () => {
  assert.equal(siteLabel("https://flask.palletsprojects.com/"), "flask.palletsprojects.com");
  assert.equal(siteLabel("https://www.example.org/docs/"), "example.org/docs");
  assert.equal(siteLabel("not a url"), "not a url");
});

test("the README line only when it adds something", () => {
  assert.equal(readmeShown(base), base.readme_line);
  assert.equal(readmeShown({ ...base, readme_line: "The Python micro framework." }), null);
  assert.equal(readmeShown({ ...base, readme_line: null }), null);
});

test("project facts: only what GitHub gave, plain words", () => {
  assert.deepEqual(projectFacts({ ...base, latest_release: { tag: "3.1.0", published_at: "2026-09-01T00:00:00Z", url: "https://github.com/pallets/flask/releases/tag/3.1.0" } }), [
    { label: "people have contributed", value: "812" },
    { label: "pull requests open of 4.1k ever", value: "12" },
    { label: "last change", value: "", since: "2026-09-27T00:00:00Z" },
    { label: "latest release", value: "3.1.0", since: "2026-09-01T00:00:00Z", href: "https://github.com/pallets/flask/releases/tag/3.1.0" },
  ]);
  const bare = projectFacts({ ...base, contributors: null, open_pull_requests: null, pushed_at: null });
  assert.deepEqual(bare, []);
  assert.equal(projectFacts({ ...base, contributors: 1 })[0].label, "person has contributed");
});

test("help links: the guide first, chat after, the site last, no repeats", () => {
  const links = helpLinks({
    ...base,
    links: [
      { kind: "discord", url: "https://discord.gg/x" },
      { kind: "contributing", url: "https://github.com/pallets/flask/blob/main/CONTRIBUTING.md" },
      { kind: "docs", url: "https://flask.palletsprojects.com/" },
    ],
  });
  assert.deepEqual(links.map((l) => l.label), ["Contributing guide", "Documentation", "Discord chat"]);
  assert.deepEqual(helpLinks({ ...base, links: [] }).map((l) => l.url), ["https://flask.palletsprojects.com/"]);
  assert.deepEqual(helpLinks({ ...base, links: [], homepage: null }), []);
});

test("archived and fork flags", () => {
  assert.deepEqual(flags(base), []);
  assert.deepEqual(flags({ ...base, archived: true, fork: true, fork_of: "orig/flask" }), [
    { kind: "archived", text: "Archived" },
    { kind: "fork", text: "Fork of orig/flask", repo: "orig/flask" },
  ]);
  assert.deepEqual(flags({ ...base, fork: true }), [{ kind: "fork", text: "A fork" }]);
});

test("house rules: one plain instruction per ask, each once, with where it was read", () => {
  const url = "https://github.com/o/r/blob/main/CONTRIBUTING.md";
  const rules = houseRules([
    { code: "ai_disclosure", url, link: null, days: null },
    { code: "stale_bot", url, link: null, days: 30 },
    { code: "ai_disclosure", url, link: null, days: null },
    { code: "stale_bot", url: "https://x", link: null, days: null },
  ]);
  assert.deepEqual(rules, [
    { text: "Say whether you used AI.", url },
    { text: "A bot closes pull requests that go quiet for 30 days.", url },
  ]);
  assert.deepEqual(houseRules([]), []);
});

test("doc links: README, the project's own links, then issues and pull requests", () => {
  const links = docLinks({ ...base, readme: "# Flask", links: [{ kind: "contributing", url: "https://github.com/pallets/flask/blob/main/CONTRIBUTING.md" }] }, "pallets/flask");
  assert.deepEqual(links.map((l) => l.label), ["README", "Contributing guide", "flask.palletsprojects.com", "Open issues", "Pull requests"]);
  assert.equal(links[0].url, "https://github.com/pallets/flask#readme");
  assert.deepEqual(docLinks({ ...base, readme: null, links: [], homepage: null }, "o/r").map((l) => l.label), ["Open issues", "Pull requests"]);
});
