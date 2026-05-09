import { describe, test, expect } from "bun:test";
import path from "node:path";

import { makeTmpDir, cleanup } from "../test-helpers";
import { executeRender } from "./render";

describe("executeRender", () => {
  test("renders simple template to stdout", async () => {
    const dir = await makeTmpDir({
      "input.md": "Hello {{arg:name}}!",
    });
    cleanup.push(dir);

    let output = "";
    const origStdoutWrite = process.stdout.write;
    const origStdoutEnd = process.stdout.end;
    process.stdout.write = (chunk: string | Buffer) => {
      output += typeof chunk === "string" ? chunk : chunk.toString();
      return true;
    };
    process.stdout.end = (() => process.stdout) as typeof process.stdout.end;

    const exitCode = await executeRender("input.md", undefined, {
      configDir: dir,
      arg: { name: "World" },
    });

    process.stdout.write = origStdoutWrite;
    process.stdout.end = origStdoutEnd;

    expect(exitCode).toBe(0);
    expect(output).toBe("Hello World!");
  });

  test("writes to output file", async () => {
    const dir = await makeTmpDir({
      "input.md": "Test content",
    });
    cleanup.push(dir);

    const outputPath = path.join(dir, "output.txt");
    const exitCode = await executeRender("input.md", outputPath, { configDir: dir });

    expect(exitCode).toBe(0);
    const written = await Bun.file(outputPath).text();
    expect(written).toBe("Test content");
  });

  test("returns 1 on missing input file", async () => {
    const dir = await makeTmpDir({});
    cleanup.push(dir);

    const exitCode = await executeRender("nonexistent.md", undefined, { configDir: dir });
    expect(exitCode).toBe(1);
  });
});
