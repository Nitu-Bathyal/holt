"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { track } from "@/lib/analytics";
import { EXAMPLES, EXAMPLES_PATH } from "@/lib/examples";
import { NOT_A_REPO, pasteTarget } from "@/lib/gate";
import { parseRepoInput } from "@/lib/repo";

/** Does github.com/{repo} exist? Any doubt (offline, rate limited) says yes. */
export async function askExists(repo: string): Promise<boolean> {
  const r = await fetch(`/api/repo-exists?repo=${encodeURIComponent(repo)}`);
  if (!r.ok) return true;
  const d = await r.json().catch(() => null);
  return d?.exists !== false;
}

/**
 * "Opening…" until the page changes. Reset when it does, so coming back (the
 * footer stays mounted across pages; Back restores the landing) never finds
 * the button stuck.
 */
export function useBusy(): [boolean, (on: boolean) => void] {
  const path = usePathname();
  const [busy, setBusy] = useState(false);
  // A new page drops it (adjusting state during render, not in an effect).
  const [at, setAt] = useState(path);
  if (at !== path) {
    setAt(path);
    setBusy(false);
  }
  return [busy, setBusy];
}

// `id` and `label` let a page hold a second box: ids stay unique, and the
// smoke test's getByLabel("GitHub repository or URL") still finds one input.
// Signed out, a repo goes through sign-in and lands on its report (the check
// starts then); the "try" row holds the example reports, which open directly.
export function PasteBox({
  autoFocus = false,
  examples = true,
  size = "lg",
  id = "repo-input",
  label = "GitHub repository or URL",
  signedIn = true,
}: {
  autoFocus?: boolean;
  examples?: boolean;
  size?: "lg" | "md";
  id?: string;
  label?: string;
  /** From the server's session. Signed-in pages (/me) can leave it out. */
  signedIn?: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useBusy();

  async function go(input: string) {
    const ref = parseRepoInput(input);
    if (!ref) {
      setError(NOT_A_REPO);
      return;
    }
    setError("");
    setBusy(true);
    const repo = `${ref.owner}/${ref.repo}`;
    track("paste-submit", { repo, signedIn: signedIn ? "yes" : "no" });
    router.push(await pasteTarget(repo, signedIn, askExists));
  }

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void go(value);
        }}
        className="group relative grid grid-cols-1 border border-line-strong bg-panel shadow-card transition-colors focus-within:border-blue sm:grid-cols-[auto_1fr_auto]"
      >
        <span aria-hidden="true" className="absolute inset-y-0 left-0 w-0.5 origin-top scale-y-0 bg-amber transition-transform group-focus-within:scale-y-100" />
        <label htmlFor={id} className="sr-only">{label}</label>
        <span aria-hidden="true" className="hidden items-center pl-5 text-amber sm:flex">$</span>
        <input
          id={id}
          name="repo"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError("");
          }}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text");
            if (parseRepoInput(text)) {
              e.preventDefault();
              setValue(text.trim());
              void go(text);
            }
          }}
          autoFocus={autoFocus}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          placeholder="owner/name or a GitHub URL"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          className={`min-w-0 bg-transparent px-4 text-ink outline-none placeholder:text-faint sm:px-3 ${size === "lg" ? "h-16 text-[1rem] sm:text-[1.05rem]" : "h-13 text-[0.95rem]"}`}
        />
        <button
          type="submit"
          disabled={busy}
          className={`btn-primary m-1.5 sm:m-2 ${size === "lg" ? "sm:min-h-12" : ""}`}
        >
          {busy ? "opening…" : "check this repo"} <span aria-hidden="true">→</span>
        </button>
      </form>
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-2 font-sans text-[0.89rem] text-orange">
          {error}
        </p>
      )}
      {examples && (
        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-[0.82rem] text-faint">
          <span>try</span>
          {EXAMPLES.map(({ repo }) => (
            <button
              key={repo}
              type="button"
              onClick={() => void go(repo)}
              className="min-h-11 border-b border-dashed border-line-strong text-muted transition-colors hover:border-blue hover:text-ink"
            >
              {repo}
            </button>
          ))}
          {!signedIn && (
            <Link href={EXAMPLES_PATH} className="inline-flex min-h-11 items-center text-muted hover:text-ink">
              all examples →
            </Link>
          )}
        </p>
      )}
    </div>
  );
}
