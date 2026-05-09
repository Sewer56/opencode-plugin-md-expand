/**
 * @module transform.bench - Benchmark suite for MdExpandPlugin's system-prompt transform.
 *
 * Measures the latency of `experimental.chat.system.transform` across fixture
 * files that exercise simple imports, deep/complex nested expansions, and
 * static pass-through (no-op) cases. Run with `bun run bench`.
 */

import path from "node:path";

import { Bench, type Task } from "tinybench";

import { MdExpandPlugin } from "../src/index";

const FIXTURE_ROOT = path.join(import.meta.dir, "fixtures", "opencode-config");
const DEFAULT_TIME_MS = 1_000;
const DEFAULT_ITERATIONS = 128;
const DEFAULT_WARMUP_TIME_MS = 250;
const DEFAULT_WARMUP_ITERATIONS = 16;

/** Describes a single benchmark scenario: a named fixture file and what it exercises. */
interface BenchmarkCase {
  /** Short machine-readable identifier used as the benchmark task key. */
  name: string;
  /** Path relative to FIXTURE_ROOT pointing to the fixture file. */
  relativePath: string;
  /** Human-readable summary of what the case exercises. */
  description: string;
}

/** Statistical summary produced for each benchmark case after the run completes. */
interface BenchmarkResult {
  /** Machine-readable case identifier. */
  name: string;
  /** Human-readable summary of what the case exercises. */
  description: string;
  /** Size of the fixture input in bytes. */
  inputBytes: number;
  /** Size of the expanded output in bytes. */
  outputBytes: number;
  /** Number of latency samples collected by tinybench. */
  samples: number;
  /** Minimum latency in milliseconds. */
  min: number;
  /** 50th-percentile (median) latency in milliseconds. */
  p50: number;
  /** Arithmetic mean latency in milliseconds. */
  mean: number;
  /** 95th-percentile latency in milliseconds. */
  p95: number;
  /** 99th-percentile latency in milliseconds. */
  p99: number;
  /** Maximum latency in milliseconds. */
  max: number;
}

/** Extracted type of the plugin's `experimental.chat.system.transform` hook function. */
type TransformHook = NonNullable<
  Awaited<ReturnType<typeof MdExpandPlugin>>["experimental.chat.system.transform"]
>;

/** Fixture-based scenarios that exercise different expansion workloads. */
const BENCHMARK_CASES: BenchmarkCase[] = [
  {
    name: "simple-import",
    relativePath: "rules/groups/correctness/target-step-audit.md",
    description: "2 direct rule-card imports",
  },
  {
    name: "deep-complex-import",
    relativePath: "agent/_plan/draft-reviewers/docs-and-wording.md",
    description: "nested rule/template imports with args and conditionals",
  },
  {
    name: "static-large",
    relativePath: "doc/workflow/design-patterns.md",
    description: "large no-op markdown with no substitutions",
  },
  {
    name: "static-small",
    relativePath: "rules/README.md",
    description: "small no-op markdown with no substitutions",
  },
];

const time = readPositiveIntegerEnv("MD_EXPAND_BENCH_TIME_MS", DEFAULT_TIME_MS);
const iterations = readPositiveIntegerEnv("MD_EXPAND_BENCH_MIN_ITERATIONS", DEFAULT_ITERATIONS);
const warmupTime = readPositiveIntegerEnv("MD_EXPAND_BENCH_WARMUP_TIME_MS", DEFAULT_WARMUP_TIME_MS);
const warmupIterations = readPositiveIntegerEnv(
  "MD_EXPAND_BENCH_WARMUP_ITERATIONS",
  DEFAULT_WARMUP_ITERATIONS,
);

const transform = await createTransformHook();
const bench = new Bench({
  iterations,
  retainSamples: true,
  throws: true,
  time,
  warmupIterations,
  warmupTime,
});
const caseMetadata = new Map<
  string,
  Omit<BenchmarkResult, "samples" | "min" | "p50" | "mean" | "p95" | "p99" | "max">
>();

for (const benchmarkCase of BENCHMARK_CASES) {
  const source = await Bun.file(path.join(FIXTURE_ROOT, benchmarkCase.relativePath)).text();
  const firstOutput = await transformMessage(transform, source);

  caseMetadata.set(benchmarkCase.name, {
    name: benchmarkCase.name,
    description: benchmarkCase.description,
    inputBytes: Buffer.byteLength(source),
    outputBytes: Buffer.byteLength(firstOutput),
  });

  bench.add(
    benchmarkCase.name,
    async () => {
      await transformMessage(transform, source);
    },
    { async: true },
  );
}

await bench.run();

printResults(summarizeTasks(bench.tasks, caseMetadata), {
  iterations,
  time,
  warmupIterations,
  warmupTime,
});

/**
 * Initialise the MdExpandPlugin and extract its `experimental.chat.system.transform` hook.
 *
 * @throws {Error} If the plugin does not register a system transform hook.
 */
async function createTransformHook(): Promise<TransformHook> {
  const hooks = await MdExpandPlugin(
    {
      directory: FIXTURE_ROOT,
    } as Parameters<typeof MdExpandPlugin>[0],
    {
      configDirs: [FIXTURE_ROOT],
      debug: false,
      maxDepth: 10,
    },
  );
  const transform = hooks["experimental.chat.system.transform"];
  if (!transform) throw new Error("MdExpandPlugin did not register a system transform hook");
  return transform;
}

