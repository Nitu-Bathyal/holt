// The top band every inner page shares with the landing hero: the same dot
// grid and glow (static gradients), and a rule underneath.
// `compact` is for tool pages (find, discover, compare), where the answer, not the headline, should fill the first screen.
export function PageHead({ children, narrow = false, compact = false, className = "" }: { children: React.ReactNode; narrow?: boolean; compact?: boolean; className?: string }) {
  return (
    <section className={`relative overflow-hidden border-b border-line ${className}`}>
      <div aria-hidden="true" className="hero-backdrop" />
      <div className={`wrap relative ${compact ? "py-6 sm:py-8" : "py-10 sm:py-14"} ${narrow ? "max-w-3xl" : ""}`}>{children}</div>
    </section>
  );
}
