/** `context`, `find` and `read`: the read commands. Port of cli.run_read. */

import type { Config } from "@dummkopf/core";

import type { Namespace } from "./argparse.ts";

export function runRead(args: Namespace, config: Config, tone: string): number {
  void args;
  void config;
  void tone;
  throw new Error("not implemented: read commands");
}
