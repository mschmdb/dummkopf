/**
 * A small argparse: subcommands, options before and after the subcommand, unique prefixes,
 * `--opt=value`, negative numbers as values, and argparse's error texts with exit code 2.
 */

export type Namespace = Record<string, unknown>;

export class UsageError extends Error {
  readonly parser: Parser;
  constructor(parser: Parser, message: string) {
    super(message);
    this.parser = parser;
  }
}

/** --help was given; the help text is ready to print. */
export class HelpRequested extends Error {
  readonly text: string;
  constructor(text: string) {
    super("help");
    this.text = text;
  }
}

type Kind = "value" | "flag" | "append";

interface Option {
  readonly flags: readonly string[];
  readonly dest: string;
  readonly kind: Kind;
  readonly help: string;
  readonly metavar?: string;
  readonly type?: "int";
  readonly choices?: readonly string[];
  readonly required?: boolean;
  readonly default?: unknown;
  /** Leave the destination unset when the option is absent (argparse.SUPPRESS). */
  readonly suppress?: boolean;
}

interface Positional {
  readonly dest: string;
  readonly help: string;
  readonly nargs?: "?" | "*";
  readonly choices?: readonly string[];
}

export interface OptionSpec {
  dest?: string;
  kind?: Kind;
  help: string;
  metavar?: string;
  type?: "int";
  choices?: readonly string[];
  required?: boolean;
  default?: unknown;
  suppress?: boolean;
}

