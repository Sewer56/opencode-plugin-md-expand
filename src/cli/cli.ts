#!/usr/bin/env node
import path from "node:path";

import { Command } from "commander";

import { executeRender } from "./render";
import { executeValidate } from "./validate";

const program = new Command();

program
  .name("opencode-plugin-md-expand")
  .description("Expand Markdown prompt templates")
  .version("0.1.0")
  .addHelpText(
    "after",
    `\nCommands:
  render    Expand a template file and output the result
  validate  Scan template files and report diagnostics

Use "opencode-plugin-md-expand <command> --help" for command-specific options.`,
  );

program
  .command("render")
  .alias("r")
  .description("Expand a template file and output the result")
  .argument("<input-file>", "input template file")
  .argument("[output-file]", "output file (default: stdout)")
  .option("--config-dir <path>", "config directory", resolvePath)
  .option("--max-depth <n>", "maximum recursion depth", (v) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) {
      throw new Error("--max-depth must be a non-negative number");
    }
    return n;
  })
  .option("--debug", "enable debug logging")
  .option("--cache", "enable expansion caching")
  .option("--arg <key=value>", "initial args for expansion (repeatable)", collectArg, {})
  .action(async (inputFile, outputFile, opts) => {
    const exitCode = await executeRender(inputFile, outputFile, {
      configDir: opts.configDir,
      maxDepth: opts.maxDepth,
      debug: opts.debug,
      cache: opts.cache,
      arg: opts.arg,
    });
    process.exitCode = exitCode;
  });

program
  .command("validate")
  .alias("v")
  .description("Scan template files and report diagnostics")
  .argument("[paths...]", "paths to scan")
  .option("--config-dir <path>", "config directory", resolvePath)
  .option("--max-depth <n>", "maximum recursion depth", (v) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) {
      throw new Error("--max-depth must be a non-negative number");
    }
    return n;
  })
  .option("--debug", "enable debug logging")
  .option("--cache", "enable expansion caching")
  .option("--arg <key=value>", "initial args for expansion (repeatable)", collectArg, {})
  .action(async (paths, opts) => {
    const exitCode = await executeValidate(paths || [], {
      configDir: opts.configDir,
      maxDepth: opts.maxDepth,
      debug: opts.debug,
      cache: opts.cache,
      arg: opts.arg,
    });
    process.exitCode = exitCode;
  });

function collectArg(value: string, previous: Record<string, string>): Record<string, string> {
  const eq = value.indexOf("=");
  if (eq <= 0) throw new Error("--arg requires key=value");
  return { ...previous, [value.slice(0, eq)]: value.slice(eq + 1) };
}

function resolvePath(value: string): string {
  return path.resolve(value);
}

program.parse();
