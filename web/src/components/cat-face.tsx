import { CAT, TONE_TEXT, type CatMood } from "@/lib/cat";

// `perk` adds the hero cat's hover face (^ eyes, ᴗ mouth) as overlays that CSS
// reveals when a `.cat-perk` ancestor is hovered or focused. The overlays are
// absolutely positioned, so the resting face keeps its exact width.
export function CatFace({ mood = "ready", className = "", blink = false, perk = false }: { mood?: CatMood; className?: string; blink?: boolean; perk?: boolean }) {
  const c = CAT[mood];
  const eye = blink ? { animation: "blink 4.5s infinite" } : undefined;
  const alt = (rest: string, hover: string) =>
    perk ? (
      <>
        <span className="cat-rest">{rest}</span>
        <span className="cat-alt">{hover}</span>
      </>
    ) : (
      rest
    );
  return (
    <span className={`cat-face ${TONE_TEXT[c.tone]} ${className}`} aria-hidden="true">
      <span>(=</span>
      <span className="cat-ear">{c.ears[0]}</span>
      <span className="cat-eye" style={eye}>{alt(c.eyes[0], "^")}</span>
      <span className="cat-mouth">{alt(c.mouth, "ᴗ")}</span>
      <span className="cat-eye" style={eye}>{alt(c.eyes[1], "^")}</span>
      <span className="cat-ear">{c.ears[1]}</span>
      <span>=)</span>
    </span>
  );
}
