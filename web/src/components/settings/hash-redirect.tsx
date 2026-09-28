"use client";
// Old links pointed at anchors on one long /settings page (#profile, #github).
// The server never sees the anchor, so the browser sends them on from here.
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { legacySettingsHref } from "@/lib/settings";

export function SettingsHashRedirect() {
  const router = useRouter();
  useEffect(() => {
    const to = legacySettingsHref(window.location.hash, window.location.search);
    if (to) router.replace(to);
  }, [router]);
  return null;
}
