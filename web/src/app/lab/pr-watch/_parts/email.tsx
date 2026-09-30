"use client";
// PROTOTYPE: the daily email, as a mail app would show it, next to its
// plain-text part.
import { useState } from "react";
import { alertLine } from "@/components/alerts/types";
import { ALERTS, emailHtml, emailSubject, emailText } from "../mock";

const TODAY = ALERTS.filter((a) => !a.read);

export function EmailPreview() {
  const [part, setPart] = useState<"html" | "text">("html");
  return (
    <div>
      <dl className="mb-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 font-sans text-[0.88rem]">
        <dt className="text-faint">From</dt>
        <dd>Holt &lt;alerts@githolt.com&gt;</dd>
        <dt className="text-faint">Subject</dt>
        <dd className="font-semibold">{emailSubject(TODAY)}</dd>
      </dl>
      <div role="group" aria-label="Email part" className="app-tabs mb-4">
        {(["html", "text"] as const).map((p) => (
          <button key={p} type="button" aria-pressed={part === p} onClick={() => setPart(p)} className="app-tab">
            {p === "html" ? "HTML" : "Plain text"}
          </button>
        ))}
      </div>
      {part === "html" ? (
        <iframe title="The daily email, HTML part" className="lab-email" srcDoc={emailHtml(TODAY, alertLine)} sandbox="" />
      ) : (
        <pre className="panel overflow-x-auto whitespace-pre-wrap p-5 text-[0.85rem] leading-relaxed">{emailText(TODAY, alertLine)}</pre>
      )}
      <p className="mt-3 font-mono text-[0.76rem] leading-relaxed text-faint">
        List-Unsubscribe: &lt;https://api.githolt.com/v1/alerts/unsubscribe?t=…&gt;
        <br />
        List-Unsubscribe-Post: List-Unsubscribe=One-Click
      </p>
    </div>
  );
}
