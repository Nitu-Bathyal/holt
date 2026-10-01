"use client";
// Hacktoberfest's "+ add a language": the same box as /find's (find-filters.tsx),
// but the page's languages are tabs, so a typed one opens as its own tab
// (/hacktoberfest?lang=<name>) instead of joining a set.
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { LANGS, MORE_LANGS } from "@/lib/profile";
import { SuggestInput } from "./suggest-input";

const OPTIONS = [...LANGS, ...MORE_LANGS];

export function HfLangAdd() {
  const router = useRouter();
  const id = useId();
  const [text, setText] = useState("");
  const go = (value = text) => {
    // One tab at a time: the last name typed, if there were several.
    const lang = value.split(",").map((l) => l.trim().toLowerCase()).filter((l) => l && l.length <= 40).at(-1);
    setText("");
    if (lang) router.push(`/hacktoberfest?lang=${encodeURIComponent(lang)}`, { scroll: false });
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        go();
      }}
      data-suggest-anchor
      className="flex min-h-11 w-44 shrink-0 items-center border border-line-strong bg-bg transition-colors focus-within:border-hf"
    >
      <label htmlFor={id} className="sr-only">Add a language</label>
      <span aria-hidden="true" className="pl-2.5 text-[0.82rem] text-faint">+</span>
      <SuggestInput
        id={id}
        type="text"
        value={text}
        onChange={setText}
        onPick={go}
        options={OPTIONS}
        maxLength={40}
        spellCheck={false}
        enterKeyHint="go"
        placeholder="add a language"
        className="min-w-0 flex-1 bg-transparent px-1.5 text-[0.82rem] outline-none placeholder:text-faint"
      />
      {text.trim() && <button type="submit" className="self-stretch px-2.5 text-[0.82rem] text-muted hover:text-ink">add</button>}
    </form>
  );
}
