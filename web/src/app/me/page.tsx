// PROTOTYPE (throwaway, branch prototype-signed-in-home): three layouts for the
// signed-in home, switchable with ?variant=A|B|C, and ?state=new|returning.
// state=new pretends the account is a day old; state=returning (mock only)
// saves a profile and connects a fake GitHub account so every section has data.
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { PasteBox } from "@/components/paste-box";
import { PrototypeSwitcher } from "@/components/prototype-switcher";
import { VerdictPill } from "@/components/report/verdict-pill";
import { CatFace } from "@/components/cat-face";
import { MOCK, connectGitHub, discover, contributions, getProfile, history, me, recommendations, saveProfile } from "@/lib/api";
import { landedPct } from "@/lib/contributions";
import { timeAgo } from "@/lib/format";
import { currentUser } from "@/lib/session";
import type { Contributions, DiscoverRepo, HistoryItem, Recommendation } from "@/lib/types";

const VARIANTS = [
  { key: "A", name: "one column" },
  { key: "B", name: "desk + side rail" },
  { key: "C", name: "next step first" },
  { key: "D", name: "next step + themed rows" },
];

interface Data {
  name: string;
  isNew: boolean;
  balance: number | null;
  canClaim: boolean;
  hasProfile: boolean;
  connected: boolean;
  checks: HistoryItem[];
  picks: Recommendation[];
  prs: Contributions | null;
}

async function load(userId: string, name: string, state: string): Promise<Data> {
  if (state === "returning" && MOCK) {
    await saveProfile(userId, { languages: ["python", "typescript"], topics: ["cli"], days: 7, contributions: ["docs", "tests"], level: "newcomer", adult_confirmed: true });
    await connectGitHub(userId, "583231", false);
  }
  const [m, h, r, c, p] = await Promise.all([me(userId), history(userId, 5), recommendations(userId, 3), contributions(userId), getProfile(userId)]);
  const fresh = state === "new";
  return {
    name,
    isNew: fresh,
    balance: m.ok ? m.data.credits.balance : null,
    canClaim: m.ok ? m.data.credits.can_claim : false,
    hasProfile: !fresh && p.ok && !!p.data.profile,
    connected: !fresh && c.ok,
    checks: fresh || !h.ok ? [] : h.data.items.slice(0, 5),
    picks: fresh || !r.ok ? [] : r.data.picks.slice(0, 3),
    prs: fresh || !c.ok ? null : c.data,
  };
}

// ---- shared blocks ---------------------------------------------------------

function Steps({ d }: { d: Data }) {
  const steps = [
    { done: true, label: "Sign in", note: "3 free AI reports are in your account.", href: null },
    { done: d.checks.length > 0, label: "Check a repo you're thinking about", note: "It's saved here, so you can come back to it.", href: "#check" },
    { done: d.hasProfile, label: "Tell Holt what you're after", note: "Languages and the time you have. 30 seconds.", href: "/settings#profile" },
    { done: d.connected, label: "Connect GitHub (optional)", note: "See your pull requests and whether they landed.", href: "/connect" },
  ];
  const left = steps.filter((s) => !s.done).length;
  if (left === 0) return null;
  return (
    <section aria-labelledby="steps-h" className="border border-blue/50 bg-panel p-5 shadow-soft sm:p-6">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="steps-h" className="text-[1.05rem] font-semibold tracking-tight">Get set up</h2>
        <span className="text-[0.75rem] text-faint">{steps.length - left} of {steps.length} done</span>
      </div>
      <div className="mt-3 h-1 bg-line"><div className="h-1 bg-blue" style={{ width: `${((steps.length - left) / steps.length) * 100}%` }} /></div>
      <ol className="mt-4 space-y-3">
        {steps.map((s) => (
          <li key={s.label} className="grid grid-cols-[1.5rem_1fr] gap-x-2">
            <span aria-hidden="true" className={s.done ? "text-green" : "text-faint"}>{s.done ? "✓" : "○"}</span>
            <span>
              {s.done || !s.href ? (
                <span className={s.done ? "text-muted line-through decoration-line-strong" : ""}>{s.label}</span>
              ) : (
                <Link href={s.href} className="font-semibold text-blue hover:underline">{s.label}</Link>
              )}
              {!s.done && <span className="block font-sans text-[0.85rem] text-muted">{s.note}</span>}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Section({ title, more, children }: { title: string; more?: { href: string; label: string }; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-baseline justify-between gap-4 border-b border-line pb-2">
        <h2 className="text-[1.05rem] font-semibold tracking-tight">{title}</h2>
        {more && <Link href={more.href} className="text-[0.78rem] text-blue hover:underline">{more.label}</Link>}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="border border-dashed border-line-strong p-5 font-sans text-[0.9rem] text-muted">{children}</div>;
}

function Picks({ d }: { d: Data }) {
  return (
    <Section title="Picked for you" more={d.picks.length ? { href: "/for-you", label: "all picks" } : undefined}>
      {d.picks.length === 0 ? (
        <Empty>
          Tell Holt your languages and it picks repos where maintainers are replying right now.{" "}
          <Link href="/settings#profile" className="text-link">Set it up</Link>, or <Link href="/find" className="text-link">find a project</Link>.
        </Empty>
      ) : (
        <ul className="divide-y divide-line">
          {d.picks.map((p) => (
            <li key={p.repo} className="py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <Link href={`/${p.repo}`} className="font-semibold hover:text-blue">{p.repo}</Link>
                <VerdictPill headline={p.headline} tone={p.tone} />
              </div>
              <p className="mt-1 line-clamp-2 font-sans text-[0.85rem] text-muted">{p.reason}</p>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function Checks({ d }: { d: Data }) {
  return (
    <Section title="Your recent checks" more={d.checks.length ? { href: "/me/history", label: "all checks" } : undefined}>
      {d.checks.length === 0 ? (
        <Empty>Repos you check while signed in are kept here. Try one above, or <Link href="/home-assistant/core" className="text-link">home-assistant/core</Link>.</Empty>
      ) : (
        <ul className="divide-y divide-line">
          {d.checks.map((h) => (
            <li key={h.job_id}>
              <Link href={`/${h.repo}${h.mode === "ai" ? "?mode=ai" : ""}`} className="flex items-center justify-between gap-3 py-3 hover:bg-panel-2">
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{h.repo}</span>
                  <span className="text-[0.75rem] text-faint">{timeAgo(h.created_at)}</span>
                </span>
                {h.headline && h.tone && <VerdictPill headline={h.headline} tone={h.tone} />}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function Prs({ d, compact = false }: { d: Data; compact?: boolean }) {
  const waiting = d.prs?.pull_requests.filter((p) => p.state === "open").slice(0, compact ? 2 : 3) ?? [];
  const pct = d.prs ? landedPct(d.prs.summary) : null;
  return (
    <Section title="Your pull requests" more={d.prs ? { href: "/me/contributions", label: "all of them" } : undefined}>
      {!d.prs ? (
        <Empty>
          Connect GitHub to see the pull requests you&apos;ve opened, and whether each repo is worth your time.{" "}
          <Link href="/connect" className="text-link">Connect GitHub</Link>
        </Empty>
      ) : (
        <>
          <p className="font-sans text-[0.9rem]">
            <strong>{d.prs.summary.opened}</strong> opened, <strong>{d.prs.summary.merged}</strong> merged,{" "}
            <strong>{d.prs.summary.waiting}</strong> waiting{pct != null && <>, {pct}% landed</>}.
          </p>
          {waiting.length > 0 && (
            <ul className="mt-2 divide-y divide-line">
              {waiting.map((p) => (
                <li key={p.url} className="py-2.5 text-[0.85rem]">
                  <a href={p.url} className="font-semibold hover:text-blue">{p.repo}#{p.number}</a>
                  <span className="block truncate font-sans text-muted">{p.title}</span>
                  <span className="text-[0.72rem] text-faint">opened {timeAgo(p.created_at)}, no decision yet</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Section>
  );
}

function Credits({ d }: { d: Data }) {
  if (d.balance == null) return null;
  return (
    <p className="font-sans text-[0.88rem] text-muted">
      <strong className="text-ink">{d.balance}</strong> free AI {d.balance === 1 ? "report" : "reports"} left.{" "}
      {d.canClaim ? <Link href="/settings" className="text-link">Claim this week&apos;s free one</Link> : <Link href="/settings" className="text-link">How they work</Link>}
    </p>
  );
}

function Hello({ d, small = false }: { d: Data; small?: boolean }) {
  const first = d.name.split(" ")[0];
  return (
    <div>
      <h1 className={`display ${small ? "text-[clamp(1.6rem,5vw,2.2rem)]" : "text-[clamp(2rem,6vw,2.8rem)]"}`}>
        {d.isNew ? `Welcome, ${first}` : `Welcome back, ${first}`}
      </h1>
      <p className="prose-sans mt-2 text-muted">
        {d.isNew ? "Check a repo before you put work into it. Everything you check is kept here." : "Check another repo, or pick up where you left off."}
      </p>
    </div>
  );
}

// ---- variants --------------------------------------------------------------

function VariantA({ d }: { d: Data }) {
  return (
    <div className="wrap max-w-3xl space-y-10 py-10 sm:py-12">
      <Hello d={d} />
      <div id="check"><PasteBox size="md" examples={d.isNew} /></div>
      {(d.isNew || !d.connected || !d.hasProfile) && <Steps d={d} />}
      <Picks d={d} />
      <Checks d={d} />
      <Prs d={d} />
      <Credits d={d} />
    </div>
  );
}

function VariantB({ d }: { d: Data }) {
  return (
    <div className="wrap py-10 sm:py-12">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-10">
          <Hello d={d} />
          <div id="check"><PasteBox size="md" examples={d.isNew} /></div>
          <Picks d={d} />
          <Checks d={d} />
        </div>
        <aside className="space-y-8 lg:sticky lg:top-24 lg:self-start">
          <Steps d={d} />
          <div className="border border-line-strong bg-panel p-5 shadow-soft"><Credits d={d} /></div>
          <Prs d={d} compact />
        </aside>
      </div>
    </div>
  );
}

function nextStep(d: Data): { title: string; body: string; href: string; cta: string } {
  if (d.checks.length === 0) return { title: "Check your first repo", body: "Paste one you're thinking of contributing to. Holt reads its recent pull requests and tells you if outsiders get merged.", href: "#check", cta: "check a repo" };
  const waiting = d.prs?.pull_requests.find((p) => p.state === "open");
  if (waiting) return { title: `Your pull request to ${waiting.repo} is still waiting`, body: `Opened ${timeAgo(waiting.created_at)} with no decision yet. See how long this repo usually takes to reply.`, href: `/${waiting.repo}`, cta: "see the repo's report" };
  if (!d.hasProfile) return { title: "Tell Holt what you're after", body: "Your languages and the time you have. Then Holt picks repos where maintainers are replying right now.", href: "/settings#profile", cta: "set it up · 30 seconds" };
  if (d.picks[0]) return { title: `Try ${d.picks[0].repo}`, body: d.picks[0].reason, href: `/${d.picks[0].repo}`, cta: "see why" };
  return { title: "Find a project", body: "Tell Holt what you know and it finds repos worth your time.", href: "/find", cta: "find a project" };
}

function VariantC({ d }: { d: Data }) {
  const n = nextStep(d);
  return (
    <div className="wrap max-w-5xl space-y-10 py-10 sm:py-12">
      <Hello d={d} small />
      <section className="grid gap-5 border border-line-strong bg-panel p-6 shadow-card sm:grid-cols-[auto_1fr] sm:p-8">
        <CatFace mood={d.isNew ? "adoring" : "thinking"} className="text-[1.8rem]" />
        <div>
          <p className="text-[0.8rem] text-blue">Your next step</p>
          <h2 className="mt-1 text-[1.4rem] font-semibold tracking-tight">{n.title}</h2>
          <p className="prose-sans mt-2 max-w-2xl text-muted">{n.body}</p>
          {n.href === "#check" ? (
            <div id="check" className="mt-5"><PasteBox size="md" /></div>
          ) : (
            <Link href={n.href} className="btn-primary mt-5 inline-flex">{n.cta}</Link>
          )}
        </div>
      </section>
      {n.href !== "#check" && <div id="check"><PasteBox size="md" examples={false} /></div>}
      <div className="grid gap-10 md:grid-cols-3">
        <Picks d={d} />
        <Checks d={d} />
        <Prs d={d} compact />
      </div>
      <Credits d={d} />
    </div>
  );
}

// ---- D: rows like a streaming app ------------------------------------------
// Placeholder cards; the real ones come from the find-page card redesign.

type Card = { repo: string; headline: string; tone: DiscoverRepo["tone"]; line: string };

function Row({ title, note, cards, needs }: { title: string; note?: string; cards: Card[]; needs?: string }) {
  return (
    <section>
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-[1.05rem] font-semibold tracking-tight">{title}</h2>
        {note && <span className="text-[0.75rem] text-faint">{note}</span>}
      </div>
      <ul className="-mx-4 mt-3 flex snap-x gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
        {needs ? (
          <li className="w-64 shrink-0 snap-start border border-dashed border-orange/60 p-4 font-sans text-[0.8rem] text-orange">Needs {needs}</li>
        ) : cards.length === 0 ? (
          <li className="w-64 shrink-0 border border-dashed border-line-strong p-4 font-sans text-[0.85rem] text-muted">Nothing here yet.</li>
        ) : cards.map((c) => (
          <li key={c.repo} className="w-64 shrink-0 snap-start border border-line-strong bg-panel p-4 shadow-soft">
            <Link href={`/${c.repo}`} className="block truncate font-semibold hover:text-blue">{c.repo}</Link>
            <VerdictPill headline={c.headline} tone={c.tone} className="mt-2" />
            <p className="mt-2 line-clamp-2 font-sans text-[0.8rem] text-muted">{c.line}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

async function VariantD({ d }: { d: Data }) {
  const [welcoming, trending] = await Promise.all([discover("welcoming", null, null, 60), discover("trending", null, null, 12)]);
  const all = welcoming.ok ? welcoming.data.repos : [];
  const langs = ["Python", "TypeScript"];
  const toCard = (r: DiscoverRepo, line?: string): Card => ({ repo: r.repo, headline: r.headline, tone: r.tone, line: line ?? r.description ?? r.reason });
  const hours = (r: DiscoverRepo) => r.stats.median_first_response_hours ?? 1e9;
  const fastest = [...all].sort((a, b) => hours(a) - hours(b)).slice(0, 10)
    .map((r) => toCard(r, r.stats.median_first_response_hours != null ? `Maintainers usually reply within ${Math.max(1, Math.round(hours(r)))} hours.` : undefined));
  const n = nextStep(d);
  return (
    <div className="wrap max-w-6xl space-y-9 py-10 sm:py-12">
      <Hello d={d} small />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="border border-line-strong bg-panel p-5 shadow-card sm:p-6">
          <p className="text-[0.8rem] text-blue">Your next step</p>
          <h2 className="mt-1 text-[1.2rem] font-semibold tracking-tight">{n.title}</h2>
          <p className="prose-sans mt-2 text-[0.95rem] text-muted">{n.body}</p>
          {n.href !== "#check" && <Link href={n.href} className="btn-primary mt-4 inline-flex">{n.cta}</Link>}
        </section>
        <div id="check" className="self-center"><PasteBox size="md" examples={d.isNew} /></div>
      </div>
      {d.isNew && <Steps d={d} />}
      <Row title="Picked for you" note="2 free, the rest with Pro" cards={d.picks.map((p) => ({ repo: p.repo, headline: p.headline, tone: p.tone, line: p.reason }))} />
      {d.checks.length > 0 && <Row title="Your recent checks" cards={d.checks.filter((h) => h.headline && h.tone).map((h) => ({ repo: h.repo, headline: h.headline!, tone: h.tone!, line: `Checked ${timeAgo(h.created_at)}` }))} />}
      <Row title="Saved" needs="the save-a-repo API (another worker is building it)" cards={[]} />
      {langs.map((l) => (
        <Row key={l} title={`Welcoming ${l} repos`} note="from your profile" cards={all.filter((r) => r.language === l).slice(0, 10).map((r) => toCard(r))} />
      ))}
      <Row title="Fastest replies" cards={fastest} />
      <Row title="Quick wins for an evening" needs="server work: starter issues across repos, sized for a few hours" cards={[]} />
      <Row title="Hacktoberfest" needs="a cheap read of Hacktoberfest repos (today /hacktoberfest runs a find job)" cards={[]} />
      <Row title="Trending on Holt" note="most checked this week" cards={trending.ok ? trending.data.repos.map((r) => toCard(r, `${r.checked_this_week ?? "Many"} people checked it this week.`)) : []} />
      <Credits d={d} />
    </div>
  );
}

export default async function MePrototype({ searchParams }: PageProps<"/me">) {
  const user = await currentUser();
  if (!user) redirect("/signin?callbackUrl=/me");
  const sp = await searchParams;
  const variant = typeof sp.variant === "string" ? sp.variant : "A";
  const d = await load(user.id, user.name || "there", typeof sp.state === "string" ? sp.state : "returning");
  return (
    <>
      {variant === "A" && <VariantA d={d} />}
      {variant === "B" && <VariantB d={d} />}
      {variant === "C" && <VariantC d={d} />}
      {variant === "D" && <VariantD d={d} />}
      <Suspense><PrototypeSwitcher variants={VARIANTS} /></Suspense>
    </>
  );
}
