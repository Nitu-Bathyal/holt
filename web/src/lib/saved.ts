// Saved repos (API.md, "Saved repos"): the sign-in round trip for someone who
// pressed save while signed out. The page they come back to carries
// `?save=owner/repo`, and the save button there finishes the job. No imports,
// so it runs under `node --test` and in the browser.

export const SAVE_PARAM = "save";

/** Where "sign in to save" goes: sign-in, then back here asking to save `repo`. */
export function signInToSave(pathname: string, search: string, repo: string): string {
  const q = new URLSearchParams(search);
  q.set(SAVE_PARAM, repo);
  return `/signin?callbackUrl=${encodeURIComponent(`${pathname}?${q}`)}`;
}

/** Did the address ask to save this repo (after signing in)? */
export function wantsSave(search: string, repo: string): boolean {
  const asked = new URLSearchParams(search).get(SAVE_PARAM);
  return Boolean(asked) && asked!.toLowerCase() === repo.toLowerCase();
}

/** The address without the save request, once it has been handled. */
export function withoutSave(pathname: string, search: string): string {
  const q = new URLSearchParams(search);
  q.delete(SAVE_PARAM);
  const rest = q.toString();
  return rest ? `${pathname}?${rest}` : pathname;
}
