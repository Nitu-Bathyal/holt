"use client";
// PROTOTYPE, don't merge. Four ways to show someone's open-source history
// (docs/design/HISTORY.md), each on three made-up people. The bar at the
// bottom switches concept and person, counts team repos or not, and previews
// reduced motion. Keys: [ and ] cycle concepts, 1–3 pick a person.
import { useCallback, useEffect, useState } from "react";
import { useReducedMotion } from "@/components/motion/use-seen";
import { PERSONAS, type PersonaId } from "./data";
import { counted } from "./facts";
import { Changelog } from "./changelog";
import { Odds } from "./odds";
import { Tree } from "./tree";
import { Wrapped } from "./wrapped";

const CONCEPTS = [
  { id: "tree", label: "where it landed" },
  { id: "changelog", label: "changelog" },
  { id: "odds", label: "you got in" },
  { id: "wrapped", label: "your year" },
] as const;
type Concept = (typeof CONCEPTS)[number]["id"];

const PEOPLE: { id: PersonaId; label: string }[] = [
  { id: "newcomer", label: "newcomer · 1 PR" },
  { id: "student", label: "student · 15" },
  { id: "veteran", label: "veteran · 312" },
];

const isConcept = (s?: string | null): s is Concept => CONCEPTS.some((c) => c.id === s);
const isPerson = (s?: string | null): s is PersonaId => PEOPLE.some((p) => p.id === s);

export function HistoryLab(initial: { concept?: string; person?: string }) {
  const [concept, setConcept] = useState<Concept>(isConcept(initial.concept) ? initial.concept : "tree");
  const [person, setPerson] = useState<PersonaId>(isPerson(initial.person) ? initial.person : "student");
  const [team, setTeam] = useState(false);
  const [labReduced, setLabReduced] = useState(false);
  const osReduced = useReducedMotion();
  const reduced = labReduced || osReduced;

  const go = useCallback((c: Concept, p: PersonaId) => {
    setConcept(c);
    setPerson(p);
    const u = new URL(window.location.href);
    u.searchParams.set("concept", c);
    u.searchParams.set("person", p);
    window.history.replaceState(null, "", u);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, [contenteditable]") || e.metaKey || e.ctrlKey || e.altKey) return;
      const i = CONCEPTS.findIndex((c) => c.id === concept);
      if (e.key === "]") go(CONCEPTS[(i + 1) % CONCEPTS.length].id, person);
      else if (e.key === "[") go(CONCEPTS[(i + CONCEPTS.length - 1) % CONCEPTS.length].id, person);
      else if (["1", "2", "3"].includes(e.key)) go(concept, PEOPLE[Number(e.key) - 1].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [concept, person, go]);

  const persona = PERSONAS[person];
  const prs = counted(persona, team);
  const props = { persona, prs, reduced };
  const key = `${concept}-${person}-${team}-${reduced}`;

  return (
    <div className="hx" data-reduced={reduced || undefined}>
      <div key={key} className="hx-page">
        {concept === "tree" && <Tree {...props} />}
        {concept === "changelog" && <Changelog {...props} />}
        {concept === "odds" && <Odds {...props} />}
        {concept === "wrapped" && <Wrapped {...props} />}
      </div>

      <div className="hx-lab" role="toolbar" aria-label="Prototype controls">
        <div className="hx-lab-row">
          <span className="hx-lab-tag">lab</span>
          {CONCEPTS.map((c) => (
            <button key={c.id} type="button" aria-pressed={concept === c.id} onClick={() => go(c.id, person)}>{c.label}</button>
          ))}
        </div>
        <div className="hx-lab-row">
          {PEOPLE.map((p) => (
            <button key={p.id} type="button" aria-pressed={person === p.id} onClick={() => go(concept, p.id)}>{p.label}</button>
          ))}
          <button type="button" aria-pressed={team} onClick={() => setTeam(!team)}>count team repos</button>
          <button type="button" aria-pressed={reduced} disabled={osReduced} onClick={() => setLabReduced(!labReduced)}>reduced motion</button>
        </div>
      </div>
    </div>
  );
}
