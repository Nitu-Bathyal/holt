// In place of a check that would start for a signed-out visitor (compare, the
// badge page): checks need an account (lib/gate.ts), so offer sign-in, then
// back to `back`, where the check starts.
import Link from "next/link";
import { signInHref } from "@/lib/gate";

export function SignInToCheck({ back, className = "p-4" }: { back: string; className?: string }) {
  return (
    <div className={`font-sans text-[0.9rem] ${className}`} data-signin-card>
      <p className="text-muted">Holt hasn&apos;t checked this repo recently.</p>
      <Link href={signInHref(back)} prefetch={false} className="text-link mt-2 inline-flex min-h-11 items-center font-mono text-[0.87rem]">
        [ sign in to check it, free → ]
      </Link>
    </div>
  );
}