/**
 * Apply the transform hook to a single markdown string.
 *
 * Wraps `source` in the `{ system: [source] }` shape expected by the
 * hook's callback contract, then returns the first (and only) system entry.
 *
 * @throws {Error} Re-throws any error thrown by the TransformHook.
 */
async function transformMessage(transform: TransformHook, source: string): Promise<string> {
  const output = { system: [source] };
  await transform({} as Parameters<TransformHook>[0], output);
  // Defensive fallback: the hook contract guarantees system[0] remains non-empty,
  // but return "" rather than undefined if that invariant is violated.
  return output.system[0] ?? "";
}

/**
 * Read an environment variable and parse it as a positive integer.
 *
 * @param name - Environment variable name.
 * @param fallback - Default value when the variable is unset.
 *
 * @throws {Error} If the variable is set but is not a positive integer.
 */
function readPositiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, received ${JSON.stringify(raw)}`);
  }
  return parsed;
}

/**
 * Merge tinybench task results with per-case metadata into a sorted result list.
 *
 * @throws {Error} If a task name has no matching metadata entry.
 * @throws {Error} If a task did not complete (no latency data).
 */
function summarizeTasks(
  tasks: Task[],
  caseMetadata: Map<
    string,
    Omit<BenchmarkResult, "samples" | "min" | "p50" | "mean" | "p95" | "p99" | "max">
  >,
): BenchmarkResult[] {
  return tasks.map((task) => {
    const metadata = caseMetadata.get(task.name);
    if (!metadata) throw new Error(`Missing metadata for benchmark task: ${task.name}`);

    const result = task.result;
    if (!("latency" in result)) {
      throw new Error(`Benchmark task ${task.name} did not complete: ${result.state}`);
    }

    return {
      ...metadata,
      samples: result.latency.samplesCount,
      min: result.latency.min,
      p50: percentile(result.latency.samples, 0.5),
      mean: result.latency.mean,
      p95: percentile(result.latency.samples, 0.95),
      p99: percentile(result.latency.samples, 0.99),
      max: result.latency.max,
    };
  });
}

/**
 * Compute the value at the given percentile rank from an array of latency samples.
 *
 * Uses nearest-rank interpolation: picks the sample at
 * `floor(rank * (n-1))`, clamped to valid indices.
 *
 * @param samples - Collected latency values (may be unsorted).
 * @param percentileRank - Rank between 0 and 1 (e.g. 0.95 for p95).
 * @returns The percentile value, or 0 when samples is empty/undefined.
 */
function percentile(samples: readonly number[] | undefined, percentileRank: number): number {
  if (!samples || samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  // Nearest-rank: index into sorted array, clamped to [0, length-1]
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor(percentileRank * (sorted.length - 1))),
  );
  return sorted[index] ?? 0;
}

/**
 * Print a formatted benchmark results table and case descriptions to stdout.
 *
 * @param results - Per-case benchmark statistics to display.
 * @param config - Benchmark timing configuration printed in the header.
 *   - `iterations`: minimum loop iterations per task.
 *   - `time`: measurement window in milliseconds per task.
 *   - `warmupIterations`: iterations run before the timed window.
 *   - `warmupTime`: warmup duration in milliseconds.
 */
function printResults(
  results: BenchmarkResult[],
  config: { iterations: number; time: number; warmupIterations: number; warmupTime: number },
): void {
  console.log("opencode-plugin-md-expand transform benchmark");
  console.log(`fixtureRoot: ${FIXTURE_ROOT}`);
  console.log(`time: ${config.time} ms`);
  console.log(`minIterations: ${config.iterations}`);
  console.log(`warmupTime: ${config.warmupTime} ms`);
  console.log(`warmupIterations: ${config.warmupIterations}`);
  console.log("");

  const rows = results.map((result) => ({
    case: result.name,
    in: String(result.inputBytes),
    out: String(result.outputBytes),
    n: String(result.samples),
    min: formatMicroseconds(result.min),
    p50: formatMicroseconds(result.p50),
    mean: formatMicroseconds(result.mean),
    p95: formatMicroseconds(result.p95),
    p99: formatMicroseconds(result.p99),
    max: formatMicroseconds(result.max),
  }));

  const headers = {
    case: "case",
    in: "in bytes",
    out: "out bytes",
    n: "samples",
    min: "min µs",
    p50: "p50 µs",
    mean: "mean µs",
    p95: "p95 µs",
    p99: "p99 µs",
    max: "max µs",
  };
  const columns = Object.keys(headers) as Array<keyof typeof headers>;
  const widths = Object.fromEntries(
    columns.map((column) => [
      column,
      Math.max(headers[column].length, ...rows.map((row) => row[column].length)),
    ]),
  ) as Record<keyof typeof headers, number>;

  console.log(formatRow(headers, columns, widths));
  console.log(columns.map((column) => "-".repeat(widths[column])).join("  "));
  for (const row of rows) console.log(formatRow(row, columns, widths));

  console.log("");
  console.log("cases:");
  for (const result of results) console.log(`- ${result.name}: ${result.description}`);
}

function formatRow(
  row: Record<string, string>,
  columns: string[],
  widths: Record<string, number>,
): string {
  return columns.map((column) => row[column].padEnd(widths[column])).join("  ");
}

function formatMicroseconds(valueMs: number): string {
  return (valueMs * 1_000).toFixed(3);
}
