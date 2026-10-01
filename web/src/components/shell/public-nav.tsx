"use client";
// The same task navigation on desktop and phones, including a direct route
// back to a repo input from a report or any other public page.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CHECK_HREF } from "@/lib/shell";
import { focusCheck } from "./check-focus";

export function PublicNav({ signedIn, className, item = "min-h-11 inline-flex items-center transition-colors hover:text-ink aria-[current]:font-semibold aria-[current]:text-ink" }: { signedIn: boolean; className?: string; item?: string }) {
  const path = usePathname();
  const body = (
    <>
      <Link href={signedIn ? CHECK_HREF : "/#check"} className={item} onClick={(e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        // Close the phone menu before focusing an input outside its popover.
        const menu = e.currentTarget.closest("[popover]") as HTMLElement | null;
        if (menu?.matches(":popover-open")) menu.hidePopover();
        if (focusCheck()) {
          e.preventDefault();
          // Lenis also handles hash links on window, even after preventDefault.
          // This action owns the scroll; don't let /#check override the hero top.
          e.stopPropagation();
        }
      }}>Check a repo</Link>
      <Link href="/how-it-works" className={item} aria-current={path === "/how-it-works" ? "page" : undefined}>How it works</Link>
      <Link href="/pricing" className={item} aria-current={path === "/pricing" ? "page" : undefined}>Pricing</Link>
    </>
  );
  return className ? <nav aria-label="Main" className={className}>{body}</nav> : body;
}
