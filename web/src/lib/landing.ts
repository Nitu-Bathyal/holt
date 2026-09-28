// How a landing-map area is written: a folder gets a trailing "/", one file
// (the engine sends `is_file`) or the repository root doesn't.
export function areaLabel(area: { path: string; is_file?: boolean }): string {
  return area.is_file || area.path === "(root)" ? area.path : `${area.path}/`;
}
