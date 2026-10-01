"use client";
// "On this page" for the policy pages: the article's sections, read from its
// h2s once it's on screen, with the one you're reading lit. Wide screens only
// (globals.css, .legal-toc); phones read straight down.
import { useEffect, useState } from "react";

type Entry = { id: string; label: string };

const slug = (s: string) => s.toLowerCase().replace(/^\d+\.\s*/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function LegalToc() {
  const [items, setItems] = useState<Entry[]>([]);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const hs = [...document.querySelectorAll<HTMLHeadingElement>("article.legal h2")];
    // Sections without an id of their own get one, so each can be linked to.
    for (const h of hs) if (!h.id) h.id = slug(h.textContent ?? "");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read once from the server-rendered article
    setItems(hs.map((h) => ({ id: h.id, label: (h.textContent ?? "").replace(/^\d+\.\s*/, "") })));
    // The last heading above the upper third of the screen is the one being read.
    const io = new IntersectionObserver(
      () => {
        const line = window.innerHeight / 3;
        const above = hs.filter((h) => h.getBoundingClientRect().top <= line);
        setActive((above.at(-1) ?? hs[0])?.id ?? null);
      },
      { rootMargin: "0px 0px -66% 0px", threshold: [0, 1] },
    );
    for (const h of hs) io.observe(h);
    return () => io.disconnect();
  }, []);

  if (items.length < 3) return null;
  return (
    <nav aria-label="On this page" className="legal-toc">
      <p className="legal-toc-head">On this page</p>
      <ol>
        {items.map((i) => (
          <li key={i.id}>
            <a href={`#${i.id}`} aria-current={active === i.id ? "location" : undefined}>{i.label}</a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
