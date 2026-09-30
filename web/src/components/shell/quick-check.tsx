"use client";
// A small repo box: type or paste a repo, press enter, read its report. In the
// top bar on every app page ("bar", from md up), and on the home below md,
// where the top bar has no room for it ("inline"). An unreadable entry gets a
// hint that goes as soon as you type, leave the box or change page
// (lib/quick-check.ts).
import { usePathname, useRouter } from "next/navigation";
import { useReducer, useState } from "react";
import { track } from "@/lib/analytics";
import { pasteHref } from "@/lib/gate";
import { hintState, nextHint } from "@/lib/quick-check";
import { parseRepoInput } from "@/lib/repo";

export function QuickCheck({ variant = "bar" }: { variant?: "bar" | "inline" }) {
  const bar = variant === "bar";
  const id = bar ? "bar-repo" : "home-repo";
  const router = useRouter();
  const [value, setValue] = useState("");
  const pathname = usePathname();
  const [hint, send] = useReducer(nextHint, pathname, hintState);
  // The box outlives the page: a new page starts without the hint.
  if (hint.path !== pathname) send({ type: "route", path: pathname });
  const bad = hint.shown && hint.path === pathname;

  return (
    <form
      role="search"
      data-check-target={variant}
      onSubmit={(e) => {
        e.preventDefault();
        const ref = parseRepoInput(value);
        send({ type: "submit", valid: !!ref });
        if (!ref) return;
        track("paste-submit", { repo: `${ref.owner}/${ref.repo}`, from: variant });
        setValue("");
        // Only signed-in people see this box; same rule as every paste box.
        router.push(pasteHref(`${ref.owner}/${ref.repo}`, true));
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) send({ type: "leave" });
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && bad) send({ type: "leave" });
      }}
      className={`relative w-full items-center border border-line-strong bg-panel transition-colors focus-within:border-blue ${bar ? "hidden max-w-xl md:flex" : "flex max-w-xl"}`}
    >
      <label htmlFor={id} className="sr-only">Check a repo</label>
      <span aria-hidden="true" className="pl-3 text-amber">$</span>
      <input
        id={id}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          send({ type: "input" });
        }}
        aria-invalid={bad || undefined}
        aria-describedby={bad ? `${id}-error` : undefined}
        placeholder={bar ? "check a repo: owner/name" : "owner/name or a GitHub link"}
        autoComplete="off"
        spellCheck={false}
        className={`min-w-0 flex-1 bg-transparent px-2 outline-none placeholder:text-faint ${bar ? "py-2 text-[0.85rem]" : "py-3 text-[0.92rem]"}`}
      />
      {bar && !value && <kbd aria-hidden="true" className="mr-2 hidden border border-line-strong px-1.5 text-[0.72rem] leading-5 text-faint lg:block">/</kbd>}
      <button type="submit" className="self-stretch border-l border-line-strong px-3 text-[0.8rem] text-muted transition-colors hover:text-ink">check</button>
      {bad && (
        <p id={`${id}-error`} role="alert" className="absolute left-0 top-full mt-1 border border-orange/50 bg-panel px-3 py-2 font-sans text-[0.82rem] text-orange shadow-card">
          Try owner/name or a github.com link.
        </p>
      )}
    </form>
  );
}
