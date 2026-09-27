// No imports, so it runs under `node --test`.

const TOKEN_FIELDS = ["access_token", "refresh_token", "id_token", "expires_at", "session_state"] as const;

/** Holt never calls GitHub or Google as the user, so it keeps no OAuth tokens:
 *  only the provider and the account id, which is all sign-in looks up. */
export function withoutTokens<T extends object>(account: T): T {
  const out = { ...account } as Record<string, unknown>;
  for (const f of TOKEN_FIELDS) delete out[f];
  return out as T;
}
