"use client";

import { useEffect, useId, useRef, useState } from "react";
import { extraCount, type Picks } from "@/lib/find-picks";
import { CONTRIBUTIONS, LANGS, langName, LEVELS, MORE_LANGS, POPULAR_TOPICS, TIME, topics as topicsOf } from "@/lib/profile";
import { SuggestInput } from "./suggest-input";

// Every choice is one tap and applies at once; the rare ones sit behind "more filters".
// Case, above the results: names and choices (tabs, labels, chips, options)
// start with a capital (GitHub topics keep their own lowercase spelling);
// actions (check, add, more filters, reset filters)
// are lowercase; notes and hints in brackets or after "·" run on in lowercase.
const TIME_SHORT: Record<number, string> = { 1: "Evening", 3: "Weekend", 7: "Week", 30: "Month" };

const seg = "flex min-h-11 items-center sm:min-h-9 justify-center border px-3 text-[0.82rem] transition-colors focus-visible:outline-2 focus-visible:outline-blue";
const segOn = "border-green bg-green font-semibold text-on-accent";
const segOff = "border-line-strong text-muted hover:border-blue hover:text-ink";
const chipOn = "border-blue bg-blue text-on-accent";
const chipOff = "border-line-strong text-muted hover:border-blue hover:text-ink";
// Languages you type in: any name GitHub knows (find-picks.ts keeps up to 10, each up to 40 characters).
const MAX_LANGS = 10;
const MAX_TOPICS = 10;
const KNOWN = new Set(LANGS.map((l) => l.toLowerCase()));
const chip = "inline-flex min-h-11 shrink-0 sm:min-h-9 select-none items-center border px-3.5 text-[0.82rem] transition-colors focus-visible:outline-2 focus-visible:outline-blue";

