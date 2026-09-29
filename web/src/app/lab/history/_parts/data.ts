// PROTOTYPE, don't merge. Made-up contribution histories for /lab/history:
// three people, from one merged PR to 312. Everything here is a field Holt
// has today (/v1/me/contributions) or one docs/design/HISTORY.md marks as new:
// `files` (the paths a PR touched), `language`, `typicalMergeDays`, `team`
// (the "not counted" repos) and `before` (the first merged PR ever).
//
// The lab's "today" is the end of Hacktoberfest, so the October views have
// something to show. Dates are fixed so server and client render the same.

export const TODAY = "2026-10-31T12:00:00Z";
export const WINDOW_START = "2025-11-01T00:00:00Z";

export type PrState = "merged" | "closed" | "open";
export type Verdict = "Worth your time" | "Not worth your time" | "Not enough evidence";

export interface Pr {
  repo: string;
  number: number;
  title: string;
  state: PrState;
  opened: string;
  /** Merged or closed at. */
  done?: string;
  /** NEW: the paths the PR touched. */
  files: string[];
  viaHolt?: boolean;
}

export interface Repo {
  /** NEW for repos Holt hasn't checked: GitHub's primary language. */
  language: string;
  /** Holt's latest verdict, when a current report exists. */
  verdict?: Verdict;
  /** From that report: outside PRs merged, of those that got an answer. */
  outsideMerged?: number;
  outsideTried?: number;
  /** NEW: how long an outside PR that gets merged typically waits. */
  typicalMergeDays?: number;
  /** NEW: a personal or team project, left out of every count unless the owner counts it. */
  team?: boolean;
}

export type PersonaId = "newcomer" | "student" | "veteran";

export interface Persona {
  id: PersonaId;
  login: string;
  prs: Pr[];
  repos: Record<string, Repo>;
  /** NEW: the first merged PR ever, when it's older than the year Holt reads. */
  before?: { repo: string; number: number; date: string };
}

const REPOS: Record<string, Repo> = {
  "pallets/click": { language: "Python", verdict: "Worth your time", outsideMerged: 19, outsideTried: 42, typicalMergeDays: 5 },
  "Textualize/rich": { language: "Python", verdict: "Worth your time", outsideMerged: 21, outsideTried: 60, typicalMergeDays: 4 },
  "astral-sh/ruff": { language: "Rust", verdict: "Worth your time", outsideMerged: 70, outsideTried: 120, typicalMergeDays: 2 },
  "home-assistant/core": { language: "Python", verdict: "Worth your time", outsideMerged: 43, outsideTried: 58, typicalMergeDays: 6 },
  "NixOS/nixpkgs": { language: "Nix", verdict: "Worth your time", outsideMerged: 35, outsideTried: 57, typicalMergeDays: 3 },
  "microsoft/vscode": { language: "TypeScript", verdict: "Not worth your time", outsideMerged: 7, outsideTried: 81, typicalMergeDays: 12 },
  "excalidraw/excalidraw": { language: "TypeScript", verdict: "Not worth your time", outsideMerged: 11, outsideTried: 47, typicalMergeDays: 9 },
  "neovim/neovim": { language: "Vim Script", verdict: "Worth your time", outsideMerged: 31, outsideTried: 70, typicalMergeDays: 5 },
  "rust-lang/rust-clippy": { language: "Rust" },
  "campus-devs/site": { language: "TypeScript", team: true },
  "nix-community/home-manager": { language: "Nix", team: true },
};

const pick = (names: string[]) => Object.fromEntries(names.map((n) => [n, REPOS[n]]));

// ---- the newcomer: one PR, found on Holt, merged in two days ----------------------

const newcomer: Persona = {
  id: "newcomer",
  login: "mei-l",
  repos: pick(["pallets/click"]),
  prs: [
    {
      repo: "pallets/click", number: 2811, title: "Document how to test a command that reads from stdin",
      state: "merged", opened: "2026-10-04T15:20:00Z", done: "2026-10-06T09:05:00Z",
      files: ["docs/testing.rst"], viaHolt: true,
    },
  ],
};

// ---- the student: 15 PRs in six repos, plus a campus team site ---------------------

const s = (repo: string, number: number, title: string, state: PrState, opened: string, done: string | undefined, files: string[], viaHolt = false): Pr =>
  ({ repo, number, title, state, opened, done, files, viaHolt });

