import fs from "node:fs";
import path from "node:path";

import { defaultConfigDirs } from "../config-discovery";
import { createDebugLogger } from "../debug";
import { expand } from "../expand";
import { resolveMdExpandOptions, type MdExpandOptions } from "../options";

export interface RenderOptions {
  inputFile: string;
  outputFile?: string;
  configDir?: string;
  maxDepth?: number;
  debug?: boolean;
  cache?: boolean;
  arg?: Record<string, string>;
}

function resolveInputPath(input: string, configDir: string): string {
  if (path.isAbsolute(input)) return input;
  return path.resolve(configDir, input);
}

export async function executeRender(
  inputFile: string,
  outputFile: string | undefined,
  options: Omit<RenderOptions, "inputFile" | "outputFile">,
): Promise<number> {
  const configDir = options.configDir ?? process.cwd();
  const inputPath = resolveInputPath(inputFile, configDir);

  const mdOptions: MdExpandOptions = {
    configDirs: options.configDir ? [options.configDir] : [],
    maxDepth: options.maxDepth,
    debug: options.debug,
    cache: options.cache,
    initialArgs: options.arg,
  };
  const resolved = resolveMdExpandOptions(mdOptions);
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

  if (outputFile) {
    const outputPath = path.resolve(process.cwd(), outputFile);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, expanded);
    console.error(`Wrote ${expanded.split("\n").length} lines to ${outputPath}`);
  } else {
    process.stdout.write(expanded);
  }
  return 0;
}
