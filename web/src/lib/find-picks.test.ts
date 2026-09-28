import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultPicks, extraCount, findQuery, picksFromParams, picksFromQuery, picksQuery, resolvePicks, searchKey, widen, type Picks } from "./find-picks.ts";

const profile = { languages: ["go"], topics: ["cli"], days: 30, level: "newcomer" as const, contributions: ["docs" as const] };
const base = (over: Partial<Picks> = {}): Picks => ({ ...defaultPicks(false), ...over });

test("a URL with no picks leaves the choice to the cookie, profile or defaults", () => {
  assert.equal(picksFromParams({}), null);
  assert.equal(picksFromParams({ profile: "saved" }), null);
});

test("reads the old find form's URLs, including a search with the switch off", () => {
  const p = picksFromParams({ go: "1", lang: ["Python", "go", "python"], days: "3", topics: "Web Framework, cli", level: "newcomer", type: ["docs", "nonsense"] });
  assert.deepEqual(p, { langs: ["python", "go"], days: 3, topics: ["web-framework", "cli"], hf: false, level: "newcomer", types: ["docs"] });
  assert.equal(picksFromParams({ go: "1", hacktoberfest: "1" })?.hf, true);
  assert.equal(picksFromParams({ days: "99" })?.days, 7);
});

test("picksQuery round-trips and is stable", () => {
  const p = base({ langs: ["rust", "go"], days: 30, topics: ["cli"], hf: true, level: "newcomer", types: ["tests", "docs"] });
  assert.deepEqual(picksFromQuery(picksQuery(p)), { ...p, langs: ["go", "rust"], types: ["docs", "tests"] });
  assert.equal(picksQuery(p), picksQuery({ ...p, langs: ["go", "rust"] }));
  assert.equal(picksQuery(defaultPicks(false)), "days=7&hacktoberfest=0");
  assert.equal(picksFromQuery(undefined), null);
  assert.equal(picksFromQuery(""), null);
});

test("URL beats last picks beats profile beats defaults", () => {
  const cookie = picksQuery(base({ langs: ["rust"] }));
  const r = (params: Record<string, string>, c?: string, prof: typeof profile | null = profile) =>
    resolvePicks({ params, cookie: c, profile: prof, hfWindow: true, hfOn: true });
  assert.equal(r({ lang: "java" }, cookie).source, "url");
  assert.deepEqual(r({ lang: "java" }, cookie).picks.langs, ["java"]);
  assert.equal(r({}, cookie).source, "last");
  assert.deepEqual(r({}, cookie).picks.langs, ["rust"]);
  assert.equal(r({}, "garbage=1").source, "profile");
  assert.deepEqual(r({}).picks, { langs: ["go"], days: 30, topics: ["cli"], hf: true, level: "newcomer", types: ["docs"] });
  assert.deepEqual(r({}, undefined, null), { picks: defaultPicks(true), source: "default" });
});

test("outside the Hacktoberfest window the switch is always off", () => {
  const r = resolvePicks({ params: { hacktoberfest: "1" }, profile: null, hfWindow: false, hfOn: false });
  assert.equal(r.picks.hf, false);
});

test("only languages, topics, days and the switch change the search", () => {
  const p = base({ langs: ["go", "rust"] });
  assert.equal(searchKey(p), searchKey({ ...p, langs: ["rust", "go"], level: "newcomer", types: ["docs"] }));
  assert.notEqual(searchKey(p), searchKey({ ...p, days: 30 }));
  assert.deepEqual(findQuery(p), { languages: ["go", "rust"], topics: [], days: 7, hacktoberfest: false, limit: 12 });
});

test("counts the tucked-away filters", () => {
  assert.equal(extraCount(base()), 0);
  assert.equal(extraCount(base({ level: "newcomer", types: ["docs", "tests"], topics: ["a", "b"] })), 4);
});

test("widen offers at most three fixes, each loosening one pick", () => {
  assert.deepEqual(widen(base({ days: 30 })), []);
  const w = widen(base({ langs: ["go"], topics: ["cli"], hf: true, level: "newcomer" }));
  assert.deepEqual(w.map((x) => x.label), ["Drop the topics", "Include projects outside Hacktoberfest", "Show all starter issues"]);
  assert.deepEqual(w[0].picks.topics, []);
  assert.deepEqual(w[0].picks.langs, ["go"]);
  assert.deepEqual(widen(base({ langs: ["go"] })).map((x) => x.label), ["Any language", "I have a month"]);
});
