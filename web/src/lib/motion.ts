// The motion setting: follow the device, or always reduce, or always move.
// Stored in a cookie so the root layout puts it on <html data-motion> before
// the first paint. CSS reads that attribute (postcss-motion.mjs); scripts ask
// prefersReducedMotion(), never matchMedia directly.

export type Motion = "device" | "reduce" | "full";

export const MOTION_COOKIE = "holt-motion";

export const MOTION_OPTIONS: { value: Motion; label: string }[] = [
  { value: "device", label: "Match my device" },
  { value: "reduce", label: "Reduce motion" },
  { value: "full", label: "Full motion" },
];

const REDUCE_QUERY = "(prefers-reduced-motion: reduce)";
const YEAR = 60 * 60 * 24 * 365;

export function parseMotion(v: string | null | undefined): Motion {
  return v === "reduce" || v === "full" ? v : "device";
}

/** The setting from a cookie jar (next/headers cookies(), or anything with get). */
export function motionFromCookies(jar: { get(name: string): { value: string } | undefined }): Motion {
  return parseMotion(jar.get(MOTION_COOKIE)?.value);
}

/** What goes on <html data-motion>: nothing when it follows the device. */
export function motionAttr(m: Motion): "reduce" | "full" | undefined {
  return m === "device" ? undefined : m;
}

/** The setting wins; "device" asks the device. */
export function resolveReduced(m: Motion, deviceReduces: boolean): boolean {
  return m === "device" ? deviceReduces : m === "reduce";
}

/** The Set-Cookie value for document.cookie; "device" clears it. */
export function motionCookie(m: Motion): string {
  return m === "device" ? `${MOTION_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax` : `${MOTION_COOKIE}=${m}; Path=/; Max-Age=${YEAR}; SameSite=Lax`;
}

/** The setting as the page has it now. */
export function currentMotion(): Motion {
  return typeof document === "undefined" ? "device" : parseMotion(document.documentElement.dataset.motion);
}

export function deviceReduces(): boolean {
  return typeof matchMedia === "function" && matchMedia(REDUCE_QUERY).matches;
}

/** One switch (the footer's): off goes back to the device where that moves, else to full. */
export function toggledMotion(reducedNow: boolean, deviceReduces: boolean): Motion {
  if (!reducedNow) return "reduce";
  return deviceReduces ? "full" : "device";
}

/** Whether motion should stay still now: the setting first, then the device. False on the server. */
export function prefersReducedMotion(): boolean {
  if (typeof document === "undefined") return false;
  return resolveReduced(currentMotion(), deviceReduces());
}

/** Calls `cb` when the setting or the device's preference changes. */
export function onMotionChange(cb: () => void): () => void {
  if (typeof document === "undefined") return () => {};
  const mq = typeof matchMedia === "function" ? matchMedia(REDUCE_QUERY) : null;
  mq?.addEventListener("change", cb);
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-motion"] });
  return () => {
    mq?.removeEventListener("change", cb);
    mo.disconnect();
  };
}

/** Save the setting and apply it to this page at once. */
export function setMotion(m: Motion) {
  document.cookie = motionCookie(m);
  const a = motionAttr(m);
  if (a) document.documentElement.dataset.motion = a;
  else delete document.documentElement.dataset.motion;
}

/** A CSS time ("240ms", ".24s", as a custom property reads back) in milliseconds; `fallback` when it isn't one. */
export function cssTimeMs(v: string, fallback: number): number {
  const m = v.trim().match(/^(\d*\.?\d+)(ms|s)$/);
  return m ? Number(m[1]) * (m[2] === "s" ? 1000 : 1) : fallback;
}
