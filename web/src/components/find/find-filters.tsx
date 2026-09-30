"use client";

import { useEffect, useId, useRef, useState } from "react";
import { extraCount, type Picks } from "@/lib/find-picks";
import { CONTRIBUTIONS, LANGS, LEVELS, TIME, topics as topicsOf } from "@/lib/profile";

// Every choice is one tap and applies at once; the rare ones sit behind "more filters".
// Case, above the results: names and choices (tabs, labels, chips, options)
// start with a capital; actions (check, apply, more filters, reset filters)
// are lowercase; notes and hints in brackets or after "·" run on in lowercase.
const TIME_SHORT: Record<number, string> = { 1: "Evening", 3: "Weekend", 7: "Week", 30: "Month" };

const seg = "flex min-h-11 items-center sm:min-h-9 justify-center border px-3 text-[0.82rem] transition-colors focus-visible:outline-2 focus-visible:outline-blue";
const segOn = "border-green bg-green font-semibold text-on-accent";
const segOff = "border-line-strong text-muted hover:border-blue hover:text-ink";
const chipOn = "border-blue bg-blue text-on-accent";
const chipOff = "border-line-strong text-muted hover:border-blue hover:text-ink";
const chip = "inline-flex min-h-11 shrink-0 sm:min-h-9 select-none items-center border px-3.5 text-[0.82rem] transition-colors focus-visible:outline-2 focus-visible:outline-blue";

export function FindFilters({ picks, onChange, hf }: { picks: Picks; onChange: (p: Picks) => void; hf: { note: string } | null }) {
  const extras = extraCount(picks);
  const [more, setMore] = useState(extras > 0);
  const [topicText, setTopicText] = useState(picks.topics.join(", "));
  const [topicsFor, setTopicsFor] = useState(picks.topics);
  // Picks changed from outside (a "widen" button, a reset): show their topics.
  if (topicsFor !== picks.topics) {
    setTopicsFor(picks.topics);
    setTopicText(picks.topics.join(", "));
  }
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
  const applyTopics = () => {
    const t = topicsOf(topicText);
    if (t.join() !== picks.topics.join()) set({ topics: t });
  };

  return (
    <div className="find-tray">
      <div ref={langRow} role="group" aria-label="Languages you can read" className="flex gap-2 overflow-x-auto py-3 [scrollbar-width:none] sm:flex-wrap sm:overflow-visible sm:pb-3 sm:pt-4">
        <button type="button" aria-pressed={!picks.langs.length} onClick={() => set({ langs: [] })} className={`${chip} ${!picks.langs.length ? chipOn : chipOff}`}>
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
              applyTopics();
            }}
          >
            <label htmlFor={`${panelId}-topics`} className="mb-2 block text-[0.82rem] text-faint">
              Topics <span className="font-sans">(GitHub topics, separated by commas)</span>
            </label>
            <div className="flex gap-2">
              <input
                id={`${panelId}-topics`}
                type="text"
                value={topicText}
                onChange={(e) => setTopicText(e.target.value)}
                onBlur={applyTopics}
                placeholder="e.g. web, cli, machine-learning"
                maxLength={300}
                enterKeyHint="search"
                className="min-h-11 min-w-0 flex-1 border sm:min-h-9 border-line-strong bg-bg px-3 font-sans text-[0.82rem] outline-none focus-visible:border-blue"
              />
              <button type="submit" className="btn-ghost min-h-11 text-[0.82rem] sm:min-h-9">apply</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
