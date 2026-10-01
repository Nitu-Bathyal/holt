// A README as data, for the report's README section. A small Markdown reader
// that can't put anything dangerous on the page: it returns plain blocks, never
// HTML; raw HTML tags are dropped (their text is kept), and a link survives only
// as an http(s) address. Images are kept: from a host the site's
// Content-Security-Policy allows (IMAGE_HOSTS, matching next.config.ts) they load
// directly; from any other https address they load through the site's own image
// proxy (readmeImageSrc). Pure, so it can be tested
// without React. Not a full Markdown implementation: headings, paragraphs,
// lists, quotes, code, rules, links, images, bold, italic and inline code,
// which is what a newcomer needs to get the idea.

export type Inline =
  | { t: "text"; v: string }
  | { t: "code"; v: string }
  | { t: "image"; src: string; alt: string }
  | { t: "strong"; c: Inline[] }
  | { t: "em"; c: Inline[] }
  | { t: "link"; href: string; c: Inline[] };

export type Block =
  | { t: "heading"; level: 1 | 2 | 3 | 4; c: Inline[] }
  /** `media`: only images (a row of badges, a logo), laid out as a row. */
  | { t: "p"; c: Inline[]; media?: boolean }
  | { t: "list"; ordered: boolean; items: { depth: 0 | 1; c: Inline[] }[] }
  | { t: "code"; lang: string | null; v: string }
  | { t: "quote"; c: Inline[] }
  | { t: "hr" };

/** The most blocks kept: the server already cuts the README, this is a backstop. */
const MAX_BLOCKS = 300;

type Segment = { code: false; text: string } | { code: true; lang: string | null; v: string };

