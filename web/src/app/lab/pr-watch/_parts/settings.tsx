"use client";
// PROTOTYPE: /settings/alerts, in the settings pages' blocks and the Display
// tab's choice buttons.
import Link from "next/link";
import { useState } from "react";
import type { Access } from "@/components/alerts/types";
import { Block } from "@/components/settings/section-head";
import { EMAIL, TZ, UNTIL, WATCHING } from "../mock";

export type EmailMode = "each" | "daily" | "off";

const MODES: { value: EmailMode; label: string }[] = [
  { value: "each", label: "Each alert" },
  { value: "daily", label: "One a day, at 8:00" },
  { value: "off", label: "Off" },
];

export function EmailChoice({ value, onChange, name }: { value: EmailMode; onChange: (m: EmailMode) => void; name: string }) {
  return (
    <fieldset>
      <legend className="sr-only">How often to email</legend>
      <div className="flex flex-wrap gap-2">
        {MODES.map((o) => (
          <label
            key={o.value}
            className={`inline-flex min-h-11 cursor-pointer items-center border px-3 text-[0.87rem] transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-blue ${
              value === o.value ? "border-blue bg-blue/10 text-blue" : "border-line-strong text-muted hover:text-ink"
            }`}
          >
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="sr-only" />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className="grid min-h-11 place-items-center px-1 disabled:opacity-50"
    >
      <span className={`relative block h-6 w-11 rounded-full border transition-colors ${on ? "border-blue bg-blue" : "border-line-strong bg-panel-2"}`}>
        <span className={`absolute top-0.5 size-[18px] rounded-full bg-panel shadow transition-[left] ${on ? "left-[22px]" : "left-0.5"}`} />
      </span>
    </button>
  );
}

export function AlertSettings({ access, onTurnOn }: { access: Access; onTurnOn: () => void }) {
  const [enabled, setEnabled] = useState(true);
  const [mode, setMode] = useState<EmailMode>("daily");
  const [editing, setEditing] = useState(false);
  const live = access === "on" || access === "empty";
  const note = live ? `until ${UNTIL}` : access === "ended" ? `ended ${UNTIL}` : null;

  return (
    <Block title="Alerts" note={note}>
      <div className="app-row grid-cols-[minmax(0,1fr)_auto] sm:px-3">
        <div className="min-w-0">
          <p className="font-sans text-[0.95rem]">Alerts</p>
          {live && enabled && (
            <p className="mt-0.5 text-[0.8rem] text-faint">
              Watching {WATCHING} pull requests · <a href="#lab-prs" className="text-link">see them</a>
            </p>
          )}
        </div>
        {access === "off" ? (
          <button type="button" onClick={onTurnOn} className="btn-primary min-h-11 px-4 text-[0.84rem]">turn on alerts →</button>
        ) : access === "ended" ? (
          <Link href="/pricing" className="btn-primary min-h-11 px-4 text-[0.84rem]">get Pro →</Link>
        ) : (
          <Switch on={enabled} onChange={setEnabled} label="Alerts" />
        )}
      </div>

      {live && enabled && (
        <div className="app-row block sm:px-3">
          <p className="font-sans text-[0.95rem]">Email</p>
          {editing ? (
            <form
              className="mt-3 flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                setEditing(false);
              }}
            >
              <label className="min-w-0 flex-1 basis-60">
                <span className="sr-only">Email address</span>
                <input type="email" required defaultValue={EMAIL} className="min-h-11 w-full border border-line-strong bg-bg px-3 font-sans text-[0.95rem] outline-none focus-visible:border-blue" />
              </label>
              <button type="submit" className="btn-ghost">send a link</button>
            </form>
          ) : (
            <p className="mt-1 flex flex-wrap items-baseline gap-x-4 font-sans text-[0.92rem] text-muted">
              {EMAIL}
              <button type="button" onClick={() => setEditing(true)} className="text-link tap font-mono text-[0.82rem]">change</button>
            </p>
          )}
          <div className="mt-4">
            <EmailChoice value={mode} onChange={setMode} name="settings-mode" />
          </div>
          {mode !== "off" && <p className="mt-3 text-[0.8rem] text-faint">No email between 22:00 and 8:00 ({TZ}).</p>}
        </div>
      )}
    </Block>
  );
}
