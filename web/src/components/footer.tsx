"use client";

// The site footer: a sign-off, one last action, the links, and the repos Holt
// checked most recently (docs/design/EXPRESSIVE.md, pattern 7).
// - One cat carries it: its eyes follow the pointer across the footer, it
//   reads along as you type a repo, cheers when it looks right, puzzles when
//   it can't be one, and goes soft over the open-source links. Tap to pet.
// - The sign-off is a terminal line, `$ git commit --to-the-right-repo`. It
//   waves once as the footer comes into view (letters bob, none is ever
//   hidden) and again on hover; the cursor after it blinks.
// - On the landing page only, the last action: the URL trick as a form
//   (githolt.com/owner/repo) and find a project. Other pages have their own.
// - "Recently checked" loads only when the footer is near, from a cached
//   route, and sits last so it never pushes anything down when it arrives.
// Everything is in the server HTML, links included; motion is CSS
// (globals.css, .ft-*) and never runs under reduced motion.
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { track } from "@/lib/analytics";
import { inputMood, type CatMood } from "@/lib/cat";
import { timeAgo } from "@/lib/format";
import { checkedLabel, type RecentChecks } from "@/lib/recent-checks";
import { parseRepoInput } from "@/lib/repo";
import { GITHUB_REPO_URL, LEGAL_PAGES, SITE_HOST } from "@/lib/site";
import { ReactiveCat } from "./reactive-cat";

const SIGN_OFF = "git commit --to-the-right-repo";

