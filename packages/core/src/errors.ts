/** Exceptions carry a message key; the CLI renders them in the configured tone. */

import { text } from "./messages.ts";

/** A rejected call. Exit code 2 unless a subclass says otherwise. */
export class DummkopfError extends Error {
  readonly key: string;
  readonly params: Record<string, unknown>;
  readonly exitCode: number = 2;

  constructor(key: string, params: Record<string, unknown> = {}) {
    super(text(key, "plain", params));
    this.key = key;
    this.params = params;
  }

  /** The message in a tone: `plain` or `cheeky`. */
  render(tone: string): string {
    return text(this.key, tone, this.params);
  }

  override toString(): string {
    return this.message;
  }
}

/** Never reveal a path, a sensitivity flag or source text. */
export class AccessDenied extends DummkopfError {}

/** Input or state violates a rule; nothing was written. */
export class Rejected extends DummkopfError {}

/** Git sync failed; never echo raw Git output, it may contain note text. */
export class SyncError extends DummkopfError {}

/** dummkopf.toml is unreadable or invalid. */
export class ConfigError extends DummkopfError {}

/** No dummkopf.toml was found. */
export class ConfigMissing extends ConfigError {}
