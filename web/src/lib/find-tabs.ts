// Find a project is one place with tabs (the dashboard plan): a search
// shaped by your picks (/find), ranked boards (/discover) and, around
// October, Hacktoberfest. Each tab keeps its own public URL. Pure, so it runs
// under `node --test`.

export type FindTab = "find" | "browse" | "hacktoberfest";

export interface FindTabLink {
  id: FindTab;
  label: string;
  href: string;
}

/** The tabs, in order. Hacktoberfest shows around October, and always on its own page. */
export function findTabs(opts: { signedIn: boolean; season: boolean; current: FindTab }): FindTabLink[] {
  const tabs: FindTabLink[] = [
    { id: "find", label: opts.signedIn ? "For you" : "Starter issues", href: "/find" },
    { id: "browse", label: "Browse", href: "/discover" },
  ];
  if (opts.season || opts.current === "hacktoberfest") tabs.push({ id: "hacktoberfest", label: "Hacktoberfest", href: "/hacktoberfest" });
  return tabs;
}

