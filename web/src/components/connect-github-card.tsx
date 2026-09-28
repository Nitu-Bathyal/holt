// GitHub in settings. Accounts shows the connection (connect, disconnect);
// Privacy shows the statistics switch. Connecting itself happens on /connect,
// which shows the notice and the 18+ box.
import Link from "next/link";
import { disconnect, setStats } from "@/app/connect/actions";
import { shortDate } from "@/lib/format";
import type { GitHubConnection } from "@/lib/types";

/** The one plain line people agree to by connecting. Shown on /connect and in settings. */
export const STATS_NOTICE =
  "Connecting lets Holt track your public contributions and include them anonymously in repo statistics (shown only when 5+ people contribute).";

type Account = GitHubConnection["account"];

export function GitHubConnectionCard({ acct }: { acct: Account }) {
  if (!acct) {
    return (
      <div className="border border-line-strong bg-panel p-5 shadow-soft">
        <p className="font-semibold">GitHub isn&apos;t connected</p>
        <p className="prose-sans mt-1 text-[0.92rem] text-muted">
          Connect it to see your public PRs with Holt&apos;s verdict on each repo, and get picks from where they got merged. Free. Holt only reads
          public data and never posts.
        </p>
        <Link href="/connect" className="btn-primary mt-4 inline-flex">connect GitHub</Link>
      </div>
    );
  }
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 border border-green/50 bg-green/10 p-4">
        <div className="min-w-0 text-[0.89rem]">
          <p className="text-green">
            ● connected as{" "}
            <a href={`https://github.com/${acct.login}`} target="_blank" rel="noopener noreferrer" className="font-semibold [overflow-wrap:anywhere] hover:underline">
              @{acct.login}
            </a>
          </p>
          <p className="mt-1 text-muted">since {shortDate(acct.connected_at)}</p>
          <Link href="/me/contributions" className="mt-2 inline-block text-link">see your contributions →</Link>
        </div>
        <form action={disconnect}>
          <button type="submit" className="btn-ghost text-orange">disconnect</button>
        </form>
      </div>
      <p className="mt-3 font-sans text-[0.87rem] text-faint">
        Disconnecting deletes the connection, the list of repos you viewed on Holt and your saved pull requests.
      </p>
    </>
  );
}

/** "Don't include me in statistics". Only means something once GitHub is connected. */
export function StatsSwitch({ acct }: { acct: NonNullable<Account> }) {
  return (
    <form action={setStats} className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 flex-1 basis-64">
        <p className="text-[0.95rem] font-semibold" id="stats-label">Don&apos;t include me in statistics</p>
        <p className="prose-sans mt-1 text-[0.89rem] text-muted">{STATS_NOTICE}</p>
      </div>
      {/* One click flips it: the button sends the opposite of what's saved. */}
      {!acct.stats_opt_out && <input type="hidden" name="stats_opt_out" value="on" />}
      <button
        type="submit"
        role="switch"
        aria-checked={acct.stats_opt_out}
        aria-labelledby="stats-label"
        className={`inline-flex min-h-11 items-center gap-2 border px-3 text-[0.87rem] transition-colors ${acct.stats_opt_out ? "border-blue bg-blue/10 text-blue" : "border-line-strong text-muted hover:text-ink"}`}
      >
        <span aria-hidden="true" className={`relative h-4 w-7 rounded-full transition-colors ${acct.stats_opt_out ? "bg-blue" : "bg-line-strong"}`}>
          <span className={`absolute top-0.5 size-3 rounded-full bg-bg transition-[left] ${acct.stats_opt_out ? "left-3.5" : "left-0.5"}`} />
        </span>
        {acct.stats_opt_out ? "on" : "off"}
      </button>
    </form>
  );
}
