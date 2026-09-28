// What /signin says when Auth.js sends someone back with ?error=<code>.
// Auth.js v5 passes only a few codes to the page (the rest become
// "Configuration"); the v4 names are kept because old links still carry them.
// Pure, so it runs under `node --test`.

export interface SignInNotice {
  /** "info" for a nudge (you need to sign in), "error" when sign-in failed. */
  tone: "info" | "error";
  title: string;
  body: string;
}

const LINKED: SignInNotice = {
  tone: "error",
  title: "That email already has a Holt account",
  body: "It was made with the other sign-in button. Use that one instead.",
};
const UNFINISHED: SignInNotice = {
  tone: "error",
  title: "Sign-in didn't finish",
  body: "GitHub or Google didn't hand you back to Holt. Try again. If it keeps failing, try the other button.",
};
const OUR_SIDE: SignInNotice = {
  tone: "error",
  title: "Sign-in is broken on our side",
  body: "It's not something you did. Try again in a few minutes.",
};
const FALLBACK: SignInNotice = {
  tone: "error",
  title: "Sign-in didn't work",
  body: "Try again. If it keeps failing, try the other button.",
};

const NOTICES: Record<string, SignInNotice> = {
  OAuthAccountNotLinked: LINKED,
  AccountNotLinked: LINKED,
  AccessDenied: {
    tone: "error",
    title: "Sign-in was cancelled",
    body: "Nothing was shared with Holt. Try again when you're ready.",
  },
  OAuthCallbackError: UNFINISHED,
  OAuthCallback: UNFINISHED,
  OAuthSignInError: UNFINISHED,
  OAuthSignin: UNFINISHED,
  OAuthCreateAccount: UNFINISHED,
  Callback: UNFINISHED,
  MissingCSRF: {
    tone: "error",
    title: "Your browser dropped a sign-in cookie",
    body: "This happens when the page sat open a long time or cookies are blocked. Reload the page and try again.",
  },
  Verification: {
    tone: "error",
    title: "That sign-in link has expired",
    body: "Links work once and only for a short time. Start again below.",
  },
  Configuration: OUR_SIDE,
  AdapterError: OUR_SIDE,
  SessionRequired: {
    tone: "info",
    title: "Sign in to see that page",
    body: "You'll go straight back to it afterwards.",
  },
};

/** The notice for an Auth.js `?error=` value, or null when there is none. */
export function signInNotice(error: string | string[] | undefined | null): SignInNotice | null {
  const code = Array.isArray(error) ? error[0] : error;
  if (!code) return null;
  return Object.hasOwn(NOTICES, code) ? NOTICES[code] : FALLBACK;
}
