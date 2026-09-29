// The site's motion setting (lib/motion.ts) in CSS. Stylesheets keep plain
// `@media (prefers-reduced-motion: reduce | no-preference)` blocks; this turns
// each one into two copies, so the setting on <html data-motion> wins over the
// device:
//
//   @media (prefers-reduced-motion: reduce) and (X) { .a { … } }
// becomes
//   @media (prefers-reduced-motion: reduce) and (X) { :where(:root:not([data-motion="full"])) .a { … } }
//   @media (X) { :where(:root[data-motion="reduce"]) .a { … } }
//
// and the same for no-preference with "reduce" and "full" swapped. The added
// context sits in :where(), so every rule keeps its own specificity. A selector
// that starts at the root (:root, html, *, ::view-transition-…) gets the
// condition on the root itself.
//
// Kept simple on purpose: a motion query may only be joined to others with
// `and`, and motion blocks don't nest. Anything else fails the build.
const QUERY = /^\(\s*prefers-reduced-motion\s*:\s*(reduce|no-preference)\s*\)$/i;
const MENTION = /prefers-reduced-motion/i;

const CONTEXT = {
  reduce: { device: ':not([data-motion="full"])', forced: '[data-motion="reduce"]' },
  "no-preference": { device: ':not([data-motion="reduce"])', forced: '[data-motion="full"]' },
};

/** `(a) and (prefers-reduced-motion: reduce)` → { mode: "reduce", rest: "(a)" }; null when it has no motion query. */
export function splitMotionQuery(params) {
  if (!MENTION.test(params)) return null;
  if (/,|\bor\b|\bnot\b|\bonly\b/i.test(params)) throw new Error(`postcss-motion: keep prefers-reduced-motion to "and" queries: @media ${params}`);
  const parts = params.split(/\s+and\s+/i).map((p) => p.trim());
  const hit = parts.filter((p) => QUERY.test(p));
  if (hit.length !== 1) throw new Error(`postcss-motion: can't read @media ${params}`);
  return { mode: hit[0].match(QUERY)[1].toLowerCase(), rest: parts.filter((p) => p !== hit[0]).join(" and ") };
}

/** One selector, limited to documents whose root matches `cond`. */
export function scopeSelector(sel, cond) {
  const s = sel.trim();
  const root = s.match(/^(:root|html)(?![\w-])/i);
  if (root) return `${root[0]}:where(${cond})${s.slice(root[0].length)}`;
  const ctx = `:where(:root${cond})`;
  if (s.startsWith("::")) return `${ctx}${s}`;
  // `*` matches the root too (scroll-behavior on <html> matters).
  if (/^\*(?![\w-])/.test(s)) return `${ctx} ${s}, ${ctx}${s.slice(1)}`;
  return `${ctx} ${s}`;
}

function inside(node, stop, test) {
  for (let p = node.parent; p && p !== stop; p = p.parent) if (test(p)) return true;
  return false;
}

function scope(block, cond) {
  block.walkRules((rule) => {
    // Nested rules are relative to their parent, which is already scoped.
    if (inside(rule, block, (p) => p.type === "rule" || (p.type === "atrule" && /keyframes$/i.test(p.name)))) return;
    rule.selectors = rule.selectors.map((s) => scopeSelector(s, cond));
  });
}

const plugin = () => ({
  postcssPlugin: "postcss-motion",
  Once(root) {
    const blocks = [];
    root.walkAtRules("media", (at) => {
      // Tailwind's own variant definitions (@custom-variant) are written by hand.
      if (inside(at, root, (p) => p.type === "atrule" && p.name === "custom-variant")) return;
      const q = splitMotionQuery(at.params);
      if (!q) return;
      if (inside(at, root, (p) => p.type === "atrule" && p.name === "media" && MENTION.test(p.params))) {
        throw new Error(`postcss-motion: don't nest prefers-reduced-motion blocks: @media ${at.params}`);
      }
      blocks.push([at, q]);
    });
    for (const [at, { mode, rest }] of blocks) {
      const forced = at.clone();
      scope(at, CONTEXT[mode].device);
      scope(forced, CONTEXT[mode].forced);
      if (rest) {
        forced.params = rest;
        forced.raws.before = at.raws.before || "\n";
        at.after(forced);
      } else {
        at.after(forced.nodes);
      }
    }
  },
});
plugin.postcss = true;

export default plugin;
