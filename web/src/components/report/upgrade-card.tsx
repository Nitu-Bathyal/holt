import Link from "next/link";
import { EXAMPLE_PATH } from "@/lib/example-report";
import { WELCOME_AI_CREDITS } from "@/lib/site";

// What the paid report (the merge plan) adds to this free one, said as the
// things it contains, not as "AI".
const INCLUDES = [
  "A step-by-step plan for your first PR",
  "The project's rules and the checks that must pass",
  "Why outside PRs get closed, in the maintainers' words",
  "Who reviews, and how fast",
];

export function UpgradeCard({ repo, signedIn }: { repo: string; signedIn: boolean }) {
  const aiHref = `/${repo}?mode=ai`;
  const href = signedIn ? aiHref : `/signin?callbackUrl=${encodeURIComponent(aiHref)}`;
  return (
    <div className="border border-ink bg-panel">
      <div className="p-5">
        <p className="flex items-center gap-2 text-[0.78rem] uppercase tracking-[0.1em] text-muted">
          <span className="bg-ink px-1.5 py-0.5 font-semibold tracking-[0.14em] text-bg">Pro</span>
          Merge plan
        </p>
        <h3 className="mt-3 font-sans text-[1.1rem] font-semibold leading-snug">How to get your first PR merged here</h3>
        <ul className="mt-3 space-y-1.5 font-sans text-[0.92rem] text-muted">
          {INCLUDES.map((x) => (
            <li key={x} className="flex gap-2">
              <span aria-hidden="true" className="text-green">✓</span>
              {x}
            </li>
          ))}
        </ul>
      </div>
      <div className="border-t border-line p-5">
        <Link href={href} prefetch={false} className="btn-primary w-full bg-ink text-bg">
          Get the merge plan <span aria-hidden="true">→</span>
        </Link>
        <p className="mt-2 text-center text-[0.82rem] text-faint">
          {signedIn ? "Uses 1 of your credits" : `Sign in for ${WELCOME_AI_CREDITS} free`} ·{" "}
          <Link href={EXAMPLE_PATH} className="text-link">see an example</Link>
        </p>
      </div>
    </div>
  );
}
