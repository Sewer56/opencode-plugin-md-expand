import fs from "node:fs";
import path from "node:path";

import { defaultConfigDirs } from "../config-discovery";
import { createDebugLogger } from "../debug";
import { expand } from "../expand";
import { resolveMdExpandOptions } from "../options";
import { parseCommonArgs, resolveInputPath, type CliDefaults } from "./shared";

export async function runRenderCli(args: string[], defaults?: CliDefaults): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    printRenderHelp(defaults?.programName ?? "opencode-plugin-md-expand render");
    return args.length === 0 ? 1 : 0;
  }

  const parsed = parseCommonArgs(args, defaults);
  const { configDir, options: rawOptions, positional } = parsed;

  if (positional.length === 0) {
    console.error("render: no input file specified");
    return 1;
  }

  const inputPath = resolveInputPath(positional[0], configDir);
  const outputArg = positional[1];
  const resolved = resolveMdExpandOptions(rawOptions);
  const effectiveOptions = {
    ...resolved,
    configDirs: resolved.configDirs.length ? resolved.configDirs : defaultConfigDirs(configDir),
  };
  const logger = createDebugLogger(effectiveOptions);
  logger.log(
    `render: input=${inputPath} configDirs=${JSON.stringify(effectiveOptions.configDirs)}`,
  );

  let input: string;
  try {
    input = (await Bun.file(inputPath).text()).trim();
  } catch (err: unknown) {
    console.error(`render: cannot read input file: ${inputPath}`);
    console.error((err as Error).message);
    return 1;
  }

  const expanded = await expand(input, configDir, effectiveOptions);
  logger.log(`render: expanded ${input.length} → ${expanded.length} chars`);

  if (outputArg) {
    const outputPath = path.resolve(process.cwd(), outputArg);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, expanded);
    console.error(`Wrote ${expanded.split("\n").length} lines to ${outputPath}`);
  } else {
    process.stdout.write(expanded);
  }
  return 0;
}

export function printRenderHelp(program?: string): void {
  const p = program ?? "opencode-plugin-md-expand render";
  console.log(`${p}: Expand a template file

Usage:
  ${p} [options] <input-file> [output-file]

Options:
  --config-dir <path>   Config directory for relative includes (default: auto-discover)
  --max-depth <n>        Maximum recursive file include depth (default: 10)
  --debug                Write debug log
  --arg key=value        Initial arg for top-level expansion; repeatable
  --help, -h             Show this help

If output-file is omitted, result is written to stdout.
`);
}
