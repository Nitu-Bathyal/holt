// The app shell's page parts, so every signed-in page reads as one product:
// a page header (the /discover title size, no backdrop) and a section
// heading with one quiet link.
import Link from "next/link";

export function AppPageHeader({ title, lead, children }: { title: React.ReactNode; lead?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <header className="pb-6 pt-8 sm:pt-10">
      <h1 className="text-[clamp(1.45rem,3.4vw,2.1rem)] font-semibold leading-tight tracking-tight [overflow-wrap:anywhere]">{title}</h1>
      {lead && <p className="mt-2 max-w-2xl font-sans text-[0.95rem] text-muted">{lead}</p>}
      {children}
    </header>
  );
}

export function SectionHead({ id, title, more, note }: { id: string; title: string; more?: { href: string; label: string }; note?: string | null }) {
  return (
    <div className="section-head">
      <h2 id={id}>{title}</h2>
      <span className="flex flex-wrap items-baseline gap-x-4 text-[0.82rem]">
        {note && <span className="text-faint">{note}</span>}
        {more && <Link href={more.href} className="inline-flex min-h-11 items-center text-blue hover:underline sm:min-h-0">{more.label}</Link>}
      </span>
    </div>
  );
}
