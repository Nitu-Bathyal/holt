// "Contributing here": what it is like to send work to this project, in the
// few lines the README and the sidebar don't already say. Who works on it, what
// it asks before a pull request (the report's `asks`), how active it is, and
// where to ask. The description is in the page header and the numbers are in
// the sidebar, so neither is repeated here. GitHub's own facts and Holt's
// reading of the threads; nothing here feeds the verdict, and a fact that
// isn't known is left out, not guessed.
import { timeAgo } from "@/lib/format";
import { compactCount, helpLinks, houseRules, type Ask, type HelpLink, type RepoAbout } from "@/lib/repo-about";

// Somewhere to ask a question, before the contributing guide or the project's site.
const ASK_FIRST = ["GitHub Discussions", "Discord chat", "Slack chat", "Zulip chat", "Matrix chat", "Gitter chat"];

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-x-6">
      <dt className="text-[0.85rem] leading-[1.6] text-faint">{label}</dt>
      <dd className="font-sans text-[0.93rem] leading-snug text-ink">{children}</dd>
    </div>
  );
}

/** Links in a line, each with its note for anyone hovering or listening. */
function Links({ links }: { links: HelpLink[] }) {
  return (
    <span className="flex flex-wrap gap-x-4 gap-y-1">
      {links.map((l) => (
        <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer nofollow" title={l.note} className="text-link">
          {l.label} <span aria-hidden="true">↗</span>
          <span className="sr-only"> ({l.note}; opens in a new tab)</span>
        </a>
      ))}
    </span>
  );
}

export function ProjectSection({ about, asks }: { about: RepoAbout; asks: Ask[] }) {
  const rules = houseRules(asks);
  const help = helpLinks(about);
  // The rules to read, and somewhere to talk: the sidebar no longer repeats either.
  const read = help.filter((l) => !ASK_FIRST.includes(l.label));
  const ask = help.filter((l) => ASK_FIRST.includes(l.label));
  const release = about.latest_release;
  const people = about.contributors;

  const rows: { label: string; body: React.ReactNode }[] = [];
  if (people != null && people > 0) {
    rows.push({
      label: "who's here",
      body: (
        <>
          {compactCount(people)} {people === 1 ? "person has" : "people have"} had code accepted here
          {about.open_pull_requests != null && <span className="text-muted">, with {compactCount(about.open_pull_requests)} pull requests open now</span>}.
        </>
      ),
    });
  }
  if (read.length) {
    rows.push({
      label: "read first",
      body: <Links links={read} />,
    });
  }
  if (rules.length) {
    rows.push({
      label: "before your PR",
      body: (
        <ul className="space-y-1">
          {rules.map((r) => (
            <li key={r.text}>
              {r.text}{" "}
              <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-[0.82rem] text-faint hover:text-blue">
                where it says so <span aria-hidden="true">↗</span>
              </a>
            </li>
          ))}
        </ul>
      ),
    });
  }
  if (release?.published_at || about.pushed_at) {
    rows.push({
      label: "how active",
      body: (
        <>
          {release?.published_at && (
            <>
              Last release{" "}
              <a href={release.url} target="_blank" rel="noopener noreferrer" className="text-link">{release.tag}</a>,{" "}
              <time dateTime={release.published_at} suppressHydrationWarning>{timeAgo(release.published_at)}</time>
            </>
          )}
          {release?.published_at && about.pushed_at && <span className="text-faint"> · </span>}
          {about.pushed_at && (
            <>
              {release?.published_at ? "last" : "Last"} code pushed{" "}
              <time dateTime={about.pushed_at} suppressHydrationWarning>{timeAgo(about.pushed_at)}</time>
            </>
          )}
          .
        </>
      ),
    });
  }
  if (ask.length) {
    rows.push({
      label: "ask questions",
      body: <Links links={ask} />,
    });
  }
  if (!rows.length) return null;

  return (
    <section aria-labelledby="project">
      <h2 id="project" className="mb-2 text-[1.05rem] font-semibold tracking-tight sm:text-[1.15rem]">Contributing here</h2>
      <dl className="divide-y divide-dashed divide-line border-y border-line">
        {rows.map((r) => (
          <Row key={r.label} label={r.label}>{r.body}</Row>
        ))}
      </dl>
    </section>
  );
}
