"use client";
// The page behind an alert email's "Stop these emails" link. The email is
// turned off from here, in the browser, once the page is open: never while the
// server renders it, because mail scanners and link previews fetch every link
// in an email and a fetch alone must not unsubscribe anyone. Then one undo.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { unsubAfter, type UnsubState } from "@/lib/alerts";
import { setEmailByToken } from "@/lib/alerts-client";
import { ALERT_SETTINGS } from "@/lib/settings";

const HEADING: Record<UnsubState, string> = {
  idle: "Stopping alert emails…",
  working: "Stopping alert emails…",
  off: "Alert emails are off.",
  on: "Alert emails are back on.",
  expired: "This link doesn't work any more.",
  failed: "That didn't work.",
};

export function Unsubscribe({ token }: { token: string | null }) {
  const [state, setState] = useState<UnsubState>(token ? "idle" : "expired");
  const sent = useRef(false);

  async function send(on: boolean) {
    if (!token) return;
    setState("working");
    setState(unsubAfter(on, await setEmailByToken(token, on)));
  }

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
        <h1 className="display text-[clamp(1.8rem,5vw,2.4rem)]">{HEADING[state]}</h1>
      </div>
      <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
        {state === "off" && <button type="button" onClick={() => void send(true)} className="btn-ghost">undo</button>}
        {state === "on" && <button type="button" onClick={() => void send(false)} className="btn-ghost">stop these emails</button>}
        {state === "failed" && <button type="button" onClick={() => void send(false)} className="btn-ghost">try again</button>}
        {state !== "idle" && state !== "working" && <Link href={ALERT_SETTINGS} className="text-link text-[0.9rem]">alert settings</Link>}
      </div>
    </div>
  );
}
