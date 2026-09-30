"use client";
// PROTOTYPE, don't merge. The lab's one switch (where this person stands with
// alerts) drives every part: the bell, My PRs, the first-time card and the
// settings. Turning alerts on anywhere moves the switch, as it would for real.
import { useState } from "react";
import { AlertBell } from "@/components/alerts/bell";
import type { Access } from "@/components/alerts/types";
import { SectionHead } from "@/components/shell/app-page";
import { ALERTS, STATES, UNTIL, WATCHING } from "../mock";
import { EmailPreview } from "./email";
import { FirstTime } from "./first-time";
import { PrList } from "./prs";
import { AlertSettings } from "./settings";

export function PrWatchLab({ initial }: { initial: Access }) {
  const [access, setAccess] = useState<Access>(initial);
  const [dismissed, setDismissed] = useState(false);
  const turnOn = () => setAccess("on");

  return (
    <div className="app-page">
      <header className="mb-10">
        <p className="text-[0.8rem] text-faint">Lab · made-up data</p>
        <h1 className="mt-1 text-[1.6rem] font-semibold tracking-tight">PR watch</h1>
        <div role="group" aria-label="Alerts state" className="app-tabs mt-5">
          {STATES.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={access === s.id}
              onClick={() => {
                setAccess(s.id);
                setDismissed(false);
              }}
              className="app-tab"
            >
              {s.label}
            </button>
          ))}
        </div>
      </header>

      <div className="space-y-16">
        <section aria-labelledby="lab-bar-h">
          <SectionHead id="lab-bar-h" title="Top bar" />
          {/* The app's top bar, reduced to what matters here: the bell sits left of the theme toggle and the account. */}
          <div className="lab-bar">
            <div className="lab-bar-check">owner/name</div>
            <div className="ml-auto flex items-center gap-1">
              <AlertBell key={access} access={access} items={ALERTS} until={UNTIL} watching={WATCHING} settingsHref="#lab-settings-h" onTurnOn={turnOn} defaultOpen />
              <span aria-hidden="true" className="grid size-11 place-items-center text-faint">◐</span>
              <span aria-hidden="true" className="grid size-7 place-items-center rounded-full bg-blue text-[0.82rem] font-bold text-on-accent">A</span>
            </div>
          </div>
          {/* Room for the open dropdown, so it never covers the next section. */}
          <div aria-hidden="true" className="h-[30rem]" />
        </section>

        <section aria-labelledby="lab-prs">
          <SectionHead id="lab-prs" title="Your pull requests" />
          {access === "off" && !dismissed && <FirstTime onDone={turnOn} onDismiss={() => setDismissed(true)} />}
          <PrList key={access} access={access} />
        </section>

        <section aria-labelledby="lab-settings-h">
          <SectionHead id="lab-settings-h" title="Settings" />
          <AlertSettings key={access} access={access} onTurnOn={turnOn} />
        </section>

        <section aria-labelledby="lab-email-h">
          <SectionHead id="lab-email-h" title="Email" />
          <EmailPreview />
        </section>
      </div>
    </div>
  );
}
