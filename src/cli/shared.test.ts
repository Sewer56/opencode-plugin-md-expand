import { describe, test, expect } from "bun:test";
import path from "node:path";

import { parseCommonArgs, lineColumn, resolveInputPath } from "./shared";

describe("parseCommonArgs", () => {
  test("parses positional args", () => {
    const result = parseCommonArgs(["input.md", "output.txt"]);
    expect(result.positional).toEqual(["input.md", "output.txt"]);
    expect(result.options.maxDepth).toBeUndefined();
    expect(result.options.debug).toBe(false);
  });

  test("parses --config-dir", () => {
    const result = parseCommonArgs(["--config-dir", "/custom", "input.md"]);
    expect(result.configDir).toBe(path.resolve("/custom"));
    expect(result.positional).toEqual(["input.md"]);
  });

  test("parses --max-depth", () => {
    const result = parseCommonArgs(["--max-depth", "5", "input.md"]);
    expect(result.options.maxDepth).toBe(5);
  });

  test("throws on invalid --max-depth", () => {
    expect(() => parseCommonArgs(["--max-depth", "-1"])).toThrow(
      "--max-depth must be a non-negative number",
    );
    expect(() => parseCommonArgs(["--max-depth", "abc"])).toThrow(
      "--max-depth must be a non-negative number",
    );
  });

  test("parses --debug flag", () => {
    const result = parseCommonArgs(["--debug", "input.md"]);
    expect(result.options.debug).toBe(true);
  });

  test("parses single --arg key=value", () => {
    const result = parseCommonArgs(["--arg", "key=value", "input.md"]);
    const args = result.options.initialArgs;
    expect(args instanceof Map ? args.get("key") : args?.["key"]).toBe("value");
  });

  test("parses multiple --arg key=value", () => {
    const result = parseCommonArgs(["--arg", "a=1", "--arg", "b=2", "input.md"]);
    const args = result.options.initialArgs;
    expect(args instanceof Map ? args.get("a") : args?.["a"]).toBe("1");
    expect(args instanceof Map ? args.get("b") : args?.["b"]).toBe("2");
  });

  test("throws on malformed --arg", () => {
    expect(() => parseCommonArgs(["--arg", "noequals"])).toThrow("--arg requires key=value");
    expect(() => parseCommonArgs(["--arg", "=value"])).toThrow("--arg requires key=value");
  });

  test("stops option parsing at --", () => {
    const result = parseCommonArgs(["--debug", "--", "--config-dir", "file.md"]);
    expect(result.options.debug).toBe(true);
    expect(result.positional).toEqual(["--config-dir", "file.md"]);
  });

  test("uses default configDir from defaults", () => {
    const result = parseCommonArgs(["input.md"], { defaultConfigDir: "/default" });
    expect(result.configDir).toBe(path.resolve("/default"));
  });

  test("uses OPENCODE_CONFIG_DIR env var", () => {
    const orig = process.env.OPENCODE_CONFIG_DIR;
    process.env.OPENCODE_CONFIG_DIR = "/from-env";
    try {
      const result = parseCommonArgs(["input.md"]);
      expect(result.configDir).toBe(path.resolve("/from-env"));
    } finally {
      if (orig) process.env.OPENCODE_CONFIG_DIR = orig;
      else delete process.env.OPENCODE_CONFIG_DIR;
    }
  });
});

describe("lineColumn", () => {
  test("returns line 1 column 1 for start", () => {
    expect(lineColumn("hello world", 0)).toEqual({ line: 1, column: 1 });
  });

  test("counts lines correctly", () => {
    const text = "line1\nline2\nline3";
    expect(lineColumn(text, 0)).toEqual({ line: 1, column: 1 });
    expect(lineColumn(text, 6)).toEqual({ line: 2, column: 1 });
    expect(lineColumn(text, 12)).toEqual({ line: 3, column: 1 });
  });

  test("handles CRLF line endings", () => {
    const text = "line1\r\nline2";
    expect(lineColumn(text, 0)).toEqual({ line: 1, column: 1 });
    expect(lineColumn(text, 7)).toEqual({ line: 2, column: 1 });
  });

  test("counts columns correctly", () => {
    expect(lineColumn("hello", 3)).toEqual({ line: 1, column: 4 });
  });
});

describe("resolveInputPath", () => {
  test("returns absolute paths unchanged", () => {
    expect(resolveInputPath("/absolute/path.md", "/config")).toBe("/absolute/path.md");
  });

  test("resolves relative paths against configDir", () => {
    const result = resolveInputPath("relative.md", "/config");
    expect(result).toBe(path.resolve("/config", "relative.md"));
  });
});
