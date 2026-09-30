// "About this project", right under the verdict: what the project is, how big
// and alive it is, what you'd need to know to work on it, and where to ask for
// help. GitHub's own facts (the server's `about`, API.md); nothing here feeds
// the verdict, and a fact GitHub didn't give is left out, not guessed.
// Compact on purpose: two columns from `md` up, so it fits beside the fold.
import { timeAgo } from "@/lib/format";
import { helpLinks, projectFacts, readmeShown, share, type RepoAbout } from "@/lib/repo-about";
import { langColor } from "@/lib/repo-card";

export function ProjectSection({ about }: { about: RepoAbout }) {
  const readme = readmeShown(about);
  const facts = projectFacts(about);
  const help = helpLinks(about);
  const langs = about.languages;
  const text = about.description || readme;
  if (!text && !facts.length && !langs.length && !help.length) return null;
  const side = langs.length > 0 || help.length > 0;

  return (
    <section aria-labelledby="project" className="border-t border-line pt-5">
      <h2 id="project" className="mb-3 text-[1.05rem] font-semibold tracking-tight sm:text-[1.15rem]">About this project</h2>
      <div className={`grid gap-x-8 gap-y-4 ${side ? "md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" : ""}`} data-project>
        <div className="min-w-0">
          {text && (
            <p className="font-sans text-[0.95rem] leading-snug text-ink">
              {about.description}
              {about.description && readme && " "}
              {readme && <span className="text-muted">{readme}</span>}
            </p>
          )}

          {about.topics.length > 0 && (
            <ul aria-label="Topics" className="mt-2 flex flex-wrap gap-1.5 text-[0.75rem]">
              {about.topics.slice(0, 8).map((t) => (
                <li key={t} className="border border-blue/30 bg-blue/5 px-1.5 py-px text-blue">{t}</li>
              ))}
            </ul>
          )}

          {facts.length > 0 && (
            <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-2" data-project-facts>
              {facts.map((f) => (
                <div key={f.label} className="flex items-baseline gap-1.5">
                  <dd className="text-[0.95rem] font-semibold text-ink">
                    {f.href ? (
                      <a href={f.href} target="_blank" rel="noopener noreferrer" className="hover:text-blue">
                        {f.value}
                        <span className="sr-only"> (opens GitHub)</span>
                      </a>
                    ) : (
                      f.value
                    )}
                    {f.since && (
                      <time dateTime={f.since} suppressHydrationWarning className={f.value ? "ml-1.5 text-[0.82rem] font-normal text-muted" : ""}>
                        {timeAgo(f.since)}
                      </time>
                    )}
                  </dd>
                  <dt className="text-[0.8rem] text-faint">{f.label}</dt>
                </div>
              ))}
            </dl>
          )}
        </div>

        {side && (
          <div className="min-w-0 space-y-3">
            {langs.length > 0 && (
              <div data-project-languages>
                <h3 className="text-[0.78rem] uppercase tracking-[0.08em] text-faint">What you&apos;d need to know</h3>
                {/* One rounded bar cut into each language's share, then a key with a dot and its share. */}
                <div role="img" aria-label={langs.map((l) => `${l.name} ${share(l.share)}`).join(", ")} className="mt-2 flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-line/60">
                  {langs.map((l) => (
                    <span key={l.name} className="min-w-1.5 first:rounded-l-full last:rounded-r-full" style={{ flexGrow: Math.max(l.share, 0.02), flexBasis: 0, background: langColor(l.name) ?? "var(--color-faint, #8b8b8b)" }} />
                  ))}
                </div>
                <ul className="mt-2.5 flex flex-wrap gap-1.5 font-sans text-[0.85rem]">
                  {langs.map((l) => (
                    <li key={l.name} className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-panel-2/60 px-2.5 py-0.5">
                      <span aria-hidden="true" className="size-2 rounded-full" style={{ background: langColor(l.name) ?? "var(--color-faint, #8b8b8b)" }} />
                      <span className="font-medium text-ink">{l.name}</span>
                      <span className="tabular-nums text-faint">{share(l.share)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {help.length > 0 && (
              <div data-project-help>
                <h3 className="text-[0.78rem] uppercase tracking-[0.08em] text-faint">Rules and help</h3>
                <ul className="mt-1.5 flex flex-wrap gap-1.5">
                  {help.map((l) => (
                    <li key={l.url}>
                      <a href={l.url} target="_blank" rel="noopener noreferrer nofollow" title={l.note} className="inline-flex min-h-8 items-center gap-1 border border-line-strong px-2 py-1 text-[0.82rem] text-ink hover:border-blue hover:text-blue">
                        {l.label}
                        <span aria-hidden="true" className="text-faint">↗</span>
                        <span className="sr-only"> ({l.note}; opens in a new tab)</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
