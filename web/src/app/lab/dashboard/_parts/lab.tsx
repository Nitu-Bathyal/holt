"use client";
// PROTOTYPE, don't merge. The proposed app shell (five places, the check box
// in the top bar, account things in the avatar menu) around the proposed
// pages, with a lab bar to switch views and preview reduced motion.
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ThemeToggle } from "@/components/theme-toggle";
import { Icon } from "@/components/shell/icons";
import { CatFace } from "@/components/cat-face";
import { parseRepoInput } from "@/lib/repo";
import { Find, Home, Prs, Repos, type HomeState, type Lab, type View } from "./views";

const VIEWS: { v: View; label: string }[] = [
  { v: "home-first", label: "home: new" },
  { v: "home-issue", label: "home: pick an issue" },
  { v: "home-waiting", label: "home: PR waiting" },
  { v: "home-merged", label: "home: just merged" },
  { v: "prs", label: "your PRs" },
  { v: "find", label: "find a project" },
  { v: "repos", label: "your repos" },
];

type Place = "home" | "find" | "prs" | "repos" | "compare";
const NAV: { id: Place; label: string; icon: "home" | "find" | "pr" | "saved" | "compare"; view?: View }[] = [
  { id: "home", label: "Home", icon: "home" },
  { id: "find", label: "Find a project", icon: "find", view: "find" },
  { id: "prs", label: "Your pull requests", icon: "pr", view: "prs" },
  { id: "repos", label: "Your repos", icon: "saved", view: "repos" },
  { id: "compare", label: "Compare", icon: "compare" },
];

const placeOf = (v: View): Place => (v.startsWith("home") ? "home" : (v as Place));
const isView = (s: string | null): s is View => VIEWS.some((x) => x.v === s);

