"use client";
// The first time, on My PRs: the alerts this person's own open pull requests
// would get today, and one button. The click turns alerts on and starts the
// 14 days; when to email follows in place.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ALERT_RULE, dayMonth, type EmailMode, type SampleAlert } from "@/lib/alerts";
import { saveSettings } from "@/lib/alerts-client";
import type { AlertSettings } from "@/lib/types";
import { EmailChoice } from "./controls";
import { TURN_ON_FAILED, useTurnOn } from "./use-turn-on";

export function FirstTime({ samples, dismiss }: { samples: SampleAlert[]; dismiss: () => Promise<void> }) {
  const router = useRouter();
  const [on, setOn] = useState<AlertSettings | null>(null);
  const [mode, setMode] = useState<EmailMode>("turn");
  const [saving, setSaving] = useState(false);
  const [unsaved, setUnsaved] = useState(false);
  const { turnOn, busy, failed } = useTurnOn((s) => {
    setOn(s);
    setMode(s.email_mode);
  });

  async function save() {
    setSaving(true);
    setUnsaved(false);
    const r = on && mode !== on.email_mode ? await saveSettings({ email_mode: mode }) : null;
    if (r && !r.ok) {
      setSaving(false);
      setUnsaved(true);
      return;
    }
    router.refresh(); // the rows get their bells, and this card is done
  }

  if (on) {
    const until = dayMonth(on.access.until, on.tz);
    return (
      <section aria-labelledby="first-alerts-h" className="panel mb-10 px-5 py-5 sm:px-6">
        <h2 id="first-alerts-h" className="text-[1.05rem] font-semibold tracking-tight">Alerts are on{until ? ` until ${until}` : ""}.</h2>
        <div className="mt-4 space-y-4">
          {on.email && <p className="font-sans text-[0.92rem] text-muted">{on.email}</p>}
          <EmailChoice value={mode} onChange={setMode} name="first-mode" />
        </div>
        <button type="button" onClick={save} disabled={saving} className="btn-primary mt-5">save</button>
        {unsaved && <p role="status" className="mt-3 text-[0.82rem] text-orange">That didn&rsquo;t save. Try again.</p>}
      </section>
    );
  }

  return (
    <section aria-labelledby="first-alerts-h" className="panel relative mb-10 px-5 py-5 sm:px-6">
      <form action={dismiss}>
        <button type="submit" aria-label="Dismiss" className="absolute right-1 top-1 grid size-11 place-items-center text-faint hover:text-ink">×</button>
      </form>
      <h2 id="first-alerts-h" className="pr-10 text-[1.05rem] font-semibold tracking-tight">Know when it&rsquo;s your turn.</h2>
      {samples.length > 0 && (
        <ul className="mt-4 space-y-2">
          {samples.map((a) => (
            <li key={a.text} className="border-l-[3px] pl-3 font-sans text-[0.92rem] text-muted" style={{ borderColor: ALERT_RULE[a.kind] }}>
              {a.text}
            </li>
          ))}
        </ul>
      )}
      <button type="button" onClick={turnOn} disabled={busy} className="btn-primary mt-5">turn on alerts →</button>
      {failed && <p role="status" className="mt-3 text-[0.82rem] text-orange">{TURN_ON_FAILED}</p>}
    </section>
  );
}
