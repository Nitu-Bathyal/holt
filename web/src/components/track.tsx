"use client";

import { useEffect } from "react";
import { track, type AnalyticsEvent } from "@/lib/analytics";

/** Counts one event when it mounts, for server components (see lib/analytics.ts). */
export function Track({ event, data }: { event: AnalyticsEvent; data?: Record<string, string> }) {
  const key = JSON.stringify(data ?? {});
  useEffect(() => {
    track(event, JSON.parse(key));
  }, [event, key]);
  return null;
}
