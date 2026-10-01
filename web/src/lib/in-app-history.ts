// The pages this tab has shown since Holt loaded in it, newest last, noted by
// the shell (shell-frame.tsx) on each move. The report's back arrow
// (back-button.tsx) reads it to go to the page before this repo's report and
// merge plan, however often someone went between those two.
const pages: string[] = [];
const MAX = 50;

/** Note the page now showing (path and query). The same page twice in a row counts once. */
export function notePage(href: string): void {
  if (pages.at(-1) === href) return;
  pages.push(href);
  if (pages.length > MAX) pages.shift();
}

const pathOf = (href: string) => href.split(/[?#]/)[0].replace(/\/+$/, "").toLowerCase() || "/";

/** The latest page shown that isn't `path` (any query): where "back" from it goes. Null when there's none. */
export function pageBefore(path: string, shown: readonly string[] = pages): string | null {
  const here = pathOf(path);
  for (let i = shown.length - 1; i >= 0; i--) if (pathOf(shown[i]) !== here) return shown[i];
  return null;
}
