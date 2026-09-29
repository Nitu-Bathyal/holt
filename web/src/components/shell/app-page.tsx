// The app shell's page parts, so every signed-in page reads as one product
// (docs/design/DASHBOARD.md): one frame (`.app-page`: same left edge and
// width everywhere), a page head in the landing's display type with the cat
// reacting on the right, and a section heading with one quiet link.
import Link from "next/link";
import { CatFace } from "@/components/cat-face";
import { CAT, TONE_TEXT, type CatMood } from "@/lib/cat";

export function AppPageHeader({ title, lead, mood, children }: { title: React.ReactNode; lead?: React.ReactNode; mood?: CatMood; children?: React.ReactNode }) {
  return (
    <header className="app-head">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <h1 className="app-h1">{title}</h1>
          {lead && <p className="app-lead">{lead}</p>}
        </div>
        {mood && <CatFace mood={mood} className={`app-head-cat hidden sm:block ${TONE_TEXT[CAT[mood].tone]}`} />}
      </div>
      {children}
    </header>
  );
}

/**
 * Nothing to show: the cat, one sentence, and the one next thing to do
 * (DASHBOARD.md, "Empty states"). The first action is the loud one; any
 * others should be quiet text links. The cat lands once (globals.css).
 */
export function EmptyState({ title, mood = "thinking", children }: { title: React.ReactNode; mood?: CatMood; children?: React.ReactNode }) {
  return (
    <div className="app-empty">
      <CatFace mood={mood} className="app-empty-cat" />
      <p className="app-empty-line">{title}</p>
      {children && <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3">{children}</div>}
    </div>
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
