"use client";
// The marketing nav: the landing page's sections, then pricing. On the
// landing page the links are plain hashes, so Lenis glides to them; elsewhere
// they go to the landing page first.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { jumpHref, LANDING_SECTIONS } from "@/lib/shell";

export function JumpNav({ signedIn, className, item = "py-2 transition-colors hover:text-ink" }: { signedIn: boolean; className?: string; item?: string }) {
  const path = usePathname();
  const links = LANDING_SECTIONS.map((s) => ({ href: jumpHref(path, signedIn, s.id), label: s.label }));
  const body = (
    <>
      {links.map((l) =>
        l.href.startsWith("#") ? (
          <a key={l.label} href={l.href} className={item}>{l.label}</a>
        ) : (
          <Link key={l.label} href={l.href} className={item}>{l.label}</Link>
        ),
      )}
      <Link href="/pricing" prefetch className={item} aria-current={path === "/pricing" ? "page" : undefined}>pricing</Link>
    </>
  );
  return className ? <nav aria-label="Main" className={className}>{body}</nav> : body;
}
