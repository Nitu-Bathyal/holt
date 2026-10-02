// One part of a list from one of this site's part routes (a board's, a
// find's): `{items, next, total}`, or the route's error.
import type { Part } from "@/lib/parts";
import type { Result } from "@/lib/types";

export async function fetchPart<T>(url: string, init?: RequestInit): Promise<Result<Part<T>>> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null);
  if (res.ok && Array.isArray(body?.items)) return { ok: true, data: { items: body.items, next: body.next ?? null, total: body.total ?? 0 } };
  return { ok: false, status: res.status, error: body?.error?.code ? body.error : { code: "upstream", message: "Holt didn't answer. Try again." } };
}