export function DashboardLab() {
  const router = useRouter();
  const [view, setView] = useState<View>("home-waiting");
  const [focus, setFocus] = useState<string | undefined>();
  const [lastHome, setLastHome] = useState<View>("home-waiting");
  const [saved, setSaved] = useState(() => new Set(["home-assistant/core", "pallets/flask"]));
  const [langs, setLangs] = useState<string[]>([]);
  const [reduced, setReduced] = useState(false);
  const [menu, setMenu] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [mobileCheck, setMobileCheck] = useState(false);
  const [repo, setRepo] = useState("");
  const [bad, setBad] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const go = useCallback((v: View, f?: string) => {
    setView(v);
    setFocus(f);
    if (v.startsWith("home")) setLastHome(v);
    setDrawer(false);
    scroller.current?.scrollTo({ top: 0 });
    const url = new URL(window.location.href);
    url.searchParams.set("view", v);
    window.history.replaceState(null, "", url);
  }, []);

  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get("view");
    // One-time sync from the address bar after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isView(v)) go(v);
  }, [go]);

  // "/" focuses the check box from anywhere, as it would on every app page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key !== "/" || t.closest("input, textarea, [contenteditable]")) return;
      e.preventDefault();
      setMobileCheck(true);
      requestAnimationFrame(() => input.current?.focus());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const lab: Lab = {
    go,
    saved,
    toggleSave: (r) => {
      const next = new Set(saved);
      if (next.has(r)) next.delete(r);
      else next.add(r);
      setSaved(next);
      // Saving your first pick moves you along the loop.
      if (view === "home-first" && !saved.has(r)) go("home-issue", r);
    },
    langs,
    setLangs,
  };

  const check = (e: React.FormEvent) => {
    e.preventDefault();
    const r = parseRepoInput(repo);
    if (!r) return setBad(true);
    router.push(`/${r.owner}/${r.repo}`);
  };

  const place = placeOf(view);
  const nav = (
    <ul className="space-y-0.5">
      {NAV.map((n) => (
        <li key={n.id}>
          {n.id === "compare" ? (
            <Link href="/compare" className="dl-item"><Icon name={n.icon} />{n.label}</Link>
          ) : (
            <button type="button" className="dl-item" aria-current={place === n.id ? "page" : undefined} onClick={() => go(n.view ?? lastHome)}>
              <Icon name={n.icon} />
              {n.label}
              {n.id === "prs" && view !== "home-first" && <span className="dl-badge" aria-label="1 needs you">1</span>}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
  const foot = (
    <div className="mt-auto flex flex-wrap gap-x-3 gap-y-1 px-3 pt-6 font-mono text-[0.76rem] text-faint">
      <Link href="/privacy" className="hover:text-ink">Privacy</Link>
      <Link href="/terms" className="hover:text-ink">Terms</Link>
      <a href="https://github.com/holt-oss/holt" className="hover:text-ink">GitHub ↗</a>
    </div>
  );

  const box = (
    <form onSubmit={check} className="dl-check" role="search">
      <span aria-hidden="true" className="pl-3 text-amber">$</span>
      <label htmlFor="dl-repo" className="sr-only">Check a repo</label>
      <input
        id="dl-repo"
        ref={input}
        value={repo}
        onChange={(e) => { setRepo(e.target.value); setBad(false); }}
        placeholder="check a repo: owner/name"
        autoComplete="off"
        spellCheck={false}
        aria-invalid={bad || undefined}
        aria-describedby={bad ? "dl-bad" : undefined}
      />
      {repo ? <button type="submit" className="h-full border-l border-line-strong px-3 text-[0.82rem] text-green hover:bg-green/10">check →</button> : <kbd className="dl-kbd hidden sm:inline">/</kbd>}
    </form>
  );

  return (
    <div className="dl" data-reduced={reduced}>
      <div className="dl-top relative">
        <button type="button" className="grid size-10 place-items-center lg:hidden" aria-label="Menu" aria-expanded={drawer} onClick={() => setDrawer(!drawer)}>
          <Icon name={drawer ? "close" : "menu"} className="size-5" />
        </button>
        <button type="button" onClick={() => go(lastHome)} className="flex shrink-0 items-center gap-2 font-mono text-[0.95rem] font-semibold lg:w-[228px]">
          <CatFace className="text-blue" />
          holt
        </button>
        <div className="hidden min-w-0 flex-1 sm:flex">{box}</div>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" className="grid size-10 place-items-center text-muted hover:text-ink sm:hidden" aria-label="Check a repo" onClick={() => { setMobileCheck(!mobileCheck); requestAnimationFrame(() => input.current?.focus()); }}>
            <Icon name="find" className="size-5" />
          </button>
          <ThemeToggle />
          <button type="button" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)} className="ml-1 grid size-9 place-items-center rounded-full bg-blue font-mono text-[0.85rem] font-bold text-on-accent">R</button>
        </div>
        {menu && (
          <div className="dl-menu" role="menu">
            <p className="px-3 pb-1 pt-2 font-sans text-[0.92rem] font-semibold">Rae Kumar</p>
            <p className="border-b border-line px-3 pb-3 font-mono text-[0.78rem] text-faint">3 AI reports left</p>
            {[["Settings", "/settings/profile"], ["AI reports", "/settings/ai-reports"], ["How Holt works", "/how-it-works"]].map(([l, h]) => (
              <a key={h} role="menuitem" href={h} className="dl-item">{l}</a>
            ))}
            <button type="button" role="menuitem" className="dl-item" onClick={() => setMenu(false)}>Sign out</button>
          </div>
        )}
      </div>
      {mobileCheck && <div className="border-b border-line bg-header p-3 sm:hidden">{box}</div>}
      {bad && <p id="dl-bad" role="alert" className="border-b border-orange/40 bg-orange/10 px-4 py-2 font-sans text-[0.88rem] text-orange">That doesn&apos;t look like a repo. Try owner/name or a github.com link.</p>}

      <div className="dl-body relative">
        <nav aria-label="App" className="dl-rail">{nav}{foot}</nav>
        {drawer && (
          <div className="dl-drawer lg:hidden">
            <nav aria-label="App">{nav}{foot}</nav>
            <button type="button" aria-label="Close menu" onClick={() => setDrawer(false)} />
          </div>
        )}
        <div ref={scroller} className="dl-scroll" onClick={() => menu && setMenu(false)}>
          <main key={`${view}-${focus ?? ""}`} className="dl-page">
            {view.startsWith("home") && <Home state={view.slice(5) as HomeState} lab={lab} focus={focus} />}
            {view === "prs" && <Prs lab={lab} />}
            {view === "find" && <Find lab={lab} />}
            {view === "repos" && <Repos lab={lab} />}
          </main>
        </div>
      </div>

      <div className="dl-lab" aria-label="Prototype views">
        <span className="px-2 text-faint">lab</span>
        {VIEWS.map((x) => (
          <button key={x.v} type="button" aria-pressed={view === x.v} onClick={() => go(x.v)}>{x.label}</button>
        ))}
        <button type="button" aria-pressed={reduced} onClick={() => setReduced(!reduced)}>reduced motion</button>
      </div>
    </div>
  );
}
