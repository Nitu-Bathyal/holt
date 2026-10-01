"use client";
// /settings/alerts: alerts on or off, email on or off, and when to email
// ("your turn" right away and the rest at 8:00, unless they pick another).
// Every change saves at once and carries the browser's time zone, which is
// what "8:00" and the quiet hours are measured in. The address is the
// account's own; it can't be changed here.
import Link from "next/link";
import { useEffect, useState } from "react";
import { accessNote, alertView, browserTz, type EmailMode } from "@/lib/alerts";
import { announce, saveSettings } from "@/lib/alerts-client";
import type { AlertSettings } from "@/lib/types";
import { Block } from "@/components/settings/section-head";
import { EmailChoice, Switch } from "./controls";
import { TURN_ON_FAILED, useTurnOn } from "./use-turn-on";

type Change = { enabled?: boolean; email_on?: boolean; email_mode?: EmailMode };

export function AlertSettingsForm({ initial, accountEmail }: { initial: AlertSettings; accountEmail: string | null }) {
  const [s, setS] = useState(initial);
  const [unsaved, setUnsaved] = useState(false);
  const { turnOn, busy, failed } = useTurnOn(setS);
  const view = alertView(s.access, s.enabled);
  const hasAccess = s.access.state === "trial" || s.access.state === "pro";
  const email = s.email ?? accountEmail;

  async function change(c: Change) {
    const before = s;
    setS({ ...s, ...c });
    setUnsaved(false);
    const r = await saveSettings(c);
    if (r.ok) {
      setS(r.settings);
      if (c.enabled != null) announce();
    } else {
      setS(before);
      setUnsaved(true);
    }
  }

  // "8:00" is the reader's own: a new time zone (a move, a trip) is saved when they open this page.
  useEffect(() => {
    const tz = browserTz();
    if (!initial.enabled || !tz || tz === initial.tz) return;
    let gone = false;
    void saveSettings({}).then((r) => {
      if (r.ok && !gone) setS(r.settings);
    });
    return () => {
      gone = true;
    };
  }, [initial.enabled, initial.tz]);

  return (
    <Block title="Alerts" note={accessNote(s.access, s.tz)}>
      <div className="app-row grid-cols-[minmax(0,1fr)_auto] sm:px-3">
        <div className="min-w-0">
          <p className="font-sans text-[0.95rem]">Alerts</p>
          {view === "on" && (
            <p className="mt-0.5 text-[0.8rem] text-faint">
              Watching {s.watching} pull request{s.watching === 1 ? "" : "s"} · <Link href="/me/contributions" className="text-blue hover:underline">see them</Link>
            </p>
          )}
        </div>
        {hasAccess ? (
          <Switch on={s.enabled} onChange={(enabled) => void change({ enabled })} label="Alerts" />
        ) : view === "ended" ? (
          <Link href="/pricing" className="text-link text-[0.84rem]">see plans</Link>
        ) : (
          <button type="button" onClick={turnOn} disabled={busy} className="btn-primary min-h-11 px-4 text-[0.84rem]">turn on alerts →</button>
        )}
      </div>

      {view === "on" && (
        <div className="app-row block sm:px-3">
          <div className="flex items-center justify-between gap-4">
            <p className="font-sans text-[0.95rem]">Email</p>
            {email && <Switch on={s.email_on} onChange={(email_on) => void change({ email_on })} label="Email" />}
          </div>
          {!email ? (
            <p className="text-[0.8rem] text-faint">Your sign-in has no email address.</p>
          ) : (
            s.email_on && (
              <>
                <p className="break-all font-sans text-[0.92rem] text-muted">{email}</p>
                <div className="mt-4">
                  <EmailChoice value={s.email_mode} onChange={(email_mode) => void change({ email_mode })} name="email-mode" />
                </div>
                <p className="mt-3 text-[0.8rem] text-faint">
                  {s.email_available ? `No email between 22:00 and 8:00 (${s.tz}).` : "Email isn't being sent from this site yet."}
                </p>
              </>
            )
          )}
        </div>
      )}

      {(failed || unsaved) && (
        <p role="status" className="mt-4 text-[0.84rem] text-orange">{failed ? TURN_ON_FAILED : "That didn't save. Try again."}</p>
      )}
    </Block>
  );
}