export function Footer() {
  const router = useRouter();
  // The landing page is "/" (signed in, "/?landing=1"); every other page
  // already has its own action, so only the landing ends on the form.
  const onLanding = usePathname() === "/";
  const root = useRef<HTMLElement>(null);
  const cat = useRef<HTMLButtonElement>(null);
  const frame = useRef(0);
  const [look, setLook] = useState(0);
  const [hover, setHover] = useState<CatMood | null>(null);
  const [pet, setPet] = useState(false);
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [seen, setSeen] = useState(false);
  const [waves, setWaves] = useState(0);
  const [recent, setRecent] = useState<RecentChecks | null>(null);

  // Near the viewport: fetch the strip. In view: wave once.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let fetched = false;
    const near = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting || fetched) return;
        fetched = true;
        near.disconnect();
        fetch("/api/recent-checks")
          .then((r) => (r.ok ? r.json() : null))
          .then((d: RecentChecks | null) => {
            if (d?.recent?.length) setRecent(d);
          })
          .catch(() => {});
      },
      { rootMargin: "600px 0px" },
    );
    const inView = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        setSeen(true);
        inView.disconnect();
      },
      { rootMargin: "0px 0px -20% 0px" },
    );
    near.observe(el);
    inView.observe(el);
    return () => {
      near.disconnect();
      inView.disconnect();
      cancelAnimationFrame(frame.current);
    };
  }, []);

  const ref = parseRepoInput(value);
  const mood: CatMood = pet ? "adoring" : busy ? "determined" : error ? "thinking" : (inputMood(value, Boolean(ref)) ?? hover ?? "ready");
  // In the field, the eyes follow the caret along it; elsewhere, the pointer.
  const gaze = focused ? (value ? Math.min(1, value.length / 28) * 2 - 1 : 0.6) : look;

  const onMove = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse" || frame.current) return;
    const x = e.clientX;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const r = cat.current?.getBoundingClientRect();
      if (!r || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      setLook(Math.max(-1, Math.min(1, (x - (r.left + r.width / 2)) / (innerWidth * 0.35))));
    });
  };

  const go = () => {
    if (!ref) {
      setError("That doesn't look like a repo. Try pallets/flask or a github.com link.");
      return;
    }
    setError("");
    setBusy(true);
    track("paste-submit", { repo: `${ref.owner}/${ref.repo}`, from: "footer" });
    router.push(`/${ref.owner}/${ref.repo}`);
  };

  const react = (m: CatMood) => ({
    onPointerEnter: () => setHover(m),
    onPointerLeave: () => setHover(null),
    onFocus: () => setHover(m),
    onBlur: () => setHover(null),
  });

  return (
    <footer ref={root} onPointerMove={onMove} className="mt-auto overflow-clip border-t border-line bg-panel">
      <div className="wrap pb-10 pt-14 md:pt-20">
        <button
          ref={cat}
          type="button"
          aria-label="Pet the cat"
          onClick={() => {
            setPet(true);
            window.setTimeout(() => setPet(false), 900);
          }}
          className="-ml-1 px-1 py-2 text-[clamp(2rem,5vw,3.4rem)] leading-none [touch-action:manipulation]"
        >
          <ReactiveCat mood={mood} look={gaze} />
        </button>
        <p
          className="ft-signoff mt-4 text-[clamp(1.5rem,4.4vw,3.6rem)] font-semibold tracking-[-0.03em] text-ink"
          data-waving={seen || waves > 0}
          onPointerEnter={() => setWaves((n) => n + 1)}
        >
          <span className="sr-only">{SIGN_OFF}</span>
          <span key={`${seen}-${waves}`} aria-hidden="true">
            <span className="text-amber">$ </span>
            {/* Words stay whole, so a line only breaks between them. */}
            {SIGN_OFF.split(" ").map((word, w, all) => {
              const start = all.slice(0, w).join(" ").length + (w ? 1 : 0);
              return (
                <span key={w} className="whitespace-nowrap">
                  {[...word].map((ch, i) => (
                    <span key={i} className="ft-wave" style={{ ["--i" as string]: start + i }}>
                      {ch}
                    </span>
                  ))}
                  {w < all.length - 1 ? " " : <span className="ft-caret" />}
                </span>
              );
            })}
          </span>
        </p>
        {onLanding && (
          <p className="mt-4 max-w-[560px] font-sans text-[1.05rem] text-muted">
            Paste a repo. You&apos;ll know before you write a line of code.
          </p>
        )}

        {onLanding && (
          <>
            {/* The URL trick as a form. */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                go();
              }}
              className="mt-10 grid max-w-[820px] grid-cols-[auto_minmax(0,1fr)_auto] items-stretch border border-line-strong bg-bg transition-colors focus-within:border-blue"
            >
              <label htmlFor="footer-repo" className="flex items-center pl-4 text-[0.95rem] text-faint sm:text-[1.05rem]">
                <span className="sr-only">Repo to check: </span>
                <span aria-hidden="true">{SITE_HOST}/</span>
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
              <button
                type="submit"
                disabled={busy}
                {...react("celebrating")}
                className="border-l border-line-strong px-4 font-semibold text-blue transition-colors hover:bg-blue hover:text-on-accent sm:px-6"
              >
                {busy ? "checking…" : "check →"}
              </button>
            </form>
            <p id="footer-repo-error" role={error ? "alert" : undefined} className="mt-2 min-h-6 font-sans text-[0.9rem] text-orange">
              {error}
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="font-sans text-[0.95rem] text-muted">No repo yet?</span>
              <Link href="/find" {...react("celebrating")} className="bracket-link bracket-link--orange">
                [ find a project → ]
              </Link>
            </p>
          </>
        )}

        <nav aria-label="Footer" className="mt-14 grid grid-cols-2 gap-8 text-[0.88rem] sm:grid-cols-3">
          <Group title="product">
            <FLink href="/find">find a project</FLink>
            <FLink href="/discover">discover repos</FLink>
            <FLink href="/how-it-works">how it works</FLink>
            <FLink href="/badge">badge for maintainers</FLink>
            <FLink href="/pricing">pricing</FLink>
          </Group>
          <Group title="open source">
            <FLink href={GITHUB_REPO_URL} {...react("adoring")}>holt-oss/holt</FLink>
            <FLink href={`${GITHUB_REPO_URL}/blob/main/CONTRIBUTING.md`} {...react("adoring")}>contributing</FLink>
            <FLink href={`${GITHUB_REPO_URL}/blob/main/docs/USAGE.md`} {...react("adoring")}>the CLI</FLink>
            <li className="py-1 text-faint">Apache-2.0</li>
          </Group>
          <Group title="legal">
            {LEGAL_PAGES.map((p) => (
              <FLink key={p.href} href={p.href}>{p.label}</FLink>
            ))}
          </Group>
        </nav>
      </div>

      {/* Last, so it can arrive without moving anything. */}
      {recent && (
        <div className="ft-ticker border-t border-line py-4 text-[0.85rem]">
          <p className="wrap mb-2 text-faint">recently checked · {checkedLabel(recent)}</p>
          <div className="ft-ticker-mask">
            <ul className="ft-ticker-track">
              {[0, 1].map((copy) =>
                recent.recent.map((r) => (
                  <li key={`${copy}-${r.repo}`} aria-hidden={copy === 1 || undefined} className="ft-ticker-item">
                    <Link href={`/${r.repo}`} prefetch={false} tabIndex={copy === 1 ? -1 : undefined} className="hover:text-blue">
                      {r.repo}
                    </Link>
                    <span className="text-faint"> {timeAgo(r.generated_at)}</span>
                  </li>
                )),
              )}
            </ul>
          </div>
        </div>
      )}
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
  const cls = "inline-flex min-h-11 items-center text-muted hover:text-ink sm:min-h-0 sm:py-1";
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
