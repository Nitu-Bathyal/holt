"use client";
// "turn on alerts": the bell, My PRs and the settings all do it the same way.
// The first time starts the 14 days. Without GitHub connected, or once the 14
// days are over, the click goes where that's fixed (lib/alerts.ts, turnOnDetour).
import { useRouter } from "next/navigation";
import { useState } from "react";
import { turnOnDetour } from "@/lib/alerts";
import { announce, saveSettings } from "@/lib/alerts-client";
import type { AlertSettings } from "@/lib/types";

export function useTurnOn(onDone?: (settings: AlertSettings) => void) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function turnOn() {
    setBusy(true);
    setFailed(false);
    const r = await saveSettings({ enabled: true });
    setBusy(false);
    if (r.ok) {
      announce();
      onDone?.(r.settings);
      return;
    }
    const detour = turnOnDetour(r.status);
    if (detour) router.push(detour);
    else setFailed(true);
  }

  return { turnOn, busy, failed };
}

export const TURN_ON_FAILED = "That didn't work. Try again.";
