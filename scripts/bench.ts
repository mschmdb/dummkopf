// Reproducible benchmark of the read commands: `pnpm bench`.
// Builds the CLI, generates synthetic local brains (200 and 2000 notes) from a fixed seed in a temporary
// folder and times `context`, `find` and `read` against a bare `node -e ""` start. No dependencies.
// Flags: --no-build uses the existing dist/, --runs N changes the runs per command (default 10).
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { cpus, platform, release, arch, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(ROOT, "packages/cli/bin/rcllr");
const SIZES = [200, 2000];
const args = process.argv.slice(2);
const runsIndex = args.indexOf("--runs");
const RUNS = runsIndex >= 0 ? Number(args[runsIndex + 1]) : 10;

const WORDS = ("release deploy staging rollback pipeline cache build runner token queue worker schedule "
  + "invoice budget tax receipt salary garden tomato compost sourdough starter oven bread travel train "
  + "ticket hotel passport dentist insurance contract landlord heating boiler bicycle chain brake tyre "
  + "postgres index migration vacuum replica backup restore kubernetes ingress certificate renewal "
  + "monitor alert pager oncall incident review retro roadmap quarter hiring interview onboarding").split(" ");

/** mulberry32: a tiny seeded generator, so every run builds the same brain. */
function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function words(random: () => number, count: number): string[] {
  return Array.from({ length: count }, () => WORDS[Math.floor(random() * WORDS.length)]!);
}

function sentence(random: () => number, count: number): string {
  const text = words(random, count).join(" ");
  return text[0]!.toUpperCase() + text.slice(1) + ".";
}

function frontmatter(fields: Record<string, string>): string {
  return "---\n" + Object.entries(fields).map(([key, value]) => `${key}: ${value}`).join("\n") + "\n---\n";
}

function date(random: () => number): string {
  const month = 1 + Math.floor(random() * 9);
  const day = 1 + Math.floor(random() * 28);
  return `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Writes a local brain with `notes` notes spread over topics, commits it and returns its root. */
function makeBrain(parent: string, notes: number): string {
  const random = generator(notes);
  const root = join(parent, `brain-${notes}`);
  const topics = Math.max(10, Math.round(notes / 20));
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "rcllr.toml"), "schema_version = 1\n");
  for (let topic = 0; topic < topics; topic++) {
    const dir = join(root, "topics", `topic-${String(topic).padStart(3, "0")}`);
    mkdirSync(dir, { recursive: true });
    const fact = sentence(random, 8);
    writeFileSync(join(dir, "README.md"), frontmatter({
      scope: topic % 3 === 0 ? "private" : "work", updated: date(random), status: "active",
      key_fact: fact, summary: fact, aliases: `[${words(random, 2).join(", ")}]`, period: "[]", entities: "[]",
    }) + `\n# Topic ${topic}\n\n${sentence(random, 30)}\n`);
  }
  for (let note = 0; note < notes; note++) {
    const topic = note % topics;
    const name = `note-${String(note).padStart(4, "0")}`;
    const path = join(root, "topics", `topic-${String(topic).padStart(3, "0")}`, `${name}.md`);
    const fact = sentence(random, 10);
    const paragraphs = Array.from({ length: 4 }, () => sentence(random, 25 + Math.floor(random() * 30)));
    // Every 50th note is sensitive. Links stay inside the topic and never point at a sensitive note,
    // so `rcllr check` passes on the generated brain.
    const isSensitive = (index: number) => index % 50 === 7;
    let target = topic + topics * Math.floor(random() * (notes / topics));
    if (target >= notes || isSensitive(target)) target = note;
    const link = `See [[note-${String(target).padStart(4, "0")}]] for the follow-up.`;
    const sensitive = isSensitive(note) ? "\n> SENSITIVE\n" : "";
    writeFileSync(path, frontmatter({
      updated: date(random), status: random() < 0.85 ? "active" : "archived", key_fact: fact,
      summary: fact, aliases: `[${words(random, 2).join(", ")}]`, period: "[]", entities: "[]",
    }) + `\n# ${words(random, 3).join(" ")}\n${sensitive}\n${paragraphs.join("\n\n")}\n\n${link}\n`);
  }
  const git = (...gitArgs: string[]) => {
    const result = spawnSync("git", ["-c", "user.name=bench", "-c", "user.email=bench@example.invalid",
      "-c", "commit.gpgsign=false", ...gitArgs], { cwd: root, encoding: "utf8" });
    if (result.status !== 0) throw new Error(`git ${gitArgs[0]} failed: ${result.stderr}`);
  };
  // Generates .sensitive-paths, INDEX.md and the topic file tables, like a real brain has them.
  const index = spawnSync(process.execPath, [BIN, "--root", root, "meta", "index"], { encoding: "utf8" });
  if (index.status !== 0) throw new Error(`meta index failed: ${index.stderr}`);
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-q", "-m", "Synthetic brain");
  return root;
}

function time(command: string, commandArgs: string[], expectOk = true): number[] {
  const samples: number[] = [];
  for (let run = 0; run < RUNS; run++) {
    const start = process.hrtime.bigint();
    const result = spawnSync(command, commandArgs, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    samples.push(Number(process.hrtime.bigint() - start) / 1e6);
    if (expectOk && result.status !== 0) {
      throw new Error(`${commandArgs.join(" ")} exited with ${result.status}: ${result.stderr}`);
    }
  }
  return samples;
}

function stats(samples: number[]): [string, string] {
  const sorted = [...samples].sort((a, b) => a - b);
  const middle = sorted.length / 2;
  const median = sorted.length % 2 ? sorted[Math.floor(middle)]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
  return [median.toFixed(1), `${sorted[0]!.toFixed(1)}–${sorted.at(-1)!.toFixed(1)}`];
}

if (!args.includes("--no-build")) {
  const build = spawnSync("pnpm", ["build"], { cwd: ROOT, stdio: "inherit" });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

const parent = mkdtempSync(join(tmpdir(), "rcllr-bench-"));
const rows: string[][] = [["brain", "command", "median ms", "min–max ms"]];
try {
  rows.push(["-", 'node -e ""', ...stats(time(process.execPath, ["-e", ""]))]);
  for (const size of SIZES) {
    const root = makeBrain(parent, size);
    const cli = (...cliArgs: string[]) => [BIN, "--root", root, ...cliArgs];
    const cases: [string, string[]][] = [
      ['context "how do we roll back a release"', cli("context", "how do we roll back a release")],
      ['find "postgres backup"', cli("find", "postgres backup")],
      ["read topics/topic-001/note-0001.md", cli("read", "topics/topic-001/note-0001.md")],
    ];
    for (const [label, commandArgs] of cases) {
      rows.push([`${size} notes`, label, ...stats(time(process.execPath, commandArgs))]);
    }
  }
} finally {
  rmSync(parent, { recursive: true, force: true });
}

const widths = rows[0]!.map((_, column) => Math.max(...rows.map((row) => row[column]!.length)));
const line = (row: string[]) => "| " + row.map((cell, column) => cell.padEnd(widths[column]!)).join(" | ") + " |";
const out = [
  `Node ${process.version}, ${platform()} ${release()} ${arch()}, ${cpus()[0]?.model ?? "unknown CPU"}`,
  `${RUNS} runs per command`,
  "",
  line(rows[0]!),
  "|" + widths.map((width) => "-".repeat(width + 2)).join("|") + "|",
  ...rows.slice(1).map(line),
];
process.stdout.write(out.join("\n") + "\n");
