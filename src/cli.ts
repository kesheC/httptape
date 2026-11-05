#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";
import { validateTape } from "./tape.js";
import { TAPE_FORMAT_VERSION } from "./types.js";
import { installPipeGuard } from "./pipe.js";

export const VERSION = "0.1.2";

/** Process-entry main. Returns exit code: 0 ok, 1 usage or tape error. */
export function main(argv: readonly string[], stdout: NodeJS.WritableStream, stderr: NodeJS.WritableStream): number {
  const args = [...argv];
  if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
    stdout.write(help());
    return 0;
  }
  if (args[0] === "-V" || args[0] === "--version") {
    stdout.write("httptape " + VERSION + "\n");
    return 0;
  }
  const command = args[0];
  const rest = args.slice(1);
  if (command === "inspect") {
    return inspect(rest, stdout, stderr);
  }
  stderr.write("unknown command: " + command + " (see --help)\n");
  return 1;
}

function inspect(args: readonly string[], stdout: NodeJS.WritableStream, stderr: NodeJS.WritableStream): number {
  let json = false;
  const paths: string[] = [];
  for (const arg of args) {
    if (arg === "--json") {
      json = true;
    } else if (arg.startsWith("-")) {
      stderr.write("unknown flag: " + arg + "\n");
      return 1;
    } else {
      paths.push(arg);
    }
  }
  if (paths.length === 0) {
    stderr.write("inspect: provide at least one tape file\n");
    return 1;
  }
  let failed = false;
  const reports: unknown[] = [];
  for (const path of paths) {
    try {
      const tape = loadTapeSync(path);
      reports.push({ path, ok: true, name: tape.name, interactions: tape.interactions.length, formatVersion: TAPE_FORMAT_VERSION });
    } catch (error) {
      failed = true;
      reports.push({ path, ok: false, error: (error as Error).message });
    }
  }
  if (json) {
    stdout.write(JSON.stringify(reports, null, 2) + "\n");
  } else {
    for (const report of reports) {
      const r = report as { ok?: boolean; path?: string; interactions?: number; formatVersion?: number; name?: string; error?: string };
      if (r.ok) {
        stdout.write(r.path + ": " + r.interactions + " interactions, format v" + r.formatVersion + " (" + r.name + ")\n");
      } else {
        stderr.write(r.path + ": INVALID - " + r.error + "\n");
      }
    }
  }
  return failed ? 1 : 0;
}

function help(): string {
  const lines = [
    "httptape - record and replay HTTP interactions as JSON tapes",
    "",
    "Usage:",
    "  httptape inspect [--json] <tape.json>...   validate tapes and count interactions",
    "  httptape --help | --version",
    "",
    "Library use: import { record, replay } from the npm package in your test code.",
    "",
    "Modes:",
    "  strict  unmatched request throws NoMatchError (default)",
    "  stub    unmatched request gets a deterministic 599, no network",
    "  record  unmatched request performs the real exchange and appends it",
    "",
    "Exit codes: 0 ok, 1 usage or invalid tape.",
  ];
  return lines.join("\n") + "\n";
}

function loadTapeSync(path: string) {
  const raw = readFileSync(path, "utf8");
  return validateTape(JSON.parse(raw));
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  installPipeGuard();
  // exitCode (not process.exit): lets every path settle before the loop drains.
  process.exitCode = main(process.argv.slice(2), process.stdout, process.stderr);
}