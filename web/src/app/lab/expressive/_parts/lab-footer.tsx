"use client";

// PROTOTYPE, pattern 7: a footer with a sign-off. One cat carries it: its eyes
// follow the pointer across the footer, it reads along as you type a repo,
// cheers when the repo looks right, puzzles when it doesn't, and goes soft
// over the open-source links. The sign-off line waves once when it comes into
// view (letters bob; none is ever hidden). The last call to action is a
// githolt.com/ address bar, the URL trick as a form. Below: the repos Holt
// checked most recently, drifting past (static under reduced motion), and the
// links in three plain groups.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { CatMood } from "@/lib/cat";
import { parseRepoInput } from "@/lib/repo";
import { GITHUB_REPO_URL, LEGAL_PAGES } from "@/lib/site";
import { LabCat } from "./lab-cat";
import { useReduced, useSeen } from "./motion";

const SIGN_OFF = "go get merged.";

export function LabFooter({ recent, checked }: { recent: { repo: string; ago: string }[]; checked: number }) {
  const reduced = useReduced();
  const router = useRouter();
  const { ref, seen } = useSeen<HTMLElement>("0px 0px -20% 0px");
  const [look, setLook] = useState(0);
  const [hover, setHover] = useState<CatMood | null>(null);
  const [pet, setPet] = useState(false);
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [waves, setWaves] = useState(0);
  const catRef = useRef<HTMLButtonElement>(null);

  const ref_ = parseRepoInput(value);
  const puzzled = value.trim().length > 0 && !ref_ && (/\s/.test(value.trim()) || value.trim().length > 8);
  const mood: CatMood = pet
    ? "adoring"
    : busy
      ? "determined"
      : error || puzzled
        ? "thinking"
        : ref_
          ? "celebrating"
          : hover ?? "ready";
  // In the field, the eyes follow the caret along it; elsewhere, the pointer.
  const gaze = focused ? (value ? Math.min(1, value.length / 28) * 2 - 1 : 0.6) : look;

  const onMove = (e: React.PointerEvent) => {
    if (reduced || e.pointerType !== "mouse" || !catRef.current) return;
    const r = catRef.current.getBoundingClientRect();
    setLook(Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (innerWidth * 0.35))));
  };

  const go = (input: string) => {
    const r = parseRepoInput(input);
    if (!r) {
      setError("That doesn't look like a repo. Try pallets/flask or a github.com link.");
      return;
    }
    setError("");
    setBusy(true);
    router.push(`/${r.owner}/${r.repo}`);
  };

  const hot = (m: CatMood) => ({ onPointerEnter: () => setHover(m), onPointerLeave: () => setHover(null), onFocus: () => setHover(m), onBlur: () => setHover(null) });

  return (
    <footer ref={ref} onPointerMove={onMove} className="xp-footer relative mt-auto overflow-clip border-t border-line bg-panel">
      <div className="wrap pb-10 pt-14 md:pt-20">
        {/* Sign-off */}
        <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
          <div className="min-w-0">
            <p
              className="xp-signoff display text-[clamp(2.8rem,8vw,5.6rem)] text-ink"
              data-waving={seen || waves > 0}
              onPointerEnter={() => !reduced && setWaves((n) => n + 1)}
            >
              <span className="sr-only">{SIGN_OFF}</span>
              <span key={`${seen}-${waves}`} aria-hidden="true">
                {/* Letters bob one by one; words stay whole so lines only break between them. */}
                {SIGN_OFF.split(" ").map((word, w, all) => {
                  const start = all.slice(0, w).join(" ").length + (w ? 1 : 0);
                  return (
                    <span key={w} className="whitespace-nowrap">
                      {[...word].map((ch, i) => (
                        <span key={i} className="xp-wave" style={{ ["--i" as string]: start + i }}>
                          {ch}
                        </span>
                      ))}
                      {w < all.length - 1 ? " " : ""}
                    </span>
                  );
                })}
              </span>
            </p>
            <p className="mt-4 max-w-[560px] font-sans text-[1.05rem] text-muted">
              Paste a repo. You&apos;ll know before you write a line of code.
            </p>
          </div>
          <button
            ref={catRef}
            type="button"
            aria-label="Pet the cat"
            onClick={() => {
              setPet(true);
              window.setTimeout(() => setPet(false), 900);
            }}
            className="xp-footer-cat order-first text-[clamp(2rem,5vw,3.6rem)] leading-none md:order-none md:mb-2"
          >
            <LabCat mood={mood} look={gaze} />
          </button>
        </div>

        {/* Last call to action: the URL trick as a form. */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            go(value);
          }}
          className="xp-addr mt-10 grid max-w-[820px] grid-cols-[auto_minmax(0,1fr)_auto] items-stretch border border-line-strong bg-bg focus-within:border-blue"
        >
          <label htmlFor="footer-repo" className="flex items-center pl-4 text-[0.95rem] text-faint sm:text-[1.05rem]">
            githolt.com/
          </label>
          <input
            id="footer-repo"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (error) setError("");
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            placeholder="owner/repo"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "footer-repo-error" : undefined}
            className="h-14 min-w-0 bg-transparent px-0.5 text-[0.95rem] text-ink outline-none placeholder:text-faint sm:text-[1.05rem]"
          />
          <button type="submit" disabled={busy} {...hot("celebrating")} className="border-l border-line-strong px-4 font-semibold text-blue transition-colors hover:bg-blue hover:text-on-accent sm:px-6">
            {busy ? "checking…" : "check →"}
          </button>
        </form>
        <p id="footer-repo-error" role={error ? "alert" : undefined} className="mt-2 min-h-6 font-sans text-[0.9rem] text-orange">
          {error}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="font-sans text-[0.95rem] text-muted">No repo yet?</span>
          <Link href="/find" {...hot("celebrating")} className="bracket-link bracket-link--orange">
            [ find a project → ]
          </Link>
        </p>

        {/* Recently checked: real reports, newest first. */}
        {recent.length > 0 && (
          <div className="xp-ticker mt-14 border-y border-line py-3 text-[0.85rem]" data-still={reduced}>
            <p className="mb-2 text-faint">recently checked{checked ? ` · ${checked >= 500 ? "500+" : checked} repos so far` : ""}</p>
            <div className="xp-ticker-mask">
              <ul className="xp-ticker-track">
                {[0, 1].map((copy) =>
                  recent.map((r) => (
                    <li key={`${copy}-${r.repo}`} aria-hidden={copy === 1 || undefined} className="xp-ticker-item">
                      <Link href={`/${r.repo}`} tabIndex={copy === 1 ? -1 : undefined} className="hover:text-blue">
                        {r.repo}
                      </Link>
                      <span className="text-faint"> {r.ago}</span>
                    </li>
                  )),
                )}
              </ul>
            </div>
          </div>
        )}

        {/* Links, grouped. */}
        <nav aria-label="Footer" className="mt-12 grid grid-cols-2 gap-x-8 gap-y-8 text-[0.88rem] sm:grid-cols-3">
          <Group title="product">
            <FLink href="/find">find a project</FLink>
            <FLink href="/discover">discover repos</FLink>
            <FLink href="/how-it-works">how it works</FLink>
            <FLink href="/badge">badge for maintainers</FLink>
            <FLink href="/pricing">pricing</FLink>
          </Group>
          <Group title="open source">
            <FLink href={GITHUB_REPO_URL} {...hot("adoring")}>holt-oss/holt</FLink>
            <FLink href={`${GITHUB_REPO_URL}/blob/main/CONTRIBUTING.md`} {...hot("adoring")}>contributing</FLink>
            <FLink href={`${GITHUB_REPO_URL}/blob/main/docs/USAGE.md`} {...hot("adoring")}>the CLI</FLink>
            <li className="py-1 text-faint">Apache-2.0</li>
          </Group>
          <Group title="legal">
            {LEGAL_PAGES.map((p) => (
              <FLink key={p.href} href={p.href}>{p.label}</FLink>
            ))}
          </Group>
        </nav>

        <p className="mt-12 max-w-md border-t border-dashed border-line pt-5 font-sans text-[0.87rem] text-faint">
          Holt only reads public GitHub data. It never posts, comments or opens a PR. Not even a typo fix.
        </p>
      </div>
    </footer>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-faint">{title}</p>
      <ul>{children}</ul>
    </div>
  );
}

function FLink({ href, children, ...rest }: { href: string; children: React.ReactNode } & React.HTMLAttributes<HTMLAnchorElement>) {
  const cls = "xp-flink inline-flex min-h-11 items-center text-muted hover:text-ink sm:min-h-0 sm:py-1";
  return (
    <li>
      {href.startsWith("/") ? (
        <Link href={href} className={cls} {...rest}>{children}</Link>
      ) : (
        <a href={href} className={cls} {...rest}>{children}</a>
      )}
    </li>
  );
}
