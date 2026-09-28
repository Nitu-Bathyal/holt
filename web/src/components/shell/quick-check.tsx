"use client";
// A small repo box: type or paste a repo, press enter, read its report. In the
// top bar ("bar", hidden on /me, whose own box is the page's main action), and
// as the quiet second option on a new account's home ("inline").
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { track } from "@/lib/analytics";
import { pasteHref } from "@/lib/gate";
import { parseRepoInput } from "@/lib/repo";
import { HOME } from "@/lib/home";

export function QuickCheck({ variant = "bar" }: { variant?: "bar" | "inline" }) {
  const bar = variant === "bar";
  const id = bar ? "bar-repo" : "home-repo";
  const router = useRouter();
  const path = usePathname();
  const [value, setValue] = useState("");
  const [bad, setBad] = useState(false);
  if (bar && path === HOME) return null;

  return (
    <form
      role="search"
      data-check-target={variant}
      onSubmit={(e) => {
        e.preventDefault();
        const ref = parseRepoInput(value);
        if (!ref) return setBad(true);
        track("paste-submit", { repo: `${ref.owner}/${ref.repo}`, from: variant });
        setValue("");
        // Only signed-in people see this box; same rule as every paste box.
        router.push(pasteHref(`${ref.owner}/${ref.repo}`, true));
      }}
      className={`relative w-full items-center border border-line-strong bg-panel transition-colors focus-within:border-blue ${bar ? "hidden max-w-sm md:flex" : "flex max-w-xl"}`}
    >
      <label htmlFor={id} className="sr-only">Check a repo</label>
      <span aria-hidden="true" className="pl-3 text-amber">$</span>
      <input
        id={id}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          if (bad) setBad(false);
        }}
        aria-invalid={bad || undefined}
        aria-describedby={bad ? `${id}-error` : undefined}
        placeholder={bar ? "check a repo: owner/name" : "owner/name or a GitHub link"}
        autoComplete="off"
        spellCheck={false}
        className={`min-w-0 flex-1 bg-transparent px-2 outline-none placeholder:text-faint ${bar ? "py-2 text-[0.85rem]" : "py-3 text-[0.92rem]"}`}
      />
      <button type="submit" className="self-stretch border-l border-line-strong px-3 text-[0.8rem] text-muted transition-colors hover:text-ink">check</button>
      {bad && (
        <p id={`${id}-error`} role="alert" className="absolute left-0 top-full mt-1 border border-orange/50 bg-panel px-3 py-2 font-sans text-[0.82rem] text-orange shadow-card">
          Try owner/name or a github.com link.
        </p>
      )}
    </form>
  );
}
