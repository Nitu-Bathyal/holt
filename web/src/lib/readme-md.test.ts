import assert from "node:assert/strict";
import { test } from "node:test";
import { badgeRow, parseInline, parseReadme, proxiedImageSrc, readmeImageSrc, readmeNamesImage, safeHref, safeImageSrc } from "./readme-md.ts";
import type { Block, Inline } from "./readme-md.ts";

const REPO = "pallets/flask";
const blocks = (md: string) => parseReadme(md, REPO);
const words = (c: Inline[]): string => c.map((n) => (n.t === "text" || n.t === "code" ? n.v : n.t === "image" ? "" : words(n.c))).join("");
const images = (c: Inline[]): string[] => c.flatMap((n) => (n.t === "image" ? [n.src] : n.t === "text" || n.t === "code" ? [] : images(n.c)));
const everyImage = (bs: Block[]): string[] => bs.flatMap((b) => (b.t === "p" || b.t === "quote" || b.t === "heading" ? images(b.c) : b.t === "list" ? b.items.flatMap((i) => images(i.c)) : []));
const links = (c: Inline[]): string[] => c.flatMap((n) => (n.t === "link" ? [n.href, ...links(n.c)] : n.t === "strong" || n.t === "em" ? links(n.c) : []));
const everyLink = (bs: Block[]) => bs.flatMap((b) => (b.t === "p" || b.t === "quote" || b.t === "heading" ? links(b.c) : b.t === "list" ? b.items.flatMap((i) => links(i.c)) : []));

test("links: only http(s) and repository paths are followed", () => {
  assert.equal(safeHref("https://flask.palletsprojects.com/", REPO), "https://flask.palletsprojects.com/");
  assert.equal(safeHref("http://example.org/a", REPO), "http://example.org/a");
  assert.equal(safeHref("javascript:alert(1)", REPO), null);
  assert.equal(safeHref("JaVaScRiPt:alert(1)", REPO), null);
  assert.equal(safeHref("data:text/html;base64,AAAA", REPO), null);
  assert.equal(safeHref("mailto:a@b.c", REPO), null);
  assert.equal(safeHref("vbscript:x", REPO), null);
  assert.equal(safeHref("//evil.example/x", REPO), null);
  assert.equal(safeHref("#install", REPO), null);
  assert.equal(safeHref("", REPO), null);
});

test("links: a relative path points into the repository, and can't climb out", () => {
  assert.equal(safeHref("docs/quickstart.rst", REPO), "https://github.com/pallets/flask/blob/HEAD/docs/quickstart.rst");
  assert.equal(safeHref("./CONTRIBUTING.md", REPO), "https://github.com/pallets/flask/blob/HEAD/CONTRIBUTING.md");
  assert.equal(safeHref("/LICENSE", REPO), "https://github.com/pallets/flask/blob/HEAD/LICENSE");
  assert.equal(safeHref("../../etc/passwd", REPO), null);
  assert.equal(safeHref("a b/c d.md", REPO), "https://github.com/pallets/flask/blob/HEAD/a%20b/c%20d.md");
});

test("raw HTML never reaches the output: tags go, their words stay", () => {
  const bs = blocks('<script>alert(1)</script>Hello <b onclick="x()">world</b> <img src=x onerror=alert(1)>');
  assert.equal(bs.length, 1);
  assert.ok(!JSON.stringify(bs).includes("<"));
  assert.ok(!JSON.stringify(bs).includes("onerror"));
  assert.equal(bs[0].t, "p");
  assert.match(words((bs[0] as { c: Inline[] }).c), /^alert\(1\)Hello world/);
});

test("a javascript: link keeps its words and loses the link", () => {
  const c = parseInline("[click me](javascript:alert(1)) now", REPO);
  assert.deepEqual(links(c), []);
  assert.equal(words(c), "click me now");
});

