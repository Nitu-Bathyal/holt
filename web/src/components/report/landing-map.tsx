import { areaHistoryHref, areaHref, areaLabel } from "@/lib/landing";
import type { Report } from "@/lib/types";

/**
 * Where outside pull requests were merged, as thin rows: the folder (a link to
 * it on GitHub), how many of the pull requests there were merged, a bar for
 * that share, and a link to the folder's recent changes. Folders where nothing
 * from outsiders has been merged yet follow as links too.
 */
export function LandingMap({ landing, neverLanded, repo }: { landing: Report["landing"]; neverLanded: Report["never_landed"]; repo: string }) {
  if (!landing.length && !neverLanded.length) {
    return <p className="font-sans text-muted">Holt didn&apos;t see enough outside work to map where it lands.</p>;
  }
  return (
    <div className="space-y-4">
      {landing.length > 0 && (
        <ul className="divide-y divide-line border-y border-line" aria-label="Folders where outside pull requests were merged">
          {landing.map((l) => {
            const share = l.attempted ? l.merged / l.attempted : 0;
            return (
              <li key={l.path} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 py-2 sm:grid-cols-[minmax(0,1fr)_6rem_6.5rem_4.5rem]">
                <a href={areaHref(repo, l)} target="_blank" rel="noopener noreferrer" className="min-w-0 truncate font-mono text-[0.88rem] text-ink hover:text-blue hover:underline">
                  {areaLabel(l)}
                  <span className="sr-only"> on GitHub (opens in a new tab)</span>
                </a>
                <span className="text-right font-sans text-[0.85rem] tabular-nums text-muted sm:order-3">
                  <strong className="font-semibold text-ink">{l.merged}</strong> of {l.attempted} merged
                </span>
                <span aria-hidden="true" className="col-span-2 block h-1 bg-line sm:order-2 sm:col-span-1">
                  <span className="block h-full bg-blue" style={{ width: `${Math.max(share * 100, l.merged ? 3 : 0)}%` }} />
                </span>
                <a href={areaHistoryHref(repo, l)} target="_blank" rel="noopener noreferrer" className="hidden text-right font-sans text-[0.8rem] text-faint hover:text-blue sm:order-4 sm:block">
                  history ↗<span className="sr-only"> of {areaLabel(l)} on GitHub (opens in a new tab)</span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
      {neverLanded.length > 0 && (
        <p className="font-sans text-[0.85rem] leading-relaxed text-muted">
          <span className="text-faint">Nothing from outsiders merged yet in </span>
          {neverLanded.map((l, i) => (
            <span key={l.path}>
              {i > 0 && <span className="text-faint">, </span>}
              <a href={areaHref(repo, l)} target="_blank" rel="noopener noreferrer" className="font-mono text-[0.82rem] text-ink hover:text-blue hover:underline">
                {areaLabel(l)}
                <span className="sr-only"> on GitHub (opens in a new tab)</span>
              </a>
              <span className="text-orange"> ({l.attempted} tried)</span>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