export function FindFilters({ picks, onChange, hf, footer }: {
  picks: Picks;
  onChange: (p: Picks) => void;
  hf: { note: string } | null;
  /** The tray's last row: how the search went, and what to do with the picks (find-view.tsx). */
  footer?: React.ReactNode;
}) {
  const extras = extraCount(picks);
  const [more, setMore] = useState(extras > 0);
  // Only what's being typed; the applied topics show as chips.
  const [topicText, setTopicText] = useState("");
  const panelId = useId();
  // Phones scroll the language row: bring the first picked one into view once.
  const langRow = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = langRow.current;
    const on = row?.querySelector<HTMLElement>("[aria-pressed=true]");
    if (row && on && row.scrollWidth > row.clientWidth) row.scrollLeft = on.offsetLeft - row.offsetLeft - 12;
  }, []);
  const set = (patch: Partial<Picks>) => onChange({ ...picks, ...patch });
  const toggle = <T,>(xs: T[], x: T) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]);
  const [langText, setLangText] = useState("");
  const custom = picks.langs.filter((l) => !KNOWN.has(l));
  const full = picks.langs.length >= MAX_LANGS;
  const addLangs = (text = langText) => {
    const typed = text.split(",").map((l) => l.trim().toLowerCase()).filter((l) => l && l.length <= 40);
    const langs = [...new Set([...picks.langs, ...typed])].slice(0, MAX_LANGS);
    setLangText("");
    if (langs.length !== picks.langs.length) set({ langs });
  };
  // Backspace in an empty box takes off the chip just before it, as tag boxes do.
  const onLangKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !langText && custom.length) set({ langs: picks.langs.filter((l) => l !== custom.at(-1)) });
  };
  const onTopicKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !topicText && picks.topics.length) set({ topics: picks.topics.slice(0, -1) });
  };
  const topicsFull = picks.topics.length >= MAX_TOPICS;
  const addTopics = (text = topicText) => {
    const t = topicsOf([...picks.topics, topicsOf(text)].join(","));
    setTopicText("");
    if (t.length !== picks.topics.length) set({ topics: t });
  };
  // The applied topics, each one tap to remove: in the panel, and beside
  // "more filters" while it's closed, so they're never out of sight.
  const topicChips = picks.topics.map((t) => (
    <button key={t} type="button" aria-pressed="true" aria-label={`Topic ${t}, remove`} onClick={() => set({ topics: picks.topics.filter((x) => x !== t) })} className={`${chip} ${chipOn} gap-1.5`}>
      {t}
      <span aria-hidden="true" className="opacity-70">×</span>
    </button>
  ));

  return (
    <div className="find-tray">
      <div ref={langRow} role="group" aria-label="Languages you can read" className="flex gap-2 overflow-x-auto py-3 [scrollbar-width:none] sm:flex-wrap sm:overflow-visible sm:pb-3 sm:pt-4">
        <button type="button" aria-pressed={!picks.langs.length} onClick={() => set({ langs: [] })} className={`${chip} ${!picks.langs.length ? chipOn : chipOff} max-sm:order-first`}>
          Any language
        </button>
        {LANGS.map((l) => {
          const id = l.toLowerCase();
          const on = picks.langs.includes(id);
          return (
            <button key={id} type="button" aria-pressed={on} onClick={() => set({ langs: toggle(picks.langs, id) })} className={`${chip} ${on ? chipOn : chipOff}`}>
              {l}
            </button>
          );
        })}
        {custom.map((id) => (
          <button key={id} type="button" aria-pressed="true" aria-label={`${langName(id)}, remove`} onClick={() => set({ langs: toggle(picks.langs, id) })} className={`${chip} ${chipOn} gap-1.5`}>
            {langName(id)}
            <span aria-hidden="true" className="opacity-70">×</span>
          </button>
        ))}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            addLangs();
          }}
          // On a phone the row scrolls sideways: the box sits right after "Any language", where it's seen.
          data-suggest-anchor
          className="flex min-h-11 w-44 shrink-0 items-center border border-line-strong bg-bg transition-colors focus-within:border-blue max-sm:order-first sm:min-h-9"
        >
          <label htmlFor={`${panelId}-lang`} className="sr-only">Add a language</label>
          <span aria-hidden="true" className="pl-2.5 text-[0.82rem] text-faint">+</span>
          <SuggestInput
            id={`${panelId}-lang`}
            type="text"
            value={langText}
            onChange={setLangText}
            onPick={addLangs}
            options={MORE_LANGS.filter((l) => !picks.langs.includes(l.toLowerCase()))}
            onKeyDown={onLangKey}
            placeholder={full ? "10 languages at most" : "add a language"}
            readOnly={full}
            maxLength={40}
            spellCheck={false}
            enterKeyHint="done"
            className="min-w-0 flex-1 bg-transparent px-1.5 text-[0.82rem] outline-none placeholder:text-faint read-only:cursor-not-allowed"
          />
          {langText.trim() && <button type="submit" className="self-stretch px-2.5 text-[0.82rem] text-muted hover:text-ink">add</button>}
        </form>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-line py-3">
        <div role="radiogroup" aria-label="Time you have" className="flex w-full items-center gap-2 sm:w-auto">
          <span className="shrink-0 text-[0.82rem] text-faint">Time</span>
          <div className="grid flex-1 grid-cols-4 sm:flex">
            {TIME.map((t, i) => {
              const on = picks.days === t.days;
              return (
                <button
                  key={t.days}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={t.label}
                  onClick={() => set({ days: t.days })}
                  className={`${seg} ${on ? segOn : segOff} ${i ? "-ml-px" : ""} relative ${on ? "z-10" : ""}`}
                >
                  {TIME_SHORT[t.days]}
                </button>
              );
            })}
          </div>
        </div>

        {hf && (
          <button type="button" role="switch" aria-checked={picks.hf} onClick={() => set({ hf: !picks.hf })} className="group flex min-h-11 items-center gap-2.5 text-left text-[0.82rem] sm:min-h-9">
            <span
              aria-hidden="true"
              className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors after:absolute after:left-0.5 after:top-0.5 after:size-4.5 after:rounded-full after:transition-transform group-focus-visible:outline-2 group-focus-visible:outline-blue ${picks.hf ? "border-hf bg-hf-bg after:translate-x-5 after:bg-hf" : "border-line-strong bg-panel-2 after:bg-faint"}`}
            />
            <span>
              Hacktoberfest only <span className="hidden text-faint sm:inline">· {hf.note}</span>
            </span>
          </button>
        )}

        {!more && topicChips.length > 0 && (
          <div role="group" aria-label="Topics" className="flex flex-wrap gap-2">
            {topicChips}
          </div>
        )}

        <button
          type="button"
          aria-expanded={more}
          aria-controls={panelId}
          onClick={() => setMore(!more)}
          className="ml-auto flex min-h-11 items-center gap-1.5 sm:min-h-9 text-[0.82rem] text-muted hover:text-ink"
        >
          more filters{extras > 0 && <span className="rounded-full bg-blue px-1.5 text-[0.72rem] text-on-accent">{extras}</span>}
          <span aria-hidden="true" className={`transition-transform ${more ? "rotate-180" : ""}`}>▾</span>
        </button>
      </div>

      {more && (
        <div id={panelId} className="grid gap-5 border-t border-line py-3 sm:grid-cols-[auto_1fr] sm:gap-x-8 sm:py-4 lg:grid-cols-[auto_minmax(0,1fr)_minmax(16rem,24rem)]">
          <div role="radiogroup" aria-label="Your experience">
            <p className="mb-2 text-[0.82rem] text-faint">Your experience</p>
            <div className="flex">
              {LEVELS.map((l, i) => {
                const on = picks.level === l.id;
                return (
                  <button key={l.id} type="button" role="radio" aria-checked={on} title={l.hint} onClick={() => set({ level: l.id })} className={`${seg} ${on ? segOn : segOff} ${i ? "-ml-px" : ""} relative flex-1 ${on ? "z-10" : ""}`}>
                    {l.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 font-sans text-[0.82rem] text-faint">{LEVELS.find((l) => l.id === picks.level)?.hint}</p>
          </div>
          <div role="group" aria-label="What you'd like to work on">
            <p className="mb-2 text-[0.82rem] text-faint">Work on <span className="font-sans">(these issues come first)</span></p>
            <div className="flex flex-wrap gap-2">
              {CONTRIBUTIONS.map((c) => {
                const on = picks.types.includes(c.id);
                return (
                  <button key={c.id} type="button" aria-pressed={on} onClick={() => set({ types: toggle(picks.types, c.id) })} className={`${chip} ${on ? chipOn : chipOff}`}>
                    {c.label}
                  </button>
                );
              })}
            </div>
          </div>
          <form
            className="sm:col-span-2 lg:col-span-1"
            onSubmit={(e) => {
              e.preventDefault();
              addTopics();
            }}
          >
            <label htmlFor={`${panelId}-topics`} className="mb-2 block text-[0.82rem] text-faint">
              Topics <span className="font-sans">(GitHub topics, separated by commas)</span>
            </label>
            <div className="flex gap-2">
              <SuggestInput
                id={`${panelId}-topics`}
                type="text"
                value={topicText}
                onChange={setTopicText}
                onPick={addTopics}
                options={POPULAR_TOPICS.filter((t) => !picks.topics.includes(t))}
                onBlur={() => topicText.trim() && addTopics()}
                onKeyDown={onTopicKey}
                placeholder={topicsFull ? "10 topics at most" : "e.g. web, cli, machine-learning"}
                readOnly={topicsFull}
                maxLength={300}
                enterKeyHint="search"
                className="min-h-11 min-w-0 flex-1 border sm:min-h-9 border-line-strong bg-bg px-3 text-[0.82rem] outline-none focus-visible:border-blue read-only:cursor-not-allowed"
              />
              <button type="submit" disabled={topicsFull} className="btn-ghost min-h-11 text-[0.82rem] sm:min-h-9">add</button>
            </div>
            {topicChips.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{topicChips}</div>}
          </form>
        </div>
      )}

      {footer && <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-line py-2.5 text-[0.82rem] text-faint">{footer}</div>}
    </div>
  );
}
