import assert from "node:assert/strict";
import { test } from "node:test";
import postcss from "postcss";
import motion, { scopeSelector, splitMotionQuery } from "../../postcss-motion.mjs";

const run = async (css: string) => (await postcss([motion()]).process(css, { from: undefined })).css.replace(/\s+/g, " ").trim();

test("a reduce block also applies when the setting says reduce, and never under full", async () => {
  assert.equal(
    await run("@media (prefers-reduced-motion: reduce) { .a { animation: none; } }"),
    '@media (prefers-reduced-motion: reduce) { :where(:root:not([data-motion="full"])) .a { animation: none; } } :where(:root[data-motion="reduce"]) .a { animation: none; }',
  );
});

test("a no-preference block also applies under full, and never under reduce; other conditions stay", async () => {
  assert.equal(
    await run("@media (hover: hover) and (prefers-reduced-motion: no-preference) { .a:hover { translate: 0 -2px; } }"),
    '@media (hover: hover) and (prefers-reduced-motion: no-preference) { :where(:root:not([data-motion="reduce"])) .a:hover { translate: 0 -2px; } } @media (hover: hover) { :where(:root[data-motion="full"]) .a:hover { translate: 0 -2px; } }',
  );
});

test("rules on the root itself get the condition on the root", () => {
  const c = '[data-motion="reduce"]';
  assert.equal(scopeSelector(":root", c), ':root:where([data-motion="reduce"])');
  assert.equal(scopeSelector("html body", c), 'html:where([data-motion="reduce"]) body');
  assert.equal(scopeSelector("::view-transition-group(*)", c), ':where(:root[data-motion="reduce"])::view-transition-group(*)');
  assert.equal(scopeSelector("*::after", c), ':where(:root[data-motion="reduce"]) *::after, :where(:root[data-motion="reduce"])::after');
  assert.equal(scopeSelector(".rcat-face:is([a], [b]) .ear", c), ':where(:root[data-motion="reduce"]) .rcat-face:is([a], [b]) .ear');
});

test("keyframes, nested rules and other media are left alone", async () => {
  const out = await run("@media (prefers-reduced-motion: no-preference) { @keyframes k { from { opacity: 0; } } .a { & .b { x: 1; } } } @media (min-width: 1px) { .c { y: 1; } }");
  assert.match(out, /@keyframes k \{ from \{/);
  assert.match(out, /:where\(:root\[data-motion="full"\]\) \.a \{ & \.b/);
  assert.match(out, /@media \(min-width: 1px\) \{ \.c \{/);
});

test("queries it can't read fail the build", async () => {
  assert.equal(splitMotionQuery("(min-width: 1px)"), null);
  assert.throws(() => splitMotionQuery("(prefers-reduced-motion: reduce), print"));
  assert.throws(() => splitMotionQuery("not (prefers-reduced-motion: reduce)"));
  await assert.rejects(run("@media (prefers-reduced-motion: reduce) { @media (prefers-reduced-motion: reduce) { .a { b: c; } } }"));
});
