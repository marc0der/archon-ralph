#!/usr/bin/env bun
/**
 * archon-ralph — scaffold the Ralph Wiggum Archon workflow into a project.
 *
 * Copies the project-agnostic loop machinery (workflow, commands, control
 * scripts, artifact templates, Bun project files) from this package's
 * `template/` directory into the target project's `.archon/` directory,
 * mirroring the ergonomics of `ralph init`.
 *
 * Usage:
 *   bunx archon-ralph init [--force] [--dir <path>]
 *
 *   init            Copy template files into <dir>/.archon/, skipping any
 *                   file that already exists (preserves local edits).
 *   --force, -f     Overwrite existing files instead of skipping them.
 *   --dir <path>    Target project root (default: current directory).
 *   --help, -h      Show this help.
 *
 * The scripts under `template/scripts/` import only Node built-ins, so the
 * installed `.archon/` needs no runtime dependencies — `bun install` inside
 * it is optional and only pulls `@types/bun` for editor/type-check DX.
 */

import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const TEMPLATE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "template");
const ARCHON_DIR = ".archon";

interface Options {
  force: boolean;
  dir: string;
}

function parseArgs(argv: readonly string[]): Options {
  const opts: Options = { force: false, dir: "." };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--force":
      case "-f":
        opts.force = true;
        break;
      case "--dir": {
        const next = argv[i + 1];
        if (!next) {
          console.error("archon-ralph: --dir requires a path argument");
          process.exit(1);
        }
        opts.dir = next;
        i += 1;
        break;
      }
      default:
        console.error(`archon-ralph: unknown argument '${arg}'`);
        process.exit(1);
    }
  }
  return opts;
}

function listTemplateFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else files.push(relative(root, full));
    }
  };
  walk(root);
  return files.sort();
}

const HELP = `archon-ralph — scaffold the Ralph Wiggum Archon workflow into a project.

Usage:
  bunx archon-ralph init [--force] [--dir <path>]

Commands:
  init            Copy the workflow, commands, control scripts and templates
                  into <dir>/.archon/. Existing files are skipped unless --force.

Options:
  --force, -f     Overwrite existing files instead of skipping them.
  --dir <path>    Target project root (default: current directory).
  --help, -h      Show this help.`;

function runInit(opts: Options): void {
  if (!existsSync(TEMPLATE_DIR)) {
    console.error(`archon-ralph: template directory missing at ${TEMPLATE_DIR}`);
    process.exit(1);
  }

  const dest = join(opts.dir, ARCHON_DIR);
  const files = listTemplateFiles(TEMPLATE_DIR);
  let created = 0;
  let skipped = 0;

  for (const rel of files) {
    const target = join(dest, rel);
    const existed = existsSync(target);
    if (existed && !opts.force) {
      console.log(`  skip   ${join(ARCHON_DIR, rel)} (exists)`);
      skipped += 1;
      continue;
    }
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(TEMPLATE_DIR, rel), target);
    console.log(`  ${existed ? "write " : "create"} ${join(ARCHON_DIR, rel)}`);
    created += 1;
  }

  console.log(
    `\narchon-ralph: ${created} file(s) written, ${skipped} skipped into ${dest}/`,
  );
  if (skipped > 0) console.log("Re-run with --force to overwrite skipped files.");
  console.log("\nRun the loop with:  archon workflow run ralph-wiggum -g \"<goal>\"");
}

const [command, ...rest] = process.argv.slice(2);

if (command === "--help" || command === "-h" || command === undefined) {
  console.log(HELP);
  process.exit(0);
}

if (command !== "init") {
  console.error(`archon-ralph: unknown command '${command}'. Run with --help.`);
  process.exit(1);
}

runInit(parseArgs(rest));
