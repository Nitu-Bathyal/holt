"use client";
// PROTOTYPE: the first time, on My PRs. Two alert lines built from this
// person's own PRs, one button. The click starts the 14 days; the email
// choice follows in place.
import { useState } from "react";
import { ALERT_RULE, alertLine } from "@/components/alerts/types";
import { ALERTS, EMAIL, UNTIL } from "../mock";
import { EmailChoice, type EmailMode } from "./settings";

const SAMPLES = ALERTS.filter((a) => a.kind === "changes" || a.kind === "stale_soon");

export function FirstTime({ onDone, onDismiss }: { onDone: () => void; onDismiss: () => void }) {
  const [step, setStep] = useState<"ask" | "email">("ask");
  const [mode, setMode] = useState<EmailMode>("turn");
  return (
    <section aria-labelledby="first-alerts-h" className="panel relative mb-10 px-5 py-5 sm:px-6">
      {step === "ask" ? (
        <>
          <button type="button" onClick={onDismiss} aria-label="Dismiss" className="absolute right-1 top-1 grid size-11 place-items-center text-faint hover:text-ink">×</button>
          <h2 id="first-alerts-h" className="pr-10 text-[1.05rem] font-semibold tracking-tight">Know when it&rsquo;s your turn.</h2>
          <ul className="mt-4 space-y-2">
            {SAMPLES.map((a) => (
              <li key={a.id} className="border-l-[3px] pl-3 font-sans text-[0.92rem] text-muted" style={{ borderColor: ALERT_RULE[a.kind] }}>
                {alertLine(a)}
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => setStep("email")} className="btn-primary mt-5">turn on alerts →</button>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onDone();
          }}
        >
          <h2 id="first-alerts-h" className="text-[1.05rem] font-semibold tracking-tight">Alerts are on until {UNTIL}.</h2>
          <div className="mt-4 space-y-4">
            <label className="block max-w-md">
              <span className="mb-1.5 block text-[0.8rem] text-faint">Email</span>
              <input type="email" required defaultValue={EMAIL} className="min-h-11 w-full border border-line-strong bg-bg px-3 font-sans text-[0.95rem] outline-none focus-visible:border-blue" />
            </label>
            <EmailChoice value={mode} onChange={setMode} name="first-mode" />
          </div>
          <button type="submit" className="btn-primary mt-5">save</button>
        </form>
      )}
    </section>
  );
}
