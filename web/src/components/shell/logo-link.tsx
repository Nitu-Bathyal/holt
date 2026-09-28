"use client";
// The marketing header's logo. Signed out, on the landing page it glides back to the hero
// (through Lenis where it runs; instant under reduced motion), since a link to
// the page you're on does nothing; elsewhere it's a plain link home.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoAction } from "@/lib/shell";
import { scrollToTop } from "../motion/smooth-scroll";

export function LogoLink({ signedIn, className, children }: { signedIn: boolean; className?: string; children: React.ReactNode }) {
  const action = logoAction(usePathname(), signedIn);
  if ("href" in action)
    return (
      <Link href={action.href} className={className}>
        {children}
      </Link>
    );
  return (
    <a
      href="#top"
      className={className}
      onClick={(e) => {
        e.preventDefault();
        // Keep ?landing=1, drop any #section, so a reload stays at the top.
        history.replaceState(history.state, "", location.pathname + location.search);
        scrollToTop();
      }}
    >
      {children}
    </a>
  );
}
