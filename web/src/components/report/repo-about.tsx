// Under a report's repo name: what the project is and how big and alive it is,
// from GitHub (the server's `about`). Public data, so every visitor sees it,
// signed in or not. Small type: the verdict below stays the headline.
import { timeAgo } from "@/lib/format";
import { aboutNumbers, flags, readmeShown, share, siteLabel, type RepoAbout as About } from "@/lib/repo-about";
import { langColor } from "@/lib/repo-card";

const TOPICS_SHOWN = 5;

export function RepoAbout({ about }: { about: About | null | undefined }) {
  if (!about) return null;
  const readme = readmeShown(about);
  const numbers = aboutNumbers(about);
  const marks = flags(about);
  const topics = about.topics.slice(0, TOPICS_SHOWN);
  return (
    <section aria-label="About this repo" className="mb-6 max-w-3xl space-y-3" data-repo-about>
      {(about.description || readme) && (
        <div className="space-y-1 font-sans">
          {about.description && <p className="text-[1rem] leading-snug text-ink [overflow-wrap:anywhere]">{about.description}</p>}
          {readme && <p className="line-clamp-2 text-[0.92rem] leading-snug text-muted [overflow-wrap:anywhere]">{readme}</p>}
        </div>
      )}

      {(marks.length > 0 || topics.length > 0) && (
        <ul className="flex flex-wrap gap-1.5 text-[0.78rem]">
          {marks.map((f) => (
            <li key={f.kind} className={`border px-1.5 py-0.5 ${f.kind === "archived" ? "border-amber/60 text-amber" : "border-line-strong text-ink"}`}>
              {f.repo ? (
                <a href={`/${f.repo}`} className="hover:text-blue">{f.text}</a>
              ) : (
                f.text
              )}
            </li>
          ))}
          {topics.map((t) => (
            <li key={t} className="border border-blue/30 bg-blue/5 px-1.5 py-0.5 text-blue">{t}</li>
          ))}
        </ul>
      )}

      <dl className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-[0.85rem] text-muted">
        {numbers.map((n) => (
          <div key={n.label} className="flex items-baseline gap-1.5">
            <dt className="order-2">{n.label}</dt>
            <dd className="order-1 font-semibold text-ink">{n.value}</dd>
          </div>
        ))}
        {about.license && (
          <div className="flex items-baseline gap-1.5">
            <dt className="sr-only">licence</dt>
            <dd>{about.license}</dd>
          </div>
        )}
      </dl>

      {about.languages.length > 0 && (
        <div className="max-w-md">
          <div aria-hidden="true" className="flex h-1.5 overflow-hidden bg-line">
            {about.languages.map((l) => {
              const color = langColor(l.name);
              return (
                <span
                  key={l.name}
                  className={color ? undefined : "bg-faint"}
                  style={{ width: `${Math.max(l.share * 100, 1)}%`, ...(color ? { background: color } : {}) }}
                />
              );
            })}
          </div>
          <p className="mt-1.5 flex flex-wrap gap-x-4 text-[0.8rem] text-muted">
            {about.languages.map((l) => (
              <span key={l.name}>
                {l.name} <span className="text-faint">{share(l.share)}</span>
              </span>
            ))}
          </p>
        </div>
      )}

      <p className="flex flex-wrap gap-x-4 gap-y-1 text-[0.8rem] text-faint">
        {about.pushed_at && (
          <span>
            pushed <time dateTime={about.pushed_at} suppressHydrationWarning>{timeAgo(about.pushed_at)}</time>
          </span>
        )}
        {about.created_at && (
          <span>
            since <time dateTime={about.created_at}>{new Date(about.created_at).getUTCFullYear()}</time>
          </span>
        )}
        {about.default_branch && <span>branch {about.default_branch}</span>}
        {about.homepage && (
          <a href={about.homepage} target="_blank" rel="noopener noreferrer nofollow" className="max-w-full truncate hover:text-blue">
            {siteLabel(about.homepage)} ↗
          </a>
        )}
      </p>
    </section>
  );
}
