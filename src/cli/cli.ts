#!/usr/bin/env node
import { runRenderCli } from "./render"
import { runValidateCli } from "./validate"

async function main(): Promise<number> {
  const args = process.argv.slice(2)
  const command = args[0]

  if (command === "render" || command === "r") {
    return runRenderCli(args.slice(1))
  } else if (command === "validate" || command === "v") {
    return runValidateCli(args.slice(1))
  } else if (command === "--help" || command === "-h" || !command) {
    console.log(`opencode-plugin-md-expand: Expand Markdown prompt templates

Usage:
  opencode-plugin-md-expand render [options] [input-file]
  opencode-plugin-md-expand validate [options] [paths...]

Commands:
  render    Expand a template file and output the result
  validate  Scan template files and report diagnostics

Options:
  --config-dir <path>   Set config directory (overrides OPENCODE_CONFIG_DIR and cwd)
  --max-depth <n>       Maximum recursion depth (default: 10)
  --debug               Enable debug logging
  --arg key=value       Pass initial args for expansion
  --help, -h            Show this help

Use "render --help" or "validate --help" for command-specific options.
`)
    return 0
  } else {
    console.error(`Unknown command: ${command}`)
    console.error('Use --help for usage information.')
    return 1
  }
}

main().then(code => { process.exitCode = code }).catch(err => {
  console.error(err)
  process.exitCode = 1
})