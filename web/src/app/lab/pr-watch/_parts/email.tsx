"use client";
// PROTOTYPE: the two emails as an inbox would show them: the list row
// (sender, subject, preheader), then the open email at inbox or phone width,
// light or dark, with its plain-text part beside it. The markup is
// components/alerts/email/templates.ts, which the build lifts.
import { useEffect, useRef, useState } from "react";
import { mockEmail, type EmailKind } from "../mock";

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

// The preview's theme switch: the template's dark block on or off, whatever the device says.
const theme = (html: string, dark: boolean) => html.replace("@media (prefers-color-scheme: dark)", dark ? "@media all" : "@media not all");

function Inbox({ kind, width, dark }: { kind: EmailKind; width: "inbox" | "phone"; dark: boolean }) {
  const email = mockEmail(kind);
  const [height, setHeight] = useState(640);
  const frame = useRef<HTMLIFrameElement>(null);
  const html = theme(email.html, dark);
  const measure = () => {
    const doc = frame.current?.contentDocument;
    if (doc?.readyState === "complete" && doc.body) setHeight(doc.body.scrollHeight + 2);
  };
  // The frame can finish loading before hydration, when onLoad isn't wired yet.
  useEffect(measure);
  return (
    <div>
      <div className="lab-inbox-row">
        <span className="font-semibold">Holt</span>
        <span className="min-w-0 truncate">
          <span className="font-semibold text-ink">{email.subject}</span>
          <span className="text-faint"> · {email.preheader}</span>
        </span>
        <span className="text-faint">8:02</span>
      </div>
      <div className="mt-4 grid gap-6 xl:grid-cols-[minmax(0,640px)_minmax(0,1fr)]">
        <div className={width === "phone" ? "max-w-[390px]" : undefined}>
          <iframe
            key={`${kind}-${width}-${dark}`}
            title={`${email.subject}, as HTML`}
            className="lab-email"
            style={{ height }}
            srcDoc={html}
            // Same origin only so the frame can be sized to its email; no scripts run in it.
            sandbox="allow-same-origin"
            ref={frame}
            onLoad={measure}
          />
        </div>
        <pre aria-label={`${email.subject}, as plain text`} className="panel self-start overflow-x-auto whitespace-pre-wrap break-words p-5 text-[0.8rem] leading-relaxed">
          {email.text}
        </pre>
      </div>
    </div>
  );
}

export function EmailPreview() {
  const [kind, setKind] = useState<EmailKind>("now");
  const [width, setWidth] = useState<"inbox" | "phone">("inbox");
  const [dark, setDark] = useState(false);
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end gap-x-8 gap-y-3">
        <Toggle label="Which email" value={kind} onChange={setKind} options={[["now", "Your turn"], ["daily", "Daily"]]} />
        <Toggle label="Width" value={width} onChange={setWidth} options={[["inbox", "Inbox"], ["phone", "Phone"]]} />
        <Toggle label="Mail app theme" value={dark ? "dark" : "light"} onChange={(v) => setDark(v === "dark")} options={[["light", "Light"], ["dark", "Dark"]]} />
      </div>
      <Inbox kind={kind} width={width} dark={dark} />
      <p className="mt-4 font-mono text-[0.76rem] leading-relaxed text-faint">
        From: Holt &lt;alerts@githolt.com&gt;
        <br />
        List-Unsubscribe: &lt;https://api.githolt.com/v1/alerts/unsubscribe?t=…&gt;
        <br />
        List-Unsubscribe-Post: List-Unsubscribe=One-Click
      </p>
    </div>
  );
}