/** The text split into fenced code blocks (kept as they are) and everything else. */
function segments(src: string): Segment[] {
  const out: Segment[] = [];
  let prose: string[] = [];
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const open = /^\s*(```+|~~~+)\s*([\w+#.-]*)/.exec(lines[i]);
    if (!open) {
      prose.push(lines[i]);
      continue;
    }
    if (prose.length) out.push({ code: false, text: prose.join("\n") });
    prose = [];
    const marker = open[1][0];
    const body: string[] = [];
    i++;
    while (i < lines.length && !new RegExp(`^\\s*${marker}{${open[1].length},}\\s*$`).test(lines[i])) body.push(lines[i++]);
    out.push({ code: true, lang: open[2] || null, v: body.join("\n") });
  }
  if (prose.length) out.push({ code: false, text: prose.join("\n") });
  return out;
}

/** Comments and raw HTML out of prose: an HTML heading becomes a Markdown one, the rest loses its tags but keeps its words. */
function withoutHtml(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, "")
    // A line that starts with a tag was written as HTML, so its indentation is layout, not Markdown's "indented code".
    .replace(/^[ 	]+(?=<)/gm, "")
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi, (_m, n: string, inner: string) => `\n\n${"#".repeat(Number(n))} ${inner.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim()}\n\n`)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<(https?:\/\/[^>\s]+)>/gi, "$1")
    .replace(/<img\b([^>]*)>/gi, (_m, attrs: string) => {
      // An <img> becomes a Markdown image: only its address and alt text are read; every other attribute (an onerror, a style) is dropped.
      const srcAttr = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(attrs);
      const altAttr = /\balt\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
      const src = (srcAttr?.[1] ?? srcAttr?.[2] ?? srcAttr?.[3] ?? "").trim();
      if (!src || /[<>\s]/.test(src)) return "";
      const alt = (altAttr?.[1] ?? altAttr?.[2] ?? "").replace(/[[\]\n\r]/g, " ").trim();
      // No angle brackets: the next step would strip them as a tag. Parentheses are encoded so the address can't end the image early.
      return `![${alt}](${src.replace(/\(/g, "%28").replace(/\)/g, "%29")})`;
    })
    .replace(/<\/?[A-Za-z][^>]*>/g, "");
}

/** Where a link may go: an http(s) address, or a path in the repository. Anything else (a script, an anchor, a mail link) is text only. */
export function safeHref(raw: string, repo: string): string | null {
  const href = raw.trim().replace(/^<|>$/g, "");
  if (!href || href.startsWith("#") || href.startsWith("//")) return null;
  if (/^https?:\/\//i.test(href)) {
    try {
      const u = new URL(href);
      return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
    } catch {
      return null;
    }
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return null; // javascript:, data:, mailto:, ...
  const path = href.replace(/^\.?\//, "").replace(/^\/+/, "");
  if (!path || path.split("/").includes("..")) return null;
  return `https://github.com/${repo}/blob/HEAD/${path.split("/").map(encodeURIComponent).join("/")}`;
}

/**
 * Hosts a README image may come from: the same list as `img-src` in
 * next.config.ts. GitHub's own (the repository's files, uploaded screenshots,
 * its image proxy) and the badge service nearly every README uses. An image
 * from anywhere else is left out rather than asked for and blocked.
 */
const IMAGE_HOSTS = [/^github\.com$/, /\.githubusercontent\.com$/, /^img\.shields\.io$/];

/** Where an image may come from: an https address on IMAGE_HOSTS, or a file in the repository (read from GitHub's raw host). Anything else is null. */
export function safeImageSrc(raw: string, repo: string): string | null {
  const src = raw.trim().replace(/^<|>$/g, "");
  if (!src) return null;
  let url: URL;
  try {
    if (/^https:\/\//i.test(src)) {
      url = new URL(src);
    } else if (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith("//")) {
      return null; // http:, data:, javascript:, a protocol-relative address
    } else {
      const [file] = src.split(/[?#]/);
      const path = file.replace(/^\.?\//, "").replace(/^\/+/, "");
      if (!path || path.split("/").includes("..")) return null;
      url = new URL(`https://raw.githubusercontent.com/${repo}/HEAD/${path.split("/").map(encodeURIComponent).join("/")}`);
    }
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  return url.protocol === "https:" && !url.username && !url.password && IMAGE_HOSTS.some((re) => re.test(host)) ? url.toString() : null;
}

/** The address the page asks for when an image is on a host the policy doesn't allow: this site's proxy (app/api/readme-image), which only serves what the README names. */
export function proxiedImageSrc(repo: string, url: string): string {
  return `/api/readme-image?repo=${encodeURIComponent(repo)}&u=${encodeURIComponent(url)}`;
}

/** An image's address as the page uses it: direct from an allowed host, through the proxy from any other https address, or nothing. */
export function readmeImageSrc(raw: string, repo: string): string | null {
  const direct = safeImageSrc(raw, repo);
  if (direct) return direct;
  const src = raw.trim().replace(/^<|>$/g, "");
  if (!/^https:\/\//i.test(src)) return null;
  try {
    const u = new URL(src);
    return u.username || u.password || (u.port && u.port !== "443") || !u.hostname.includes(".") ? null : proxiedImageSrc(repo, u.toString());
  } catch {
    return null;
  }
}

/** Whether this README shows this image through the proxy: the proxy's only reason to fetch anything. */
export function readmeNamesImage(markdown: string, repo: string, url: string): boolean {
  const want = proxiedImageSrc(repo, url);
  const seen = (nodes: Inline[]): boolean => nodes.some((n) => (n.t === "image" ? n.src === want : n.t === "strong" || n.t === "em" || n.t === "link" ? seen(n.c) : false));
  return parseReadme(markdown, repo).some((b) => (b.t === "p" || b.t === "heading" || b.t === "quote" ? seen(b.c) : b.t === "list" ? b.items.some((i) => seen(i.c)) : false));
}

const text = (v: string): Inline => ({ t: "text", v });

/** Whether nodes show anything: an image, or text that isn't blank. */
const shows = (c: Inline[]): boolean => c.some((n) => (n.t === "image" ? true : n.t === "text" || n.t === "code" ? n.v.trim() !== "" : shows(n.c)));

const DEST = String.raw`\(\s*(<[^>]*>|(?:[^()\s]|\([^()\s]*\))*)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)`;
const IMAGE_AT = new RegExp(String.raw`^!\[([^\]]*)\]` + DEST);
// A link's text may hold one level of image, which is how a badge or a clickable logo is written.
const LINK_AT = new RegExp(String.raw`^\[((?:[^\[\]]|!\[[^\]]*\]\([^)]*\))*)\]` + DEST);

/** Inline Markdown to nodes. `repo` resolves relative links and image paths. */
export function parseInline(src: string, repo: string): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  const flush = () => {
    if (buf) out.push(text(buf));
    buf = "";
  };
  const s = src.replace(/!\[[^\]]*\]\[[^\]]*\]/g, ""); // reference-style images have nowhere to point: dropped
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    // ![alt](src "title")
    if (ch === "!" && s[i + 1] === "[") {
      const img = IMAGE_AT.exec(s.slice(i));
      if (img) {
        flush();
        const url = readmeImageSrc(img[2], repo);
        if (url) out.push({ t: "image", src: url, alt: img[1].trim() });
        i += img[0].length;
        continue;
      }
    }
    // `code`
    if (ch === "`") {
      const run = /^`+/.exec(s.slice(i))![0];
      const end = s.indexOf(run, i + run.length);
      if (end > i) {
        flush();
        out.push({ t: "code", v: s.slice(i + run.length, end).trim() });
        i = end + run.length;
        continue;
      }
    }
    // [text](href "title")
    if (ch === "[") {
      const m = LINK_AT.exec(s.slice(i));
      if (m) {
        flush();
        const inner = parseInline(m[1], repo);
        const href = safeHref(m[2], repo);
        // A link with nothing to show (its image was left out) disappears; one
        // that can't be followed keeps what it shows.
        if (shows(inner)) {
          if (href) out.push({ t: "link", href, c: inner });
          else out.push(...inner);
        }
        i += m[0].length;
        continue;
      }
      // [text][ref] and [text]: just the words
      const ref = /^\[([^\]]+)\](?:\[[^\]]*\])?/.exec(s.slice(i));
      if (ref) {
        flush();
        out.push(...parseInline(ref[1], repo));
        i += ref[0].length;
        continue;
      }
    }
    // a bare address: https://example.org/docs. It ends before the punctuation a sentence puts after it.
    if (ch === "h" && (i === 0 || /[\s(]/.test(s[i - 1]))) {
      const bare = /^https?:\/\/[^\s<>)\]]+/i.exec(s.slice(i));
      if (bare) {
        const shown = bare[0].replace(/[.,;:!?'"*_]+$/, "");
        const href = safeHref(shown, repo);
        if (href) {
          flush();
          out.push({ t: "link", href, c: [text(shown)] });
          i += shown.length;
          continue;
        }
      }
    }
    // **bold** and __bold__
    const strong = /^(\*\*|__)(?=\S)([\s\S]+?)(?<=\S)\1/.exec(s.slice(i));
    if (strong) {
      flush();
      out.push({ t: "strong", c: parseInline(strong[2], repo) });
      i += strong[0].length;
      continue;
    }
    // *italic* and _italic_ (an underscore inside a word is just a character)
    const em = /^(\*|_)(?=\S)([^*_\n]+?)(?<=\S)\1/.exec(s.slice(i));
    if (em && (ch === "*" || i === 0 || !/\w/.test(s[i - 1]))) {
      flush();
      out.push({ t: "em", c: parseInline(em[2], repo) });
      i += em[0].length;
      continue;
    }
    buf += ch === "\\" && i + 1 < s.length && /[\\`*_{}[\]()#+\-.!|<>~]/.test(s[i + 1]) ? s[++i] : ch;
    i++;
  }
  flush();
  return out;
}

/** A paragraph block, flagged `media` when it is only images (and the links around them), so it lays out as a row. */
const paragraph = (c: Inline[]): Block => {
  const onlyImages = (n: Inline): boolean => n.t === "image" || (n.t === "link" && n.c.every(onlyImages)) || (n.t === "text" && n.v.trim() === "");
  return c.some((n) => n.t === "image" || n.t === "link") && c.every(onlyImages) && c.some((n) => n.t !== "text") ? { t: "p", c, media: true } : { t: "p", c };
};

const HR = /^\s*([-*_])(\s*\1){2,}\s*$/;
const ATX = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/** The README's Markdown as blocks. Never throws; text it can't read comes out as paragraphs. */
export function parseReadme(markdown: string, repo: string): Block[] {
  const blocks: Block[] = [];
  const inline = (s: string) => parseInline(s, repo);
  const push = (b: Block) => {
    if (blocks.length < MAX_BLOCKS) blocks.push(b);
  };

  for (const seg of segments(markdown)) {
    if (seg.code) {
      if (seg.v.trim()) push({ t: "code", lang: seg.lang, v: seg.v });
      continue;
    }
    const lines = withoutHtml(seg.text).split("\n");
    let para: string[] = [];
    let quote: string[] = [];
    let list: { ordered: boolean; items: { depth: 0 | 1; c: Inline[]; raw: string }[] } | null = null;

    const endPara = () => {
      const c = inline(para.join(" ").trim());
      if (shows(c)) push(paragraph(c));
      para = [];
    };
    const endQuote = () => {
      const c = inline(quote.join(" ").trim());
      if (shows(c)) push({ t: "quote", c });
      quote = [];
    };
    const endList = () => {
      if (list && list.items.length) push({ t: "list", ordered: list.ordered, items: list.items.map(({ depth, raw }) => ({ depth, c: inline(raw) })).filter((it) => shows(it.c)) });
      list = null;
    };
    const endAll = () => {
      endPara();
      endQuote();
      endList();
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) {
        endAll();
        continue;
      }
      // setext heading: a line of text over === or ---
      const next = lines[i + 1];
      if (next !== undefined && !list && !quote.length && /^\s{0,3}=+\s*$/.test(next) && !LIST.test(line) && !ATX.test(line)) {
        endAll();
        const c = inline(line.trim());
        if (shows(c)) push({ t: "heading", level: 1, c });
        i++;
        continue;
      }
      if (next !== undefined && para.length === 0 && !list && !quote.length && /^\s{0,3}-{2,}\s*$/.test(next) && !LIST.test(line) && !ATX.test(line) && !HR.test(line)) {
        endAll();
        const c = inline(line.trim());
        if (shows(c)) push({ t: "heading", level: 2, c });
        i++;
        continue;
      }
      const atx = ATX.exec(line);
      if (atx) {
        endAll();
        const c = inline(atx[2]);
        if (shows(c)) push({ t: "heading", level: Math.min(atx[1].length, 4) as 1 | 2 | 3 | 4, c });
        continue;
      }
      if (HR.test(line)) {
        endAll();
        push({ t: "hr" });
        continue;
      }
      const q = /^\s{0,3}>\s?(.*)$/.exec(line);
      if (q) {
        endPara();
        endList();
        quote.push(q[1]);
        continue;
      }
      if (quote.length) endQuote();
      // a table: its rows read as lines of cells
      if (line.includes("|") && /^\s*\|.*\|\s*$/.test(line)) {
        endPara();
        endList();
        if (TABLE_SEP.test(line)) continue;
        const cells = line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()).filter(Boolean);
        const c = inline(cells.join(" · "));
        if (shows(c)) push(paragraph(c));
        continue;
      }
      const li = LIST.exec(line);
      if (li) {
        endPara();
        const ordered = /\d/.test(li[2]);
        const depth: 0 | 1 = li[1].replace(/\t/g, "    ").length >= 2 ? 1 : 0;
        if (list && depth === 0 && list.ordered !== ordered) endList();
        list ??= { ordered, items: [] };
        list.items.push({ depth: list.items.length ? depth : 0, c: [], raw: li[3].trim() });
        continue;
      }
      // a line indented under a list item continues it
      if (list && /^\s{2,}\S/.test(line)) {
        list.items[list.items.length - 1].raw += ` ${line.trim()}`;
        continue;
      }
      // four spaces after a blank line, outside a list: code
      if (!para.length && !list && /^( {4}|\t)/.test(line) && (i === 0 || !lines[i - 1].trim())) {
        const body: string[] = [];
        while (i < lines.length && (/^( {4}|\t)/.test(lines[i]) || !lines[i].trim())) body.push(lines[i++].replace(/^( {4}|\t)/, ""));
        i--;
        const v = body.join("\n").replace(/\s+$/, "");
        if (v) push({ t: "code", lang: null, v });
        continue;
      }
      endList();
      para.push(line.trim());
    }
    endAll();
  }
  return blocks;
}

const BADGE = /(^https:\/\/(img\.shields\.io|badgen\.net|badge\.fury\.io|codecov\.io|coveralls\.io|api\.netlify\.com|readthedocs\.org)\/)|\/badge(\.svg)?(\?|$)|\/badges?\/|\/workflows\/[^/]+\/badge\.svg/i;

/**
 * A paragraph that is only status badges (build passing, licence, version,
 * downloads, chat): a row a newcomer can't act on, which also fades into the
 * README's preview. Logos and screenshots are not badges and are kept.
 */
export function badgeRow(b: Block): boolean {
  if (b.t !== "p" || !b.media) return false;
  const srcs: string[] = [];
  const walk = (c: Inline[]) => c.forEach((n) => (n.t === "image" ? srcs.push(n.src) : n.t === "link" || n.t === "strong" || n.t === "em" ? walk(n.c) : undefined));
  walk(b.c);
  return srcs.length > 0 && srcs.every((s) => BADGE.test(s));
}
