/** Setup and maintenance commands: init, install, hook, meta, links, curator. Port of admin.py. */

import type { Config } from "@dummkopf/core";

import type { Namespace, Parser } from "./argparse.ts";

export function register(add: (name: string) => Parser): void {
  void add;
}

function todo(name: string): never {
  throw new Error("not implemented: " + name);
}

export function runInit(args: Namespace, root: string, tone: string): number {
  void args; void root; void tone;
  return todo("init");
}

export function runHook(args: Namespace, root: string, tone: string): number {
  void args; void root; void tone;
  return todo("hook");
}

export function runInstall(args: Namespace, config: Config, tone: string): number {
  void args; void config; void tone;
  return todo("install");
}

export function runMeta(args: Namespace, config: Config, tone: string): number {
  void args; void config; void tone;
  return todo("meta");
}

export function runLinks(args: Namespace, config: Config, tone: string): number {
  void args; void config; void tone;
  return todo("links");
}

export function runCurator(args: Namespace, config: Config, tone: string): number {
  void args; void config; void tone;
  return todo("curator");
}
