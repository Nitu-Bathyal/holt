// Types for access.mjs (plain JS so lighthouse.mjs can import it too).
export declare const ACCESS_COOKIE: "CF_Authorization";
export declare function accessToken(env?: NodeJS.ProcessEnv): { id: string; secret: string } | null;
export declare function accessCookie(
  baseURL: string,
  token: { id: string; secret: string },
): Promise<{
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: "Lax";
  expires: number;
}>;
