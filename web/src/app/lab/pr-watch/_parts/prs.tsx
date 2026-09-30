// PROTOTYPE: My PRs with the watch state. Engine 6b's groups and free line,
// plus a bell per open row (watching or muted) and a "new" tag for an unread
// alert. Without access, no bells: the line stays.
import Link from "next/link";
import { WatchToggle } from "@/components/alerts/watch-toggle";
import type { Access } from "@/components/alerts/types";
import { SectionHead } from "@/components/shell/app-page";
import { PRS, type MockPr } from "../mock";

const RULE = { turn: "var(--orange)", waiting: "var(--blue)", merged: "var(--green)", closed: "var(--line-strong)" };
const GROUPS: { id: MockPr["group"]; title: string }[] = [
  { id: "turn", title: "Your turn" },
  { id: "waiting", title: "Waiting" },
  { id: "merged", title: "Merged" },
  { id: "closed", title: "Closed" },
];

function Row({ p, watch, fresh }: { p: MockPr; watch: boolean; fresh: boolean }) {
  const [owner, name] = p.repo.split("/");
  const open = p.group === "turn" || p.group === "waiting";
  const max = p.bar ? Math.max(p.bar.days, p.bar.mark) * 1.25 : 1;
  return (
    <li data-rule data-stack className="app-row grid-cols-[minmax(0,1fr)_auto]" style={{ "--rule": RULE[p.group] } as React.CSSProperties}>
      <div className="min-w-0 pl-2">
        <p className="flex flex-wrap items-baseline gap-x-2 text-[0.9rem]">
          <Link href={`/${p.repo}`} className="tap z-10 font-semibold tracking-tight hover:text-blue"><span className="font-normal text-muted">{owner}/</span>{name}</Link>
          <span className="text-[0.8rem] text-faint">#{p.number}</span>
          {fresh && p.fresh && !p.muted && <span className="border border-orange/50 px-1.5 text-[0.72rem] text-orange">new</span>}
        </p>
        <a href={`https://github.com/${p.repo}/pull/${p.number}`} className="mt-0.5 block truncate font-sans text-[0.95rem] after:absolute after:inset-0 hover:underline">{p.title}</a>
        {p.bar ? (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <div
              className="wait-bar"
              aria-hidden="true"
              style={{ "--w": `${(p.bar.days / max) * 100}%`, "--t": `${(p.bar.mark / max) * 100}%`, "--c": p.bar.late ? "var(--orange)" : "var(--blue)" } as React.CSSProperties}
            >
              <span />
              <i />
            </div>
            <span className={`text-[0.8rem] ${p.bar.late ? "text-orange" : "text-faint"}`}>{p.line}</span>
          </div>
        ) : (
          <p className={`mt-1 text-[0.8rem] ${p.group === "turn" ? "text-orange" : "text-faint"}`}>{p.line}</p>
        )}
      </div>
      <div className="relative z-10 flex flex-wrap items-center gap-x-4 gap-y-2 sm:flex-nowrap">
        {watch && open && <WatchToggle pr={`${name} #${p.number}`} initialMuted={p.muted} />}
        {p.group === "turn" && <a href={`https://github.com/${p.repo}/pull/${p.number}`} className="btn-primary min-h-11 px-4 text-[0.84rem] sm:min-h-10">open it ↗</a>}
      </div>
    </li>
  );
}

export function PrList({ access }: { access: Access }) {
  const watch = access === "on" || access === "empty";
  return (
    <div className="space-y-10">
      {GROUPS.map((g) => {
        const rows = PRS.filter((p) => p.group === g.id);
        return (
          <section key={g.id} aria-labelledby={`lab-${g.id}-h`}>
            <SectionHead id={`lab-${g.id}-h`} title={g.title} note={String(rows.length)} />
            <ul>
              {rows.map((p) => (
                <Row key={p.number} p={p} watch={watch} fresh={access === "on"} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
