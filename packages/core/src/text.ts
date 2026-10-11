/** Word tokens shared by search and routes. */

import { casefold } from "./py.ts";

const COMBINING = /\p{Mn}/gu;
const TOKEN = /[\p{L}\p{N}]+/gu;

/** Case- and accent-folded word tokens: `Straße Café` -> `strasse cafe`. */
export function words(value: string): string[] {
  const folded = casefold(value).normalize("NFKD").replace(COMBINING, "");
  return folded.match(TOKEN) ?? [];
}