test("images: GitHub's hosts and the badge service are kept, as images", () => {
  const c = parseInline("![logo](https://raw.githubusercontent.com/pallets/flask/refs/heads/stable/logo.svg) ![ci](https://img.shields.io/badge/ci-passing-green.svg)", REPO);
  assert.deepEqual(images(c), ["https://raw.githubusercontent.com/pallets/flask/refs/heads/stable/logo.svg", "https://img.shields.io/badge/ci-passing-green.svg"]);
  assert.deepEqual(c.filter((n) => n.t === "image").map((n) => (n as { alt: string }).alt), ["logo", "ci"]);
  assert.deepEqual(images(parseInline("![shot](https://github.com/user-attachments/assets/1234-abcd)", REPO)), ["https://github.com/user-attachments/assets/1234-abcd"]);
  assert.deepEqual(images(parseInline("![x](https://private-user-images.githubusercontent.com/1/2.png?jwt=abc)", REPO)), ["https://private-user-images.githubusercontent.com/1/2.png?jwt=abc"]);
});

test("images: http, data:, script, userinfo and protocol-relative addresses are left out", () => {
  for (const bad of ["http://img.shields.io/x.svg", "data:image/svg+xml;base64,PHN2Zz4=", "javascript:alert(1)", "//img.shields.io/x.svg", "https://user:pw@img.shields.io/x.svg", "ftp://github.com/x.png", "https://localhost/x.png", "https://example.com:8443/x.png"]) {
    assert.equal(readmeImageSrc(bad, REPO), null, bad);
    assert.deepEqual(images(parseInline(`![x](${bad})`, REPO)), [], bad);
  }
});

test("images: another https host loads through the site's proxy, not directly", () => {
  const url = "https://cdn.example.org/cover%20a.png";
  assert.equal(safeImageSrc(url, REPO), null);
  assert.equal(readmeImageSrc(url, REPO), `/api/readme-image?repo=pallets%2Fflask&u=${encodeURIComponent(url)}`);
  assert.deepEqual(images(parseInline(`![cover](${url})`, REPO)), [proxiedImageSrc(REPO, url)]);
});

test("images: the proxy only fetches what the README names", () => {
  const md = ['<img src="https://cdn.example.org/a.png" alt="a">', "", "[![b](https://other.example.net/b.svg)](https://example.com)"].join("\n");
  assert.equal(readmeNamesImage(md, REPO, "https://cdn.example.org/a.png"), true);
  assert.equal(readmeNamesImage(md, REPO, "https://other.example.net/b.svg"), true);
  assert.equal(readmeNamesImage(md, REPO, "https://evil.example/x.png"), false);
});

test("images: a path in the repository is read from GitHub's raw host, and can't climb out", () => {
  assert.equal(safeImageSrc("docs/_static/logo.png", REPO), "https://raw.githubusercontent.com/pallets/flask/HEAD/docs/_static/logo.png");
  assert.equal(safeImageSrc("./img/a b.png?raw=true", REPO), "https://raw.githubusercontent.com/pallets/flask/HEAD/img/a%20b.png");
  assert.equal(safeImageSrc("/assets/x.gif", REPO), "https://raw.githubusercontent.com/pallets/flask/HEAD/assets/x.gif");
  assert.equal(safeImageSrc("../../etc/passwd", REPO), null);
  assert.equal(safeImageSrc("", REPO), null);
});

test("images: an <img> tag becomes an image, and only its address and alt are read", () => {
  const bs = blocks('<div align="center"><img src="https://raw.githubusercontent.com/o/r/HEAD/l.svg" alt="The logo" height="150" onerror="alert(1)" style="x"></div>');
  assert.deepEqual(everyImage(bs), ["https://raw.githubusercontent.com/o/r/HEAD/l.svg"]);
  assert.deepEqual(bs, [{ t: "p", c: [{ t: "image", src: "https://raw.githubusercontent.com/o/r/HEAD/l.svg", alt: "The logo" }], media: true }]);
  assert.ok(!JSON.stringify(bs).includes("onerror"));
  assert.deepEqual(everyImage(blocks("<img src='https://img.shields.io/a.svg'>")), ["https://img.shields.io/a.svg"]);
  assert.deepEqual(everyImage(blocks("<img>")), []);
  assert.deepEqual(everyImage(blocks("<picture><source srcset=x><img src=docs/d.png alt=d></picture>")), ["https://raw.githubusercontent.com/pallets/flask/HEAD/docs/d.png"]);
});

