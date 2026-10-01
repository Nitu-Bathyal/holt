// The browser's side of PR watch: the bell, My PRs and the alert settings
// change things through /api/alerts (the browser never calls the Holt API).
import { ALERTS_EVENT, browserTz, emailKind, withTz, type EmailKind } from "./alerts";
import type { AlertList, AlertSettings } from "./types";

const JSON_BODY = { "Content-Type": "application/json" };

export type Saved = { ok: true; settings: AlertSettings } | { ok: false; status: number };

/** Something about alerts changed here: the bell reads its list again. */
export function announce() {
  window.dispatchEvent(new Event(ALERTS_EVENT));
}

/** Change the switches or the email mode. Every save carries the browser's time zone. */
export async function saveSettings(change: { enabled?: boolean; email_on?: boolean; email_mode?: AlertSettings["email_mode"] }): Promise<Saved> {
  try {
    const res = await fetch("/api/alerts/settings", { method: "PUT", headers: JSON_BODY, body: JSON.stringify(withTz(change, browserTz())) });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, settings: (await res.json()) as AlertSettings };
  } catch {
    return { ok: false, status: 0 }; // offline
  }
}

export async function fetchList(): Promise<AlertList | null> {
  try {
    const res = await fetch("/api/alerts", { cache: "no-store" });
    return res.ok ? ((await res.json()) as AlertList) : null;
  } catch {
    return null;
  }
}

export async function fetchCount(): Promise<number | null> {
  try {
    const res = await fetch("/api/alerts/count", { cache: "no-store" });
    const n = res.ok ? ((await res.json()) as { unread?: unknown }).unread : null;
    return typeof n === "number" ? n : null;
  } catch {
    return null;
  }
}

/** Mark alerts read. `keepalive`, so it still lands when the click also leaves for GitHub. */
export async function markRead(which: { ids: number[] } | { all: true }): Promise<boolean> {
  try {
    return (await fetch("/api/alerts/read", { method: "POST", headers: JSON_BODY, body: JSON.stringify(which), keepalive: true })).ok;
  } catch {
    return false;
  }
}

export async function setMute(repo: string, number: number, muted: boolean): Promise<boolean> {
  try {
    const path = `/api/alerts/mute/${repo.split("/").map(encodeURIComponent).join("/")}/${number}`;
    return (await fetch(path, { method: muted ? "PUT" : "DELETE", keepalive: true })).ok; // lands even if they leave the page
  } catch {
    return false;
  }
}

/**
 * An email's unsubscribe link: those emails off, or back on (undo). The status
 * the server answered (0 when offline), and which emails the token was for.
 */
export async function setEmailByToken(token: string, on: boolean): Promise<{ status: number; kind: EmailKind | null }> {
  try {
    const res = await fetch(`/api/alerts/${on ? "resubscribe" : "unsubscribe"}`, { method: "POST", headers: JSON_BODY, body: JSON.stringify({ token }) });
    return { status: res.status, kind: res.ok ? emailKind(await res.json().catch(() => null)) : null };
  } catch {
    return { status: 0, kind: null };
  }
}
