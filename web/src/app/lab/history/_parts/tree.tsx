"use client";
// PROTOTYPE, don't merge. Concept A, "where it landed": your work as a `tree`
// of the files it lives in, across every repo. The map is the codebase itself.
// Needs the paths each PR touched (new server data, docs/design/HISTORY.md).
import { useEffect, useMemo, useState } from "react";
import type { Pr } from "./data";
import { day, duration, since, tookDays, url } from "./facts";
import { Head, type ConceptProps } from "./ui";

interface Node {
  key: string;
  name: string;
  dir: boolean;
  kids: Node[];
  prs: Pr[];
  /** Distinct PRs anywhere under this node. */
  count: number;
  root?: boolean;
}

const MANY = 8;
const SHOWN = 6;

function build(prs: Pr[]): Node[] {
  const repos = new Map<string, Node>();
  for (const pr of prs) {
    let root = repos.get(pr.repo);
    if (!root) repos.set(pr.repo, (root = { key: pr.repo, name: pr.repo, dir: true, kids: [], prs: [], count: 0, root: true }));
    for (const file of pr.files) {
      let at = root;
      const parts = file.split("/");
      parts.forEach((part, i) => {
        const dir = i < parts.length - 1;
        let next = at.kids.find((k) => k.name === part && k.dir === dir);
        if (!next) at.kids.push((next = { key: `${at.key}/${part}`, name: part, dir, kids: [], prs: [], count: 0 }));
        if (!next.prs.includes(pr)) next.prs.push(pr);
        at = next;
      });
    }
    if (!root.prs.includes(pr)) root.prs.push(pr);
  }
  const finish = (n: Node): Node => {
    n.kids = n.kids.map(finish);
    // src/vs/workbench/contrib/… reads as one line, the way people say it.
    while (n.dir && !n.root && n.kids.length === 1 && n.kids[0].dir) {
      const only = n.kids[0];
      n = { ...n, name: `${n.name}/${only.name}`, key: only.key, kids: only.kids };
    }
    n.count = n.prs.length;
    n.kids.sort((a, b) => b.count - a.count || Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
    return n;
  };
  return [...repos.values()].map(finish).sort((a, b) => b.count - a.count);
}

interface Line { key: string; lead: string; node?: Node; more?: { key: string; hidden: number }; depth: number }

export function Tree({ persona, prs, reduced }: ConceptProps) {
  const [all, setAll] = useState(false);
  const [flipped, setFlipped] = useState<Set<string>>(new Set());
  const [shown, setShown] = useState<string | null>(null);
  const [printing, setPrinting] = useState(!reduced);

  const list = useMemo(() => (all ? prs : prs.filter((x) => x.state === "merged")), [prs, all]);
  const roots = useMemo(() => build(list), [list]);

  useEffect(() => {
    if (!printing) return;
    const t = setTimeout(() => setPrinting(false), 1600);
    return () => clearTimeout(t);
  }, [printing]);

  const isOpen = (n: Node, depth: number) => (depth < 2 || n.count <= 6) !== flipped.has(n.key);
  const flip = (key: string) => {
    const next = new Set(flipped);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setFlipped(next);
  };

  const lines: Line[] = [];
  const walk = (nodes: Node[], lead: string, depth: number, parentKey: string) => {
    const cut = nodes.length > MANY && !flipped.has(`${parentKey}#more`);
    const visible = cut ? nodes.slice(0, SHOWN) : nodes;
    visible.forEach((n, i) => {
      const last = i === visible.length - 1 && !cut;
      lines.push({ key: n.key, lead: lead + (last ? "└── " : "├── "), node: n, depth });
      if (n.dir && isOpen(n, depth)) walk(n.kids, lead + (last ? "    " : "│   "), depth + 1, n.key);
    });
    if (cut) lines.push({ key: `${parentKey}#more`, lead: `${lead}└── `, more: { key: `${parentKey}#more`, hidden: nodes.length - SHOWN }, depth });
  };
  walk(roots, "", 0, "~");

  const merged = prs.filter((x) => x.state === "merged");
  const files = new Set(merged.flatMap((x) => x.files.map((f) => `${x.repo}/${f}`)));
  const repos = new Set(merged.map((x) => x.repo));
  const title = files.size === 1
    ? <>You&apos;re in {merged[0].repo}: {merged[0].files[0]}</>
    : <>You&apos;re in {files.size} files across {repos.size} repos.</>;

  return (
    <section>
      <Head title={title} sub={`merged since ${since()}`}>
        <div className="hx-seg" role="group" aria-label="Show">
          <button type="button" aria-pressed={!all} onClick={() => setAll(false)}>landed</button>
          <button type="button" aria-pressed={all} onClick={() => setAll(true)}>everything</button>
        </div>
      </Head>

      <div className={`hx-tree ${printing ? "hx-printing" : ""}`}>
        <p className="hx-cmd"><span className="text-amber">$</span> holt tree ~/{persona.login}{all ? "" : " --landed"}</p>
        <p className="hx-line text-faint" style={{ "--i": 0 } as React.CSSProperties}>~/{persona.login}</p>
        {lines.map((l, i) => (
          <div key={l.key} className="hx-line" style={{ "--i": Math.min(i + 1, 48) } as React.CSSProperties}>
            <span className="hx-lead" aria-hidden="true">{l.lead}</span>
            {l.more ? (
              <button type="button" className="hx-more" onClick={() => flip(l.more!.key)}>… {l.more.hidden} more</button>
            ) : l.node!.dir ? (
              <DirLine node={l.node!} root={l.depth === 0} open={isOpen(l.node!, l.depth)} onToggle={() => flip(l.node!.key)} team={!!persona.repos[l.node!.name]?.team} all={all} />
            ) : (
              <FileLine node={l.node!} open={shown === l.node!.key} onToggle={() => setShown(shown === l.node!.key ? null : l.node!.key)} lead={l.lead} />
            )}
          </div>
        ))}
        <p className="hx-line mt-3 text-faint" style={{ "--i": Math.min(lines.length + 1, 49) } as React.CSSProperties}>
          {repos.size} {repos.size === 1 ? "repo" : "repos"}, {files.size} {files.size === 1 ? "file" : "files"}, {merged.length} merged
        </p>
      </div>
      {persona.before && (
        <p className="mt-6 font-sans text-[0.9rem] text-muted">
          Before this: your first merged PR, <a className="hx-link" href={`https://github.com/${persona.before.repo}/pull/${persona.before.number}`}>{persona.before.repo}#{persona.before.number}</a>, {day(persona.before.date)}.
        </p>
      )}
    </section>
  );
}

function DirLine({ node, root, open, onToggle, team, all }: { node: Node; root: boolean; open: boolean; onToggle: () => void; team: boolean; all: boolean }) {
  return (
    <>
      <button type="button" className={`hx-dir ${root ? "hx-root" : ""}`} aria-expanded={open} onClick={onToggle}>
        {node.name}/{!open && <span className="text-faint"> …</span>}
      </button>
      {team && <span className="hx-tag">team</span>}
      <span className="hx-count">{node.count} {all ? (node.count === 1 ? "PR" : "PRs") : "merged"}</span>
    </>
  );
}

const STATE = { merged: "text-green", open: "text-blue", closed: "text-faint" } as const;

function FileLine({ node, open, onToggle, lead }: { node: Node; open: boolean; onToggle: () => void; lead: string }) {
  const latest = [...node.prs].sort((a, b) => Date.parse(b.opened) - Date.parse(a.opened));
  return (
    <>
      <button type="button" className="hx-file" aria-expanded={open} onClick={onToggle}>{node.name}</button>
      <span className="hx-chips">
        {latest.slice(0, 3).map((x) => (
          <a key={x.number} href={url(x)} className={`hx-chip ${STATE[x.state]}`} title={x.title}>#{x.number}</a>
        ))}
        {latest.length > 3 && <span className="text-faint">+{latest.length - 3}</span>}
      </span>
      {open && (
        <ul className="hx-detail">
          {latest.map((x) => (
            <li key={x.number}>
              <span className="hx-lead" aria-hidden="true">{lead.replace(/[├└]── $/, (m) => (m.startsWith("├") ? "│   " : "    "))}</span>
              <a href={url(x)} className={STATE[x.state]}>#{x.number}</a>{" "}
              <span className="font-sans">{x.title}</span>{" "}
              <span className="text-faint">
                {x.state === "merged" ? `merged ${day(x.done!)}, in ${duration(tookDays(x))}` : x.state === "open" ? `waiting since ${day(x.opened)}` : `closed ${day(x.done!)}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