test("images: a clickable image keeps its link, and one that can't show disappears with it", () => {
  const c = parseInline("[![CI](https://img.shields.io/ci.svg)](https://ci.example/run)", REPO);
  assert.deepEqual(c, [{ t: "link", href: "https://ci.example/run", c: [{ t: "image", src: "https://img.shields.io/ci.svg", alt: "CI" }] }]);
  assert.deepEqual(parseInline("[![CI](http://evil.example/ci.svg)](https://ci.example/run)", REPO), []);
  // a link whose address is unsafe still shows its image, unlinked
  assert.deepEqual(parseInline("[![CI](https://img.shields.io/ci.svg)](javascript:alert(1))", REPO), [{ t: "image", src: "https://img.shields.io/ci.svg", alt: "CI" }]);
});

test("images: a paragraph of only images (badges, a logo) is a media row; mixed text is not", () => {
  const md = ["![a](https://img.shields.io/a.svg) [![b](https://img.shields.io/b.svg)](https://b.example)", "See ![c](https://img.shields.io/c.svg) here."].join("\n\n");
  const [row, mixed] = blocks(md);
  assert.equal((row as { media?: boolean }).media, true);
  assert.equal((mixed as { media?: boolean }).media, undefined);
  assert.equal(words((mixed as { c: Inline[] }).c), "See  here.");
  assert.deepEqual(blocks("![x](http://evil.example/x.png)"), []);
});

test("headings: #, underlined and HTML", () => {
  const bs = blocks("# One\n\nTwo\n===\n\nThree\n---\n\n<h2 align=\"center\">Four <em>x</em></h2>\n\n###### Six");
  assert.deepEqual(
    bs.map((b) => (b.t === "heading" ? [b.level, words(b.c)] : b.t)),
    [[1, "One"], [1, "Two"], [2, "Three"], [2, "Four x"], [4, "Six"]],
  );
});

test("paragraphs join their lines; a blank line starts a new one", () => {
  const bs = blocks("one\ntwo\n\nthree");
  assert.deepEqual(bs.map((b) => (b.t === "p" ? words(b.c) : b.t)), ["one two", "three"]);
});

test("lists: bullets, numbers, a nested level and a continued item", () => {
  const [ul, ol] = blocks("- a\n- b\n  more of b\n  - c\n\n1. one\n2) two");
  assert.equal(ul.t, "list");
  assert.deepEqual((ul as Extract<Block, { t: "list" }>).items.map((i) => [i.depth, words(i.c)]), [[0, "a"], [0, "b more of b"], [1, "c"]]);
  assert.equal((ul as Extract<Block, { t: "list" }>).ordered, false);
  assert.equal((ol as Extract<Block, { t: "list" }>).ordered, true);
  assert.deepEqual((ol as Extract<Block, { t: "list" }>).items.map((i) => words(i.c)), ["one", "two"]);
});

test("code: fenced blocks keep their text exactly, and HTML inside is not stripped", () => {
  const bs = blocks("Install:\n\n```bash\n$ pip install flask <pkg>\n# not a heading\n```\n\nDone.");
  assert.deepEqual(bs.map((b) => b.t), ["p", "code", "p"]);
  assert.deepEqual(bs[1], { t: "code", lang: "bash", v: "$ pip install flask <pkg>\n# not a heading" });
});

test("code: an unclosed fence runs to the end, and an indented block is code", () => {
  assert.deepEqual(blocks("```\nx = 1\ny = 2"), [{ t: "code", lang: null, v: "x = 1\ny = 2" }]);
  assert.deepEqual(blocks("Run:\n\n    flask run\n\nthen."), [
    { t: "p", c: [{ t: "text", v: "Run:" }] },
    { t: "code", lang: null, v: "flask run" },
    { t: "p", c: [{ t: "text", v: "then." }] },
  ]);
});

test("inline: code, bold, italic, links and escapes", () => {
  assert.deepEqual(parseInline("use `pip install x` **now** and *soon*", REPO), [
    { t: "text", v: "use " },
    { t: "code", v: "pip install x" },
    { t: "text", v: " " },
    { t: "strong", c: [{ t: "text", v: "now" }] },
    { t: "text", v: " and " },
    { t: "em", c: [{ t: "text", v: "soon" }] },
  ]);
  assert.deepEqual(parseInline("[docs](https://d.example \"the docs\")", REPO), [{ t: "link", href: "https://d.example/", c: [{ t: "text", v: "docs" }] }]);
  assert.equal(words(parseInline("snake_case_name and \\*not bold\\*", REPO)), "snake_case_name and *not bold*");
  assert.equal(words(parseInline("`<b>` stays", REPO)), "<b> stays");
});

