"use client";
// PROTOTYPE: the two emails, as a mail app would show them, each next to its
// plain-text part: "your turn" right away, and the daily one at 8:00 with
// everything else.
import { useState } from "react";
import { alertLine } from "@/components/alerts/types";
import { emailAlerts, emailHtml, emailSubject, emailText, type EmailKind } from "../mock";

function Toggle<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div role="group" aria-label={label} className="app-tabs">
      {options.map(([v, text]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)} className="app-tab">
          {text}
        </button>
      ))}
    </div>
  );
}

export function EmailPreview() {
  const [kind, setKind] = useState<EmailKind>("now");
  const [part, setPart] = useState<"html" | "text">("html");
  const items = emailAlerts(kind);
  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <Toggle label="Which email" value={kind} onChange={setKind} options={[["now", "Your turn"], ["daily", "Daily"]]} />
        <Toggle label="Email part" value={part} onChange={setPart} options={[["html", "HTML"], ["text", "Plain text"]]} />
      </div>
      <dl className="mb-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 font-sans text-[0.88rem]">
        <dt className="text-faint">From</dt>
        <dd>Holt &lt;alerts@githolt.com&gt;</dd>
        <dt className="text-faint">Subject</dt>
        <dd className="font-semibold">{emailSubject(kind, items)}</dd>
      </dl>
      {part === "html" ? (
        <iframe key={kind} title={`The ${kind === "now" ? "your turn" : "daily"} email, HTML part`} className="lab-email" srcDoc={emailHtml(kind, items, alertLine)} sandbox="" />
      ) : (
        <pre className="panel overflow-x-auto whitespace-pre-wrap p-5 text-[0.85rem] leading-relaxed">{emailText(items, alertLine)}</pre>
      )}
      <p className="mt-3 font-mono text-[0.76rem] leading-relaxed text-faint">
        List-Unsubscribe: &lt;https://api.githolt.com/v1/alerts/unsubscribe?t=…&gt;
        <br />
        List-Unsubscribe-Post: List-Unsubscribe=One-Click
      </p>
    </div>
  );
}
