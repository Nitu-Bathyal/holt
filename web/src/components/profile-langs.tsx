"use client";
// The profile form's languages: the usual chips with their colour dots, plus
// any language typed into "add a language" (the same box as /find), each a
// ticked checkbox named "lang" so the form saves it like the rest.
import { useId, useState } from "react";
import { SuggestInput } from "@/components/find/suggest-input";
import { LangDot } from "@/components/repo-card/repo-avatar";
import { LANGS, langName, MORE_LANGS } from "@/lib/profile";
import { langColor } from "@/lib/repo-card";

/** The server keeps up to 10 (lib/profile.ts, fromForm). */
const MAX = 10;
const KNOWN = new Set(LANGS.map((l) => l.toLowerCase()));

export function ProfileLangs({ saved, chip }: { saved: string[]; chip: string }) {
  const id = useId();
  const [picked, setPicked] = useState(saved);
  // Typed or saved languages without a chip of their own; they stay listed once unticked.
  const [extra, setExtra] = useState(() => saved.filter((l) => !KNOWN.has(l)));
  const [text, setText] = useState("");
  const full = picked.length >= MAX;

  const toggle = (l: string) => setPicked((p) => (p.includes(l) ? p.filter((x) => x !== l) : [...p, l]));
  const add = (value = text) => {
    const typed = value.split(",").map((l) => l.trim().toLowerCase()).filter((l) => l && l.length <= 40);
    setText("");
    setExtra((e) => [...new Set([...e, ...typed.filter((l) => !KNOWN.has(l))])]);
    setPicked((p) => [...new Set([...p, ...typed])].slice(0, MAX));
  };

  const box = (l: string, label: string) => (
    <label key={l} className={`${chip} gap-2`}>
      <input type="checkbox" name="lang" value={l} checked={picked.includes(l)} onChange={() => toggle(l)} className="sr-only" />
      <LangDot color={langColor(l)} />
      {label}
    </label>
  );

  return (
    <div className="flex flex-wrap gap-2">
      {LANGS.map((l) => box(l.toLowerCase(), l))}
      {extra.map((l) => box(l, langName(l)))}
      <div data-suggest-anchor className="flex min-h-11 w-48 items-center border border-line-strong bg-bg transition-colors focus-within:border-blue sm:min-h-9">
        <label htmlFor={id} className="sr-only">Add a language</label>
        <span aria-hidden="true" className="pl-2.5 text-[0.82rem] text-faint">+</span>
        <SuggestInput
          id={id}
          type="text"
          value={text}
          onChange={setText}
          onPick={add}
          options={MORE_LANGS.filter((l) => !picked.includes(l.toLowerCase()))}
          // Inside the profile form: Enter adds the language rather than saving the form.
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.defaultPrevented) {
              e.preventDefault();
              add();
            }
          }}
          placeholder={full ? "10 languages at most" : "add a language"}
          readOnly={full}
          maxLength={40}
          spellCheck={false}
          enterKeyHint="done"
          className="min-w-0 flex-1 bg-transparent px-1.5 text-[0.82rem] outline-none placeholder:text-faint read-only:cursor-not-allowed"
        />
        {text.trim() && (
          <button type="button" onClick={() => add()} className="self-stretch px-2.5 text-[0.82rem] text-muted hover:text-ink">add</button>
        )}
      </div>
    </div>
  );
}
