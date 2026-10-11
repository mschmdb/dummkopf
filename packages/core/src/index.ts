/**
 * @dummkopf/core: long-term memory for coding agents, kept in a Git repo of Markdown notes.
 *
 * Read notes only through `Access`: it applies scope, sensitivity and path rules. The core exports no
 * raw file reader for notes, so a frontend cannot skip the gate by accident.
 */

export { Access, type Note } from "./access.ts";
export * from "./config.ts";
export * from "./errors.ts";
export { parseFrontmatter, dumpFrontmatter, shorten, type Data, type Value } from "./frontmatter.ts";
export { getLocale, type Locale } from "./locale.ts";
export { withRepositoryLock } from "./lock.ts";
export { HELP, PLAIN, CHEEKY, text as message } from "./messages.ts";
export { loads as loadsJson, JsonDecodeError, type Json, type JsonObject } from "./pyjson.ts";
export { Sensitivity } from "./sensitive.ts";
export { syncRepository } from "./sync.ts";
export { words } from "./text.ts";

// Read path: search, routes, render.

// Write path: links, validate, write.

// Setup and maintenance: meta, scaffold, install, hook, extras.

export const VERSION = "0.3.0-dev";
