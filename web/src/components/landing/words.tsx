// Text that turns up as you scroll (the expressive design plan): each word
// rises into place as it comes up the screen, tied to the scroll position by
// a CSS view timeline (globals.css, .rw). No JS, and it works with Lenis and
// on phones. Where view timelines aren't supported, and under reduced motion,
// the words simply sit there: the HTML is the finished state. `quiet` words
// (e.g. "void") land last and stay dim.
export function Words({ text, quiet = [] }: { text: string; quiet?: string[] }) {
  const words = text.split(" ");
  return (
    <span className="rw">
      {words.map((w, i) => (
        <span key={i}>
          <span className={`rw-word ${quiet.includes(w.replace(/[.,!?]$/, "")) ? "rw-quiet" : ""}`} style={{ ["--w" as string]: Math.min(i, 8) }}>
            {w}
          </span>
          {i < words.length - 1 && " "}
        </span>
      ))}
    </span>
  );
}
