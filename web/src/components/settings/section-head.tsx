// The top of each settings section: its name, and one line on what's in it.
import { section, type SectionId } from "@/lib/settings";

export function SectionHead({ id, children }: { id: SectionId; children?: React.ReactNode }) {
  const s = section(id);
  return (
    <div className="mb-6">
      <h2 id={`${s.id}-h`} className="text-[clamp(1.4rem,4vw,1.8rem)] font-semibold tracking-tight">{s.title}</h2>
      {children && <div className="prose-sans mt-2 text-[1rem] text-muted">{children}</div>}
    </div>
  );
}

/** A green, orange or plain notice after a form. */
export function Notice({ tone, children }: { tone: "good" | "bad" | "plain"; children: React.ReactNode }) {
  const cls =
    tone === "good" ? "text-green border-green/50 bg-green/10"
    : tone === "bad" ? "text-orange border-orange/50 bg-orange/10"
    : "text-muted border-line-strong";
  return <p role="status" className={`mb-6 border px-4 py-3 font-sans text-[0.875rem] ${cls}`}>{children}</p>;
}
