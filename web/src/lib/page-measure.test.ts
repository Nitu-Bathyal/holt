// The header and footer line up with the page under them: one set of measure
// tokens in globals.css, no second hard-coded width.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf-8");
const css = read("app/globals.css");
/** The body of the first rule whose selector list is exactly `selector`. */
function rule(selector: string): string {
  const at = css.indexOf(`${selector} {`);
  assert.notEqual(at, -1, selector);
  return css.slice(at, css.indexOf("}", at));
}

test("the header and footer take the page's measure", () => {
  const bars = rule(".site-header .wrap,\n  .site-footer .wrap");
  assert.match(bars, /width: min\(calc\(100% - 2 \* var\(--page-gut\)\), var\(--page-max\)\)/);
  assert.match(read("components/header.tsx"), /className="site-header [^"]*"[^>]*>\s*<div className="wrap /);
  assert.equal(read("components/footer.tsx").match(/<footer [^>]*className="site-footer /g)?.length, 2);
});

test("each page width is written once", () => {
  assert.match(rule("  .wrap"), /var\(--wrap-gut\)\), var\(--wrap-max\)/);
  assert.match(rule(".landing-wide"), /--gut: var\(--wide-gut\);\s*width: min\(calc\(100% - 2 \* var\(--gut\)\), var\(--wide-max\)\)/);
  assert.match(rule(".report-wide"), /var\(--wide-gut\)\), var\(--wide-max\)/);
  assert.equal(css.match(/1680px|1120px/g)?.length, 2);
});

test("on the landing and a report the page's measure is the wide one", () => {
  assert.match(rule(':root:has([data-shell="marketing"] .landing-wide)'), /--page-max: var\(--wide-max\);\s*--page-gut: var\(--wide-gut-lane\)/);
  assert.match(rule(':root:has([data-shell="marketing"] .report-wide)'), /--page-max: var\(--wide-max\);\s*--page-gut: var\(--wide-gut\)/);
});
