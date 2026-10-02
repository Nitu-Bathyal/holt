import "server-only";
import { headers } from "next/headers";
import { cache } from "react";
import { redirect, unstable_rethrow } from "next/navigation";
import { auth } from "@/auth";
import type { Caller } from "./api";
import { clientIpFrom } from "./client-ip";
import { signInHref } from "./gate";

export interface SessionUser {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
}

/**
 * The signed-in user, or null. Never throws: a down database means "signed out".
 * Once per request: the header, the page and its parts all ask.
 */
export const currentUser = cache(async (): Promise<SessionUser | null> => {
  try {
    const s = await auth();
    if (!s?.user?.id) return null;
    return { id: s.user.id, name: s.user.name ?? null, email: s.user.email ?? null, image: s.user.image ?? null };
  } catch (e) {
    unstable_rethrow(e);
    console.error("[holt] session lookup failed:", (e as Error).message);
    return null;
  }
});

type Params = Record<string, string | string[] | undefined>;

/**
 * The signed-in user of an account page (lib/gate.ts). Signed out, the
 * request ends here with a redirect to sign-in, then back to `path` with the
 * query it came with. Call it before the page loads anything.
 */
export async function requireUser(path: string, params: Params = {}): Promise<SessionUser> {
  const user = await currentUser();
  if (user) return user;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) for (const one of [v ?? []].flat()) q.append(k, one);
  redirect(signInHref(q.size ? `${path}?${q}` : path));
}

/** Who is asking, for API calls. Pass `user` when the page already looked it up. */
export async function caller(known?: SessionUser | null): Promise<Caller> {
  const [user, h] = await Promise.all([known !== undefined ? known : currentUser(), headers()]);
  return { userId: user?.id ?? null, ip: clientIpFrom(h) };
}