const student: Persona = {
  id: "student",
  login: "rae-builds",
  repos: pick(["Textualize/rich", "pallets/click", "microsoft/vscode", "excalidraw/excalidraw", "astral-sh/ruff", "home-assistant/core", "campus-devs/site"]),
  prs: [
    s("Textualize/rich", 3390, "Fix a typo in the Live docs", "merged", "2025-12-03T10:00:00Z", "2025-12-05T16:00:00Z", ["docs/source/live.rst"]),
    s("campus-devs/site", 41, "Add the events page", "merged", "2025-12-10T09:00:00Z", "2025-12-10T20:00:00Z", ["src/pages/events.astro"]),
    s("Textualize/rich", 3402, "Add a Table.grid example", "merged", "2026-01-11T18:30:00Z", "2026-01-20T11:00:00Z", ["docs/source/tables.rst", "examples/table_grid.py"]),
    s("pallets/click", 2760, "Help text wraps badly for long option names", "closed", "2026-02-02T08:00:00Z", "2026-02-19T08:00:00Z", ["src/click/formatting.py"]),
    s("pallets/click", 2771, "Test wrapped help text for long option names", "merged", "2026-02-24T14:00:00Z", "2026-02-27T10:00:00Z", ["tests/test_formatting.py"]),
    s("campus-devs/site", 44, "Dark mode", "merged", "2026-03-01T12:00:00Z", "2026-03-02T12:00:00Z", ["src/styles/theme.css"]),
    s("microsoft/vscode", 240118, "Fix tooltip clipping in the Problems panel", "merged", "2026-03-15T19:00:00Z", "2026-03-19T13:00:00Z", ["src/vs/workbench/contrib/markers/browser/markersTable.ts"]),
    s("excalidraw/excalidraw", 9120, "Keep arrow labels readable in dark mode", "closed", "2026-04-02T09:00:00Z", "2026-04-30T09:00:00Z", ["packages/excalidraw/renderer/staticScene.ts"]),
    s("astral-sh/ruff", 17310, "PLR1714: add a fix example to the rule docs", "merged", "2026-04-20T07:10:00Z", "2026-04-20T12:25:00Z", ["crates/ruff_linter/src/rules/pylint/rules/repeated_equality_comparison.rs"]),
    s("astral-sh/ruff", 17522, "Format: keep comments before an else", "merged", "2026-05-06T16:00:00Z", "2026-05-09T09:00:00Z", ["crates/ruff_python_formatter/src/statement/stmt_if.rs"]),
    s("home-assistant/core", 146201, "Shelly: fix a typo in the config flow strings", "merged", "2026-06-10T11:00:00Z", "2026-06-12T08:00:00Z", ["homeassistant/components/shelly/strings.json"], true),
    s("campus-devs/site", 52, "Sponsors strip", "merged", "2026-06-20T10:00:00Z", "2026-06-21T10:00:00Z", ["src/components/Sponsors.astro"]),
    s("home-assistant/core", 147390, "Roborock: expose mop intensity as a select", "merged", "2026-07-01T17:00:00Z", "2026-07-16T15:00:00Z", ["homeassistant/components/roborock/select.py", "tests/components/roborock/test_select.py"]),
    s("Textualize/rich", 3471, "Tests for Markdown tables with alignment", "merged", "2026-08-12T13:00:00Z", "2026-08-14T09:00:00Z", ["tests/test_markdown.py"]),
    s("home-assistant/core", 152044, "Roborock: add a dock error sensor", "closed", "2026-09-08T10:00:00Z", "2026-09-30T10:00:00Z", ["homeassistant/components/roborock/sensor.py"]),
    s("astral-sh/ruff", 20411, "Docs: an example for per-file-target-version", "merged", "2026-10-05T08:00:00Z", "2026-10-06T10:00:00Z", ["docs/configuration.md"]),
    s("home-assistant/core", 154210, "Roborock: water box sensor", "open", "2026-10-18T12:00:00Z", undefined, ["homeassistant/components/roborock/sensor.py", "tests/components/roborock/test_sensor.py"]),
    s("pallets/click", 2830, "Shell completion for choices with spaces", "open", "2026-10-27T16:00:00Z", undefined, ["src/click/shell_completion.py"]),
  ],
};

// ---- the veteran: 312 PRs, mostly nixpkgs version bumps ----------------------------

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PY = ["aiohttp", "attrs", "black", "boto3", "cryptography", "django", "fastapi", "httpx", "hypothesis", "jinja2", "lxml", "mypy", "numpy",
  "pandas", "pillow", "pydantic", "pytest", "pyyaml", "requests", "rich", "ruff-lsp", "scipy", "sqlalchemy", "starlette", "textual", "tox", "typer",
  "uvicorn", "websockets", "yarl", "zeroconf", "aiofiles", "anyio", "click", "coverage", "flask", "greenlet", "markdown", "orjson", "pygments"];
const TOOLS = ["bat", "btop", "delta", "dust", "eza", "fd", "fzf", "gh", "hyperfine", "jq", "just", "lazygit", "ripgrep", "starship", "tokei", "uv",
  "yazi", "zellij", "zoxide", "atuin"];

interface Shape { title: string; files: string[] }

