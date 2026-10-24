/**
 * Command line entry point: `rcllr`, and the old names `dummkopf` and `dk` during the transition.
 *
 * Exit codes: 0 ok, 2 rejected call (nothing changed), 3 saved but Git sync failed.
 */

import { type Config, RcllrError, findRoot, HELP, loadConfig, message, VERSION } from "@rcllr/core";

import {
  register as registerAdmin, runCurator, runHook, runInit, runInstall, runLinks, runMeta, runMigrateName,
  runImportMemory,
} from "./admin.ts";
import { HelpRequested, type Namespace, Parser, UsageError } from "./argparse.ts";
import { register as registerCommands, run as runCommand } from "./commands.ts";
import { err, out } from "./io.ts";
import { accessOptions, checkRange, commonOptions, MAX_CHARS_RANGE, outputOptions } from "./options.ts";
import { runRead } from "./read.ts";

export type Handler = (args: Namespace, config: Config, tone: string) => number;
export type NoConfigHandler = (args: Namespace, root: string, tone: string) => number;

/** The heading each command is listed under in `rcllr --help`. */
const GROUPS: Readonly<Record<string, string>> = {
  context: "read", find: "read", read: "read", ingest: "write", write: "write", check: "write", sync: "write",
  init: "setup", install: "setup", "migrate-name": "setup", "import-memory": "extras", hook: "setup", meta: "setup", links: "extras", curator: "extras",
};

export function parser(): Parser {
  const command = new Parser("rcllr", { purpose: HELP.prog!, version: "rcllr " + VERSION });
  commonOptions(command, true);
  command.commandsDest("command");
  const add = (name: string): Parser => {
    const sub = command.command(name, {
      purpose: HELP["cmd_" + name]!, examples: HELP["ex_" + name], notes: HELP["notes_" + name], group: GROUPS[name],
    });
    commonOptions(sub, false);
    return sub;
  };
  for (const name of ["context", "find", "read"]) {
    const action = add(name);
    if (name === "read") action.positional("path", HELP.path!);
    else action.positional("query", HELP.query!);
    accessOptions(action);
    outputOptions(action);
    if (name === "find") {
      action.option("--limit", { type: "int", help: HELP.limit! });
    } else if (name === "read") {
      action.option("--start", { type: "int", help: HELP.start! });
      action.option("--end", { type: "int", help: HELP.end! });
      action.option("--section", { metavar: "HEADING", help: HELP.section! });
    }
  }
  registerCommands(add);
  registerAdmin(add);
  return command;
}

function handlers(): [Record<string, Handler>, Record<string, NoConfigHandler>] {
  const withConfig: Record<string, Handler> = {
    context: runRead, find: runRead, read: runRead,
    ingest: runCommand, write: runCommand, check: runCommand, sync: runCommand,
    install: runInstall, "migrate-name": runMigrateName, "import-memory": runImportMemory, meta: runMeta, links: runLinks, curator: runCurator,
  };
  return [withConfig, { init: runInit, hook: runHook }];
}

export function main(argv: readonly string[]): number {
  let args: Namespace;
  try {
    args = parser().parse(argv);
  } catch (error) {
    if (error instanceof HelpRequested) {
      out(error.text);
      return 0;
    }
    if (error instanceof UsageError) {
      err(error.parser.error(error.message));
      return 2;
    }
    throw error;
  }
  let tone = "plain";
  let allScopes: string | null = null;
  try {
    const explicit = typeof args.root === "string" ? args.root : null;
    const [withConfig, withoutConfig] = handlers();
    const command = args.command as string;
    const noConfig = withoutConfig[command];
    if (noConfig) return noConfig(args, explicit ?? process.cwd(), tone);
    const config = loadConfig(findRoot(process.cwd(), explicit));
    allScopes = config.scopes.all;
    if (!args.serious) tone = config.ui.tone;
    if ("maxChars" in args) {
      if (args.maxChars === null) args.maxChars = config.limits.maxChars;
      checkRange(args.maxChars as number, MAX_CHARS_RANGE, "max_chars_range");
    }
    return withConfig[command]!(args, config, tone);
  } catch (error) {
    if (error instanceof RcllrError) {
      // The hint depends only on the request, never on the path, so it reveals nothing a missing file would not.
      const narrow = error.key === "path_denied" && typeof args.scope === "string" && allScopes !== null
        && args.scope !== allScopes;
      const hint = narrow ? " " + message("scope_hint", tone, { scope: args.scope, all: allScopes }) : "";
      err(error.render(tone) + hint + "\n");
      return error.exitCode;
    }
    throw error;
  }
}
