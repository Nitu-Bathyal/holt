"use client";

// Anything a page throws while rendering lands here, inside the site's header
// and footer, instead of the framework's bare error screen: the cat, one
// sentence, and the one thing to do (try again). API failures a page expects
// keep their own ErrorPanel.
import Link from "next/link";
import { CatFace } from "@/components/cat-face";

export default function Error({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="app-page">
      <div role="alert" className="app-empty pt-[clamp(28px,6svh,64px)]">
        <CatFace mood="startled" className="app-empty-cat" />
        <h1 className="app-h1 mt-5">Something broke on our side.</h1>
        <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-3">
          <button type="button" onClick={() => retry()} className="btn-primary">try again</button>
          <Link href="/" className="text-link text-[0.9rem]">home</Link>
        </div>
      </div>
    </div>
  );
}
