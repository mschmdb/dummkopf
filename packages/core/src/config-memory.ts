/** Checks for the two memory import sections, [claude_memory] and [codex_memory]. */

import type { Config } from "./config.ts";
import { ConfigError } from "./errors.ts";

function invalid(key: string, problem: string): ConfigError {
  return new ConfigError("config_invalid", { key, problem });
}

export function validateMemorySources(config: Config): void {
  const values = config.scopes.values;
  for (const [name, on, memory] of [["claude_memory", config.extras.claudeMemory, config.claudeMemory],
    ["codex_memory", config.extras.codexMemory, config.codexMemory]] as const) {
    if (on && !values.includes(memory.scope)) {
      throw invalid(name + ".scope", "must be one of scopes.values; add '" + memory.scope + "' there");
    }
    if (!/^[\p{L}\p{N}_-]+$/u.test(memory.topic)) throw invalid(name + ".topic", "use letters, digits, - and _ only");
    for (const entry of memory.scopeByProject) {
      const cut = entry.lastIndexOf("=");
      if (cut < 1 || (on && !values.includes(entry.slice(cut + 1)))) {
        throw invalid(name + ".scope_by_project", "'" + entry + "' must read <project folder>=<scope from scopes.values>");
      }
    }
  }
}
