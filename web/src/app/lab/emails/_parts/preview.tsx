"use client";
// Each email as an inbox would show it: the list row (sender, subject,
// preheader), then the open email at inbox or phone width, light or dark,
// with its plain-text part beside it.
import { useEffect, useRef, useState } from "react";
import type { LabEmail } from "@/lib/api-schema";

type Width = "inbox" | "phone";

function Toggle<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div role="group" aria-label={label} className="lab-toggle">
      {options.map(([v, text]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

// The preview's theme switch: the template's dark block on or off, whatever the device says.
const themed = (html: string, dark: boolean) => html.replace("@media (prefers-color-scheme: dark)", dark ? "@media all" : "@media not all");

function Email({ email, width, dark }: { email: LabEmail; width: Width; dark: boolean }) {
  const [height, setHeight] = useState(560);
  const frame = useRef<HTMLIFrameElement>(null);
  const measure = () => {
    const doc = frame.current?.contentDocument;
    if (doc?.readyState === "complete" && doc.body) setHeight(doc.body.scrollHeight + 2);
  };
  // The frame can finish loading before hydration, when onLoad isn't wired yet.
  useEffect(measure);
  return (
    <section className="lab-email-block">
      <h2 className="font-semibold">{email.name}</h2>
      <div className="lab-inbox-row">
        <span className="font-semibold">Holt</span>
        <span className="min-w-0 truncate">
          <span className="font-semibold text-ink">{email.subject}</span>
          <span className="text-faint"> {email.preheader}</span>
        </span>
      </div>
      <div className="mt-4 grid gap-6 xl:grid-cols-[minmax(0,640px)_minmax(0,1fr)]">
        <div className={width === "phone" ? "max-w-[390px]" : undefined}>
          <iframe
            key={`${width}-${dark}`}
            title={`${email.name}, as HTML`}
            className="lab-email"
            style={{ height }}
            srcDoc={themed(email.html, dark)}
            // Same origin only so the frame can be sized to its email; no scripts run in it.
            sandbox="allow-same-origin"
            ref={frame}
            onLoad={measure}
          />
        </div>
        <pre aria-label={`${email.name}, as plain text`} className="panel self-start overflow-x-auto whitespace-pre-wrap break-words p-5 text-[0.8rem] leading-relaxed">
          {email.text}
        </pre>
      </div>
    </section>
  );
}

export function EmailLab({ emails }: { emails: LabEmail[] }) {
  const [width, setWidth] = useState<Width>("inbox");
  const [dark, setDark] = useState(false);
  return (
    <div>
      <div className="lab-controls">
        <Toggle label="Width" value={width} onChange={setWidth} options={[["inbox", "Inbox"], ["phone", "Phone"]]} />
        <Toggle label="Mail app theme" value={dark ? "dark" : "light"} onChange={(v) => setDark(v === "dark")} options={[["light", "Light"], ["dark", "Dark"]]} />
      </div>
      {emails.map((email) => (
        <Email key={email.name} email={email} width={width} dark={dark} />
      ))}
    </div>
  );
}
