import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { motionAttr, motionCookie, motionFromCookies, parseMotion, prefersReducedMotion, resolveReduced, toggledMotion } from "./motion.ts";

test("the setting wins over the device: full > reduce > device", () => {
  assert.equal(resolveReduced("full", true), false);
  assert.equal(resolveReduced("reduce", false), true);
  assert.equal(resolveReduced("device", true), true);
  assert.equal(resolveReduced("device", false), false);
});

test("the server reads the setting from the cookie; anything else follows the device", () => {
  const jar = (value?: string) => ({ get: (name: string) => (name === "holt-motion" && value !== undefined ? { value } : undefined) });
  assert.equal(motionFromCookies(jar("reduce")), "reduce");
  assert.equal(motionFromCookies(jar("full")), "full");
  assert.equal(motionFromCookies(jar()), "device");
  assert.equal(motionFromCookies(jar("sideways")), "device");
  assert.equal(parseMotion(null), "device");
  assert.equal(motionAttr("device"), undefined);
  assert.equal(motionAttr("reduce"), "reduce");
});

test("the cookie lasts a year, and following the device clears it", () => {
  assert.match(motionCookie("reduce"), /^holt-motion=reduce; Path=\/; Max-Age=31536000; SameSite=Lax$/);
  assert.match(motionCookie("device"), /^holt-motion=; Path=\/; Max-Age=0/);
});

test("the footer switch turns motion back on the way the device allows", () => {
  assert.equal(toggledMotion(false, false), "reduce");
  assert.equal(toggledMotion(false, true), "reduce");
  assert.equal(toggledMotion(true, false), "device");
  assert.equal(toggledMotion(true, true), "full");
});

test("prefersReducedMotion reads <html data-motion> before the device", (t) => {
  const g = globalThis as Record<string, unknown>;
  const dataset: Record<string, string> = {};
  let os = false;
  g.document = { documentElement: { dataset } };
  g.matchMedia = () => ({ matches: os });
  t.after(() => {
    delete g.document;
    delete g.matchMedia;
  });
  for (const [attr, device, want] of [
    [undefined, false, false],
    [undefined, true, true],
    ["reduce", false, true],
    ["full", true, false],
  ] as const) {
    if (attr) dataset.motion = attr;
    else delete dataset.motion;
    os = device;
    assert.equal(prefersReducedMotion(), want, `data-motion=${attr} device=${device}`);
  }
});

test("prefersReducedMotion is false on the server", () => {
  assert.equal(prefersReducedMotion(), false);
});

// Each script-driven motion asks the shared helper (or its hook), never the
// media query itself, so the setting reaches it.
const COMPONENTS: [string, RegExp][] = [
  ["components/motion/smooth-scroll.tsx", /useReducedMotion\(\)[\s\S]*if \(reduced \|\|[\s\S]*\}, \[reduced\]\)/],
  ["components/motion/cat-companion.tsx", /useReducedMotion\(\)[\s\S]*if \(reduced \|\|[\s\S]*\}, \[reduced\]\)/],
  ["components/motion/scroll-marquee.tsx", /useReducedMotion\(\)[\s\S]*if \(!el \|\| reduced\)[\s\S]*\}, \[reduced\]\)/],
  ["components/motion/count-up.tsx", /prefersReducedMotion\(\) \? "done"/],
  ["components/motion/swap-host.tsx", /useReducedMotion\(\)/],
  ["components/landing/check-replay.tsx", /useReducedMotion\(\)/],
  ["components/landing/people.tsx", /useReducedMotion\(\)/],
  ["components/landing/answers.tsx", /useReducedMotion\(\)/],
  ["components/report/verdict-cat.tsx", /prefersReducedMotion\(\) \? 0/],
  ["components/footer.tsx", /prefersReducedMotion\(\)\) return/],
  ["components/shell/check-focus.tsx", /prefersReducedMotion\(\) \? "auto"/],
  ["components/motion/use-seen.ts", /useSyncExternalStore\(onMotionChange, prefersReducedMotion/],
];

for (const [file, uses] of COMPONENTS) {
  test(`${file} follows the motion setting`, () => {
    const src = readFileSync(new URL(`../${file}`, import.meta.url), "utf-8");
    assert.match(src, uses);
    assert.doesNotMatch(src, /prefers-reduced-motion/);
  });
}