function camel(flag: string): string {
  return flag.replace(/^-+/, "").replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function isNegativeNumber(value: string): boolean {
  return /^-\d+$|^-\d*\.\d+$/.test(value);
}

export class Parser {
  readonly prog: string;
  readonly description: string;
  readonly epilog: string;
  private readonly options: Option[] = [];
  private readonly positionals: Positional[] = [];
  private readonly commands = new Map<string, Parser>();
  private commandDest = "";

  constructor(prog: string, description = "", epilog = "") {
    this.prog = prog;
    this.description = description;
    this.epilog = epilog;
  }

  option(flags: string | readonly string[], spec: OptionSpec): this {
    const list = typeof flags === "string" ? [flags] : flags;
    const long = list.find((flag) => flag.startsWith("--")) ?? list[0]!;
    this.options.push({ flags: list, dest: spec.dest ?? camel(long), kind: spec.kind ?? "value", ...spec });
    return this;
  }

  positional(dest: string, help: string, extra: { nargs?: "?" | "*"; choices?: readonly string[] } = {}): this {
    this.positionals.push({ dest, help, ...extra });
    return this;
  }

  command(name: string, epilog: string): Parser {
    const sub = new Parser(this.prog + " " + name, "", epilog);
    this.commands.set(name, sub);
    return sub;
  }

  /** Subcommands are required and stored under `dest`. */
  commandsDest(dest: string): void {
    this.commandDest = dest;
  }

  parse(argv: readonly string[]): Namespace {
    const namespace: Namespace = {};
    this.parseInto(argv, namespace);
    return namespace;
  }

  private defaults(namespace: Namespace): void {
    for (const option of this.options) {
      if (option.suppress) continue;
      if (!(option.dest in namespace)) {
        namespace[option.dest] = option.kind === "flag" ? false : option.kind === "append" ? [] : option.default ?? null;
      }
    }
  }

  private match(arg: string): [Option, string | null] | null {
    const eq = arg.startsWith("--") ? arg.indexOf("=") : -1;
    const flag = eq === -1 ? arg : arg.slice(0, eq);
    const inline = eq === -1 ? null : arg.slice(eq + 1);
    const exact = this.options.find((option) => option.flags.includes(flag));
    if (exact) return [exact, inline];
    if (!flag.startsWith("--")) return null;
    const candidates = this.options.filter((option) => option.flags.some((name) => name.startsWith(flag)));
    if (candidates.length > 1) {
      const names = candidates.map((option) => option.flags.find((name) => name.startsWith(flag))!).join(", ");
      throw new UsageError(this, "ambiguous option: " + flag + " could match " + names);
    }
    return candidates.length === 1 ? [candidates[0]!, inline] : null;
  }

  private convert(option: Option, value: string): unknown {
    const label = "argument " + option.flags.join("/");
    if (option.type === "int") {
      if (!/^[-+]?\s*\d+\s*$/.test(value.replace(/_/g, ""))) {
        throw new UsageError(this, label + ": invalid int value: '" + value + "'");
      }
      return Number.parseInt(value.replace(/[_\s]/g, ""), 10);
    }
    if (option.choices && !option.choices.includes(value)) {
      throw new UsageError(this, label + ": invalid choice: '" + value + "' (choose from "
        + option.choices.map((choice) => "'" + choice + "'").join(", ") + ")");
    }
    return value;
  }

  private parseInto(argv: readonly string[], namespace: Namespace): void {
    const loose: string[] = [];
    const seen = new Set<string>();
    let i = 0;
    let onlyPositionals = false;
    while (i < argv.length) {
      const arg = argv[i]!;
      i++;
      if (!onlyPositionals && arg === "--") {
        onlyPositionals = true;
        continue;
      }
      if (!onlyPositionals && (arg === "-h" || arg === "--help")) throw new HelpRequested(this.help());
      if (!onlyPositionals && arg.startsWith("-") && arg !== "-" && !isNegativeNumber(arg)) {
        const found = this.match(arg);
        if (!found) {
          loose.push(arg);
          continue;
        }
        const [option, inline] = found;
        seen.add(option.dest);
        if (option.kind === "flag") {
          if (inline !== null) throw new UsageError(this, "argument " + option.flags.join("/") + ": ignored explicit argument '" + inline + "'");
          namespace[option.dest] = true;
          continue;
        }
        let value = inline;
        if (value === null) {
          const next = argv[i];
          if (next === undefined || (next.startsWith("-") && next !== "-" && !isNegativeNumber(next))) {
            throw new UsageError(this, "argument " + option.flags.join("/") + ": expected one argument");
          }
          value = next;
          i++;
        }
        const converted = this.convert(option, value);
        if (option.kind === "append") {
          const list = Array.isArray(namespace[option.dest]) ? namespace[option.dest] as unknown[] : [];
          namespace[option.dest] = [...list, converted];
        } else {
          namespace[option.dest] = converted;
        }
        continue;
      }
      if (this.commands.size > 0) {
        const sub = this.commands.get(arg);
        if (!sub) {
          throw new UsageError(this, "argument " + this.commandDest + ": invalid choice: '" + arg + "' (choose from "
            + [...this.commands.keys()].map((name) => "'" + name + "'").join(", ") + ")");
        }
        this.defaults(namespace);
        namespace[this.commandDest] = arg;
        sub.parseInto(argv.slice(i), namespace);
        if (loose.length > 0) throw new UsageError(this, "unrecognized arguments: " + loose.join(" "));
        return;
      }
      loose.push(arg);
    }
    if (this.commands.size > 0) {
      throw new UsageError(this, "the following arguments are required: " + this.commandDest);
    }
    this.defaults(namespace);
    this.assignPositionals(loose, namespace);
    const missing = this.options.filter((option) => option.required && !seen.has(option.dest));
    if (missing.length > 0) {
      throw new UsageError(this, "the following arguments are required: " + missing.map((option) => option.flags.join("/")).join(", "));
    }
  }

  private assignPositionals(values: string[], namespace: Namespace): void {
    const flags = values.filter((value) => value.startsWith("-") && value !== "-" && !isNegativeNumber(value));
    const rest = values.filter((value) => !flags.includes(value));
    const missing: string[] = [];
    for (const positional of this.positionals) {
      if (positional.nargs === "*") {
        namespace[positional.dest] = rest.splice(0);
      } else if (positional.nargs === "?") {
        namespace[positional.dest] = rest.length > 0 ? rest.shift()! : null;
      } else if (rest.length > 0) {
        const value = rest.shift()!;
        if (positional.choices && !positional.choices.includes(value)) {
          throw new UsageError(this, "argument " + positional.dest + ": invalid choice: '" + value + "' (choose from "
            + positional.choices.map((choice) => "'" + choice + "'").join(", ") + ")");
        }
        namespace[positional.dest] = value;
      } else {
        missing.push(positional.dest);
      }
    }
    if (missing.length > 0) throw new UsageError(this, "the following arguments are required: " + missing.join(", "));
    const extra = [...flags, ...rest];
    if (extra.length > 0) throw new UsageError(this, "unrecognized arguments: " + extra.join(" "));
  }

  usage(): string {
    const parts = ["usage: " + this.prog, "[-h]"];
    for (const option of this.options) {
      const flag = option.flags[0]!;
      const shown = option.kind === "flag" ? flag : flag + " " + metavarOf(option);
      parts.push(option.required ? shown : "[" + shown + "]");
    }
    for (const positional of this.positionals) {
      const shown = positional.choices ? "{" + positional.choices.join(",") + "}" : positional.dest;
      parts.push(positional.nargs === "?" ? "[" + shown + "]" : positional.nargs === "*" ? "[" + shown + " ...]" : shown);
    }
    if (this.commands.size > 0) parts.push("{" + [...this.commands.keys()].join(",") + "} ...");
    return parts.join(" ");
  }

  help(): string {
    const lines = [this.usage(), ""];
    if (this.description) lines.push(this.description, "");
    if (this.commands.size > 0) {
      lines.push("positional arguments:", "  {" + [...this.commands.keys()].join(",") + "}", "");
    } else if (this.positionals.length > 0) {
      lines.push("positional arguments:");
      for (const positional of this.positionals) lines.push(row(positional.dest, positional.help));
      lines.push("");
    }
    lines.push("options:", row("-h, --help", "show this help message and exit"));
    for (const option of this.options) {
      const metavar = option.kind === "flag" ? "" : " " + metavarOf(option);
      lines.push(row(option.flags.map((flag) => flag + metavar).join(", "), option.help));
    }
    if (this.epilog) lines.push("", this.epilog);
    return lines.join("\n") + "\n";
  }
}

/** argparse's default metavar: `{a,b}` for choices, else the dest in upper case. */
function metavarOf(option: Option): string {
  if (option.metavar !== undefined) return option.metavar;
  if (option.choices) return "{" + option.choices.join(",") + "}";
  return option.dest.replace(/[A-Z]/g, (c) => "_" + c).toUpperCase();
}

function row(name: string, help: string): string {
  const left = "  " + name;
  return left.length >= 24 ? left + "\n" + " ".repeat(24) + help : left.padEnd(24) + help;
}
