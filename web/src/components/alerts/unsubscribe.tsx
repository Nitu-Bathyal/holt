"use client";
// The page behind an email's "Stop these emails" link. The emails are turned
// off from here, in the browser, once the page is open: never while the
// server renders it, because mail scanners and link previews fetch every link
// in an email and a fetch alone must not unsubscribe anyone. Then one undo.
// The same link works for PR watch's alerts and for the account's own emails;
// the server's answer says which.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { unsubAfter, unsubHeading, unsubNote, type EmailKind, type UnsubState } from "@/lib/alerts";
import { setEmailByToken } from "@/lib/alerts-client";
import { ALERT_SETTINGS, SETTINGS } from "@/lib/settings";

export function Unsubscribe({ token }: { token: string | null }) {
  const [state, setState] = useState<UnsubState>(token ? "idle" : "expired");
  const [kind, setKind] = useState<EmailKind | null>(null);
  const sent = useRef(false);

  async function send(on: boolean) {
    if (!token) return;
    setState("working");
    const r = await setEmailByToken(token, on);
    if (r.kind) setKind(r.kind);
    setState(unsubAfter(on, r.status));
  }

  const note = unsubNote(state, kind);

  // Once, when a browser opens the page.
  useEffect(() => {
    if (sent.current || !token) return;
    sent.current = true;
    void send(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="wrap max-w-2xl py-20">
      <div role="status">
        <h1 className="display text-[clamp(1.8rem,5vw,2.4rem)]">{unsubHeading(state, kind)}</h1>
        {note && <p className="prose-sans mt-3">{note}</p>}
      </div>
      <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
        {state === "off" && <button type="button" onClick={() => void send(true)} className="btn-ghost">undo</button>}
        {state === "on" && <button type="button" onClick={() => void send(false)} className="btn-ghost">stop these emails</button>}
        {state === "failed" && <button type="button" onClick={() => void send(false)} className="btn-ghost">try again</button>}
        {state !== "idle" && state !== "working" && (
          <Link href={kind === "alerts" ? ALERT_SETTINGS : SETTINGS} className="text-link text-[0.9rem]">{kind === "alerts" ? "alert settings" : "settings"}</Link>
        )}
      </div>
    </div>
  );
}
