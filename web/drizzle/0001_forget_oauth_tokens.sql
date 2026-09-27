-- Holt never calls GitHub or Google as the user, so it keeps no OAuth tokens.
-- Sign-in only looks up (provider, providerAccountId); new sign-ins no longer
-- store tokens (src/lib/oauth-account.ts). This clears the ones already stored.
UPDATE "account" SET "access_token" = NULL, "refresh_token" = NULL, "id_token" = NULL, "expires_at" = NULL, "session_state" = NULL;