function makeVeteran(): Persona {
  const r = mulberry32(58210);
  const pickOne = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const ver = () => `${1 + Math.floor(r() * 4)}.${Math.floor(r() * 30)}.${Math.floor(r() * 12)}`;
  const start = Date.parse(WINDOW_START);
  const span = Date.parse(TODAY) - start;
  const out: Pr[] = [];

  const add = (repo: string, n: number, base: number, shape: () => Shape, rate: { closed: number; mergeDays: number }) => {
    const times = Array.from({ length: n }, () => start + r() * span).sort((a, b) => a - b);
    times.forEach((t, i) => {
      const { title, files } = shape();
      const recent = Date.parse(TODAY) - t < 20 * 864e5;
      const roll = r();
      const state: PrState = recent && roll < 0.35 ? "open" : roll > 1 - rate.closed ? "closed" : "merged";
      const took = state === "closed" ? 3 + r() * 30 : 0.08 + r() * r() * rate.mergeDays * 3;
      const done = state === "open" ? undefined : new Date(Math.min(t + took * 864e5, Date.parse(TODAY) - 36e5)).toISOString();
      out.push({ repo, number: base + i * 37 + Math.floor(r() * 30), title, state, opened: new Date(t).toISOString(), done, files });
    });
  };

  add("NixOS/nixpkgs", 244, 356400, () => {
    if (r() < 0.62) {
      const p = pickOne(PY);
      return { title: `python3Packages.${p}: ${ver()} -> ${ver()}`, files: [`pkgs/development/python-modules/${p}/default.nix`] };
    }
    const t = pickOne(TOOLS);
    return { title: `${t}: ${ver()} -> ${ver()}`, files: [`pkgs/by-name/${t.slice(0, 2)}/${t}/package.nix`] };
  }, { closed: 0.07, mergeDays: 3 });
  add("home-assistant/core", 22, 131000, () => {
    const c = pickOne(["zha", "mqtt", "matter", "esphome"]);
    const f = pickOne(["sensor.py", "light.py", "config_flow.py", "climate.py"]);
    return { title: `${c}: tidy ${f.replace(".py", "")} entities`, files: [`homeassistant/components/${c}/${f}`, `tests/components/${c}/test_${f}`] };
  }, { closed: 0.14, mergeDays: 6 });
  add("astral-sh/ruff", 14, 15100, () => {
    const d = pickOne(["flake8_bugbear", "pyupgrade", "pylint"]);
    const f = pickOne(["unused_loop_variable.rs", "deprecated_import.rs", "useless_return.rs", "zip_without_strict.rs"]);
    return { title: `[${d}] fix a false positive in ${f.replace(".rs", "")}`, files: [`crates/ruff_linter/src/rules/${d}/rules/${f}`] };
  }, { closed: 0.03, mergeDays: 2 });
  add("rust-lang/rust-clippy", 9, 13800, () => {
    const d = pickOne(["methods", "loops", "matches"]);
    return { title: `${d}: suggest a clearer rewrite`, files: [`clippy_lints/src/${d}/mod.rs`, `tests/ui/${d}.rs`] };
  }, { closed: 0.22, mergeDays: 4 });
  add("neovim/neovim", 8, 30100, () => {
    const f = pickOne(["runtime/lua/vim/lsp/buf.lua", "runtime/lua/vim/lsp/util.lua", "src/nvim/eval/funcs.c"]);
    return { title: `fix: ${f.split("/").pop()} edge case`, files: [f] };
  }, { closed: 0.38, mergeDays: 5 });
  add("pallets/click", 6, 2700, () => ({ title: "Typing: tighten a return type", files: [pickOne(["src/click/core.py", "src/click/types.py"])] }), { closed: 0.1, mergeDays: 5 });
  add("Textualize/rich", 5, 3300, () => ({ title: "Faster cell width for ASCII", files: ["rich/cells.py"] }), { closed: 0.1, mergeDays: 4 });
  add("microsoft/vscode", 4, 228000, () => ({ title: "Terminal: keep the link hover on resize", files: ["src/vs/workbench/contrib/terminal/browser/terminalInstance.ts"] }), { closed: 0.6, mergeDays: 12 });
  add("nix-community/home-manager", 25, 5100, () => {
    const p = pickOne(["git", "zsh", "helix", "wezterm", "atuin"]);
    return { title: `${p}: add an option`, files: [`modules/programs/${p}.nix`] };
  }, { closed: 0.02, mergeDays: 1 });

  out.sort((a, b) => Date.parse(a.opened) - Date.parse(b.opened));
  // One merge in a repo that rarely takes outside PRs, so "you got in" has something to show.
  const vs = out.find((x) => x.repo === "microsoft/vscode")!;
  Object.assign(vs, { state: "merged", done: new Date(Date.parse(vs.opened) + 9 * 864e5).toISOString() });
  return {
    id: "veteran",
    login: "tkoh",
    repos: pick(["NixOS/nixpkgs", "home-assistant/core", "astral-sh/ruff", "rust-lang/rust-clippy", "neovim/neovim", "pallets/click", "Textualize/rich", "microsoft/vscode", "nix-community/home-manager"]),
    prs: out,
    before: { repo: "NixOS/nixpkgs", number: 58210, date: "2019-03-12T00:00:00Z" },
  };
}

export const PERSONAS: Record<PersonaId, Persona> = { newcomer, student, veteran: makeVeteran() };
