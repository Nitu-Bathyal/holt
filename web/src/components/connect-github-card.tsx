// The GitHub card in settings: connect, the statistics switch, disconnect.
// Connecting itself happens on /connect, which shows the notice and the 18+ box.
import Link from "next/link";
import { disconnect, setStats } from "@/app/connect/actions";
import { githubConnection } from "@/lib/api";
import { shortDate } from "@/lib/format";

/** The one plain line people agree to by connecting. Shown on /connect and here. */
export const STATS_NOTICE =
  "Connecting lets Holt track your public contributions and include them anonymously in repo statistics (shown only when 5+ people contribute).";

const NOTICES: Record<string, { tone: string; text: string }> = {
  connected: { tone: "text-green border-green/50 bg-green/10", text: "GitHub connected." },
  saved: { tone: "text-green border-green/50 bg-green/10", text: "Saved." },
  disconnected: { tone: "text-muted border-line-strong", text: "GitHub disconnected. We deleted the connection, the list of repos you viewed and your saved pull requests." },
  error: { tone: "text-orange border-orange/50 bg-orange/10", text: "That didn't work. Try again in a minute." },
};

export async function ConnectGitHubCard({ userId, notice }: { userId: string; notice?: string | string[] }) {
  const r = await githubConnection(userId);
  const acct = r.ok ? r.data.account : null;
  const n = typeof notice === "string" ? NOTICES[notice] : undefined;

  return (
    <section id="github" aria-labelledby="github-h" className="mt-10 scroll-mt-24 border border-line-strong bg-panel p-5 shadow-soft sm:p-8">
      <h2 id="github-h" className="text-[1.3rem] font-semibold tracking-tight">GitHub</h2>
      {n && <p role="status" className={`mt-4 border px-4 py-3 font-sans text-[0.9rem] ${n.tone}`}>{n.text}</p>}
      {!r.ok && <p role="alert" className="mt-4 border border-orange/50 px-4 py-3 font-sans text-[0.9rem] text-orange">{r.error.message}</p>}

      {r.ok && !acct && (
        <>
          <p className="prose-sans mt-2 text-[0.95rem]">
            See your public PRs with Holt&apos;s verdict on each repo, and get picks based on where they got merged. Free. Holt
            only reads public data and never posts.
          </p>
          <Link href="/connect" className="btn-primary mt-5 inline-flex">connect GitHub</Link>
        </>
      )}

      {acct && (
        <>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border border-green/50 bg-green/10 p-4">
            <div className="min-w-0 text-[0.85rem]">
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

          <form action={setStats} className="mt-6 flex flex-wrap items-start justify-between gap-4 border-t border-line pt-5">
            <div className="min-w-0 flex-1 basis-64">
              <p className="text-[0.95rem] font-semibold" id="stats-label">Don&apos;t include me in statistics</p>
              <p className="prose-sans mt-1 text-[0.85rem] text-muted">{STATS_NOTICE}</p>
            </div>
            {/* One click flips it: the button sends the opposite of what's saved. */}
            {!acct.stats_opt_out && <input type="hidden" name="stats_opt_out" value="on" />}
            <button
              type="submit"
              role="switch"
              aria-checked={acct.stats_opt_out}
              aria-labelledby="stats-label"
              className={`inline-flex min-h-11 items-center gap-2 border px-3 text-[0.8rem] transition-colors ${acct.stats_opt_out ? "border-blue bg-blue/10 text-blue" : "border-line-strong text-muted hover:text-ink"}`}
            >
              <span aria-hidden="true" className={`relative h-4 w-7 rounded-full transition-colors ${acct.stats_opt_out ? "bg-blue" : "bg-line-strong"}`}>
                <span className={`absolute top-0.5 size-3 rounded-full bg-bg transition-[left] ${acct.stats_opt_out ? "left-3.5" : "left-0.5"}`} />
              </span>
              {acct.stats_opt_out ? "on" : "off"}
            </button>
          </form>

          <p className="mt-5 font-sans text-[0.8rem] text-faint">
            Disconnecting deletes the connection, the list of repos you viewed on Holt and your saved pull requests. See{" "}
            <Link href="/privacy#connect-github" className="text-link">what we keep</Link>.
          </p>
        </>
      )}
    </section>
  );
}