test("quotes, rules and tables", () => {
  const bs = blocks("> a wise\n> remark\n\n---\n\n| a | b |\n|---|---|\n| 1 | 2 |");
  assert.deepEqual(bs.map((b) => b.t), ["quote", "hr", "p", "p"]);
  assert.equal(words((bs[0] as { c: Inline[] }).c), "a wise remark");
  assert.equal(words((bs[2] as { c: Inline[] }).c), "a · b");
  assert.equal(words((bs[3] as { c: Inline[] }).c), "1 · 2");
});

test("a real-looking README: badges first, then the project", () => {
  const md = "<p align=\"center\"><img src=\"logo.png\"></p>\n\n# Flask\n\n[![PyPI](https://x/y.svg)](https://pypi.org/p/flask)\n\nFlask is a lightweight [WSGI](https://wsgi.readthedocs.io/) framework.\n\n## Install\n\n```\npip install flask\n```\n";
  const bs = blocks(md);
  // the logo (a file in the repository) stays; the badge from x/y.svg, a host not on the list, goes
  assert.deepEqual(bs.map((b) => b.t), ["p", "heading", "p", "heading", "code"]);
  assert.deepEqual(everyImage(bs), ["https://raw.githubusercontent.com/pallets/flask/HEAD/logo.png"]);
  assert.deepEqual(everyLink(bs), ["https://wsgi.readthedocs.io/"]);
});

test("whatever it is given, it doesn't throw, and keeps to its limit", () => {
  for (const s of ["", "   ", "[", "[](", "**", "`", "![", "<", "<<<<", "- ", "1.", "|", "> ", "```", "\u0000", "[a](b", "_"]) {
    assert.doesNotThrow(() => parseReadme(s, REPO), JSON.stringify(s));
  }
  assert.ok(blocks("x\n\n".repeat(2000)).length <= 300);
});

test("a bare address becomes a link, without the punctuation after it", () => {
  const c = parseInline("See https://werkzeug.palletsprojects.com/, or (https://a.example/x).", REPO);
  assert.deepEqual(links(c), ["https://werkzeug.palletsprojects.com/", "https://a.example/x"]);
  assert.equal(words(c), "See https://werkzeug.palletsprojects.com/, or (https://a.example/x).");
  // Inside a link's own text or code it is left alone.
  assert.deepEqual(links(parseInline("`https://a.example`", REPO)), []);
  assert.deepEqual(links(parseInline("nothttps://a.example", REPO)), []);
});

test("a row of status badges is a badge row; a logo is not", () => {
  const [badges] = blocks("[![CI](https://github.com/o/r/actions/workflows/ci.yml/badge.svg)](https://x.org) ![license](https://img.shields.io/badge/license-MIT-blue.svg)");
  const [logo] = blocks("![llama](https://raw.githubusercontent.com/ggml-org/llama.cpp/master/media/logo.png)");
  const [mixed] = blocks("![ci](https://img.shields.io/badge/ci-passing-green.svg) ![logo](https://raw.githubusercontent.com/o/r/HEAD/logo.png)");
  assert.equal(badgeRow(badges), true);
  assert.equal(badgeRow(logo), false);
  assert.equal(badgeRow(mixed), false);
  assert.equal(badgeRow(blocks("Just text.")[0]), false);
});

test("images: HTML indented under a link or <picture> is still an image, not a code block", () => {
  const md = ['<a href="https://example.com/">', "  <picture>", '    <source media="(prefers-color-scheme: dark)" srcset="https://cdn.example.org/dark.png" />', '    <img alt="Cover" src="https://cdn.example.org/cover.png" />', "  </picture>", "</a>"].join("\n");
  const bs = parseReadme(md, REPO);
  assert.equal(bs.some((b) => b.t === "code"), false);
  assert.deepEqual(everyImage(bs), [proxiedImageSrc(REPO, "https://cdn.example.org/cover.png")]);
});
