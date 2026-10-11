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
    const extras = this.parseInto(argv, namespace);
    // Like parse_args: the top-level parser reports leftovers, also those after a subcommand.
    if (extras.length > 0) throw new UsageError(this, "unrecognized arguments: " + extras.join(" "));
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

  /** Parse into `namespace`; return the arguments nobody recognized, in their order. */
  private parseInto(argv: readonly string[], namespace: Namespace): string[] {
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
        return [...loose, ...sub.parseInto(argv.slice(i), namespace)];
      }
      loose.push(arg);
    }
    if (this.commands.size > 0) {
      throw new UsageError(this, "the following arguments are required: " + this.commandDest);
    }
    this.defaults(namespace);
    const extras = this.assignPositionals(loose, namespace);
    const missing = this.options.filter((option) => option.required && !seen.has(option.dest));
    if (missing.length > 0) {
      throw new UsageError(this, "the following arguments are required: " + missing.map((option) => option.flags.join("/")).join(", "));
    }
    return extras;
  }

  /** Fill the positionals; return what is left over, in order. */
  private assignPositionals(values: string[], namespace: Namespace): string[] {
    const isFlag = (value: string): boolean => value.startsWith("-") && value !== "-" && !isNegativeNumber(value);
    const rest = values.filter((value) => !isFlag(value));
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
    const left = [...rest];
    return values.filter((value) => {
      if (isFlag(value)) return true;
      const index = left.indexOf(value);
      if (index === -1) return false;
      left.splice(index, 1);
      return true;
    });
  }

  /** The usage line, wrapped like Python's HelpFormatter: options first, positionals on their own lines. */
  usage(): string {
    const optionals = ["[-h]"];
    for (const option of this.options) {
      const flag = option.flags[0]!;
      const shown = option.kind === "flag" ? flag : flag + " " + metavarOf(option);
      optionals.push(option.required ? shown : "[" + shown + "]");
    }
    const positionals: string[] = [];
    for (const positional of this.positionals) {
      const shown = positional.choices ? "{" + positional.choices.join(",") + "}" : positional.dest;
      positionals.push(positional.nargs === "?" ? "[" + shown + "]" : positional.nargs === "*" ? "[" + shown + " ...]" : shown);
    }
    if (this.commands.size > 0) positionals.push("{" + [...this.commands.keys()].join(",") + "} ...");
    const prefix = "usage: ";
    const width = textWidth();
    const single = prefix + [this.prog, ...optionals, ...positionals].join(" ");
    if (single.length <= width) return single;
    const indent = " ".repeat(prefix.length + this.prog.length + 1);
    const lines = (parts: string[], first: boolean): string[] => {
      const out: string[] = [];
      let line: string[] = [];
      let lineLength = first ? prefix.length - 1 : indent.length - 1;
      for (const part of parts) {
        if (lineLength + 1 + part.length > width && line.length > 0) {
          out.push(indent + line.join(" "));
          line = [];
          lineLength = indent.length - 1;
        }
        line.push(part);
        lineLength += part.length + 1;
      }
      if (line.length > 0) out.push(indent + line.join(" "));
      if (first) out[0] = out[0]!.slice(indent.length);
      return out;
    };
    let wrapped: string[];
    if (prefix.length + this.prog.length <= 0.75 * width) {
      wrapped = [...lines([this.prog, ...optionals], true), ...(positionals.length > 0 ? lines(positionals, false) : [])];
    } else {
      wrapped = [this.prog, ...lines([...optionals, ...positionals], false)];
    }
    return prefix + wrapped.join("\n");
  }

  /** Help text laid out like Python's HelpFormatter; subcommand epilogs stay raw (RawDescriptionHelpFormatter). */
  help(): string {
    const width = textWidth();
    const rows: [string, string][] = [];
    const positionalRows: [string, string][] = this.commands.size > 0
      ? [["{" + [...this.commands.keys()].join(",") + "}", ""]]
      : this.positionals.map((positional) => [positional.choices ? "{" + positional.choices.join(",") + "}" : positional.dest, positional.help]);
    rows.push(["-h, --help", "show this help message and exit"]);
    for (const option of this.options) {
      const metavar = option.kind === "flag" ? "" : " " + metavarOf(option);
      rows.push([option.flags.map((flag) => flag + metavar).join(", "), option.help]);
    }
    const longest = Math.max(...[...positionalRows, ...rows].map(([name]) => name.length + 2));
    const helpPosition = Math.min(longest + 2, Math.min(24, Math.max(width - 20, 4)));
    const format = ([name, help]: [string, string]): string[] => {
      const actionWidth = helpPosition - 4;
      const helpLines = help ? fill(help, Math.max(width - helpPosition, 11)) : [];
      const pad = " ".repeat(helpPosition);
      if (!help) return ["  " + name];
      if (name.length <= actionWidth) {
        return ["  " + name.padEnd(actionWidth) + "  " + helpLines[0], ...helpLines.slice(1).map((line) => pad + line)];
      }
      return ["  " + name, ...helpLines.map((line) => pad + line)];
    };
    const lines = [this.usage(), ""];
    if (this.description) lines.push(...fill(this.description, width), "");
    if (positionalRows.length > 0) lines.push("positional arguments:", ...positionalRows.flatMap(format), "");
    lines.push("options:", ...rows.flatMap(format));
    if (this.epilog) lines.push("", ...(this.prog.includes(" ") ? [this.epilog] : fill(this.epilog, width)));
    return lines.join("\n") + "\n";
  }

}

/** argparse's default metavar: `{a,b}` for choices, else the dest in upper case. */
function metavarOf(option: Option): string {
  if (option.metavar !== undefined) return option.metavar;
  if (option.choices) return "{" + option.choices.join(",") + "}";
  return option.dest.replace(/[A-Z]/g, (c) => "_" + c).toUpperCase();
}

/** Python's argparse width: the terminal columns ($COLUMNS first, 80 without a terminal) minus 2. */
function textWidth(): number {
  const fromEnv = Number.parseInt(process.env.COLUMNS ?? "", 10);
  const columns = Number.isInteger(fromEnv) && fromEnv > 0 ? fromEnv : process.stdout.columns || 80;
  return Math.max(columns - 2, 11);
}

/** textwrap.fill after collapsing whitespace: greedy lines, breaks at spaces and after hyphens in words. */
function fill(text: string, width: number): string[] {
  const chunks: { text: string; space: boolean }[] = [];
  for (const word of text.trim().split(/\s+/)) {
    word.split(/(?<=[A-Za-z]{2}-)(?=[A-Za-z])/).forEach((piece, index) => chunks.push({ text: piece, space: index === 0 }));
  }
  const lines: string[] = [];
  let line = "";
  for (const chunk of chunks) {
    const joined = line === "" ? chunk.text : line + (chunk.space ? " " : "") + chunk.text;
    if (joined.length > width && line !== "") {
      lines.push(line);
      line = chunk.text;
    } else {
      line = joined;
    }
  }
  if (line !== "") lines.push(line);
  return lines;
}
