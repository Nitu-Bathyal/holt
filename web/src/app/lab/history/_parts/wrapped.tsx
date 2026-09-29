"use client";
// PROTOTYPE, don't merge. Concept D, "your year": a story of a few slides, the
// cat reacting to each, ending on a card the owner can publish. Only slides
// this person's data can say honestly appear, so one PR makes a short story.
// The card is private until published, and the owner picks every line on it.
// October turns it into a Hacktoberfest story. Publishing is a stub here.
import { useState } from "react";
import { CatFace } from "@/components/cat-face";
import { story, type CardFact, type Slide } from "./facts";
import type { ConceptProps } from "./ui";

type Range = "year" | "october";

export function Wrapped(props: ConceptProps) {
  const [range, setRange] = useState<Range>("year");
  return (
    <section>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="hx-title">{range === "year" ? "Your year in open source." : "Your Hacktoberfest."}</h1>
        <div className="hx-seg" role="group" aria-label="Story">
          <button type="button" aria-pressed={range === "year"} onClick={() => setRange("year")}>2026</button>
          <button type="button" aria-pressed={range === "october"} onClick={() => setRange("october")}>October</button>
        </div>
      </div>
      <Story key={range} {...props} range={range} />
    </section>
  );
}

function Story({ persona, prs, reduced, range }: ConceptProps & { range: Range }) {
  const { slides, facts: initial } = story(prs, persona, range);
  const [at, setAt] = useState(0);
  const [facts, setFacts] = useState<CardFact[]>(initial);
  const [published, setPublished] = useState(false);
  const [copied, setCopied] = useState(false);
  const slide = slides[at];
  const go = (d: number) => setAt(Math.max(0, Math.min(slides.length - 1, at + d)));
  const link = `githolt.com/@${persona.login}/${range === "october" ? "hacktoberfest-2026" : "2026"}`;

  return (
    <div className="hx-wrap">
      <div
        className="hx-story"
        data-range={range}
        data-reduced={reduced || undefined}
        tabIndex={0}
        aria-roledescription="story"
        aria-label={`Slide ${at + 1} of ${slides.length}`}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); go(1); }
          if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
        }}
      >
        <div className="hx-bars" aria-hidden="true">
          {slides.map((s, i) => <span key={s.id} data-done={i <= at || undefined} />)}
        </div>
        <div key={slide.id} className="hx-slide" aria-live="polite">
          {slide.kind === "card" ? <Card login={persona.login} range={range} facts={facts.filter((f) => f.on)} /> : <Big slide={slide} />}
        </div>
        {at > 0 && <button type="button" className="hx-tap hx-tap-prev" aria-label="Back" onClick={() => go(-1)} />}
        {at < slides.length - 1 && <button type="button" className="hx-tap hx-tap-next" aria-label="Next" onClick={() => go(1)} />}
      </div>

      {slide.kind === "card" && (
        <div className="hx-share">
          <fieldset>
            <legend className="mb-2 font-mono text-[0.85rem] text-faint">on the card</legend>
            {facts.map((f) => (
              <label key={f.id} className="hx-check">
                <input type="checkbox" checked={f.on} onChange={() => setFacts(facts.map((x) => (x.id === f.id ? { ...x, on: !x.on } : x)))} />
                <span>{f.text}</span>
              </label>
            ))}
          </fieldset>
          {published ? (
            <div className="mt-5 space-y-3">
              <p className="hx-url">{link}</p>
              <div className="flex flex-wrap gap-3">
                <button type="button" className="hx-btn" onClick={() => { void navigator.clipboard?.writeText(`https://${link}`).catch(() => {}); setCopied(true); }}>
                  {copied ? "copied" : "copy link"}
                </button>
                <button type="button" className="hx-quiet" onClick={() => { setPublished(false); setCopied(false); }}>unpublish</button>
              </div>
            </div>
          ) : (
            <button type="button" className="hx-btn mt-5" onClick={() => setPublished(true)}>publish card →</button>
          )}
          <button type="button" className="hx-quiet mt-6 block" onClick={() => setAt(0)}>play again</button>
        </div>
      )}
    </div>
  );
}

function Big({ slide }: { slide: Extract<Slide, { kind: "big" }> }) {
  const long = slide.big.length > 14 || slide.big.includes("\n");
  return (
    <div className="hx-big-slide">
      <CatFace mood={slide.mood} className="hx-story-cat" />
      {slide.kicker && <p className="hx-kicker">{slide.kicker}</p>}
      <p className={`hx-big ${long ? "hx-big-long" : ""}`}>{slide.big}</p>
      {slide.line && <p className="hx-line-s">{slide.line}</p>}
    </div>
  );
}

function Card({ login, range, facts }: { login: string; range: Range; facts: CardFact[] }) {
  return (
    <div className="hx-card">
      <CatFace mood="celebrating" className="hx-card-cat" />
      <p className="hx-card-who">{login}</p>
      <p className="hx-card-when">{range === "october" ? "Hacktoberfest 2026" : "open source, 2026"}</p>
      <ul className="hx-card-facts">
        {facts.map((f) => <li key={f.id}>{f.text}</li>)}
      </ul>
      <p className="hx-card-foot">githolt.com</p>
    </div>
  );
}
