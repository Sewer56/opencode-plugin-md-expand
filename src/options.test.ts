import { describe, test, expect } from "bun:test";
import path from "node:path";

import { resolveMdExpandOptions } from "./options";
import { withEnv } from "./test-helpers";
import { MAX_DEPTH } from "./token-syntax";

describe("resolveMdExpandOptions", () => {
  test("returns defaults", () => {
    const o = resolveMdExpandOptions();
    expect(o.maxDepth).toBe(MAX_DEPTH);
    expect(o.debug).toBe(false);
    expect(o.configDirs).toEqual([]);
    expect(o.extraConfigDirs).toEqual([]);
    expect(o.cache).toBe(false);
    expect(o.initialArgs).toBeInstanceOf(Map);
  });

  test("merges custom options", () => {
    const o = resolveMdExpandOptions({
      maxDepth: 3,
      debug: true,
      cache: true,
      configDirs: ["/foo"],
      initialArgs: { x: "1" },
    });
    expect(o.maxDepth).toBe(3);
    expect(o.debug).toBe(true);
    expect(o.cache).toBe(true);
    expect(o.configDirs).toEqual([path.resolve("/foo")]);
    expect(o.initialArgs.get("x")).toBe("1");
  });

  test("enables debug via env var", () => {
    const restore = withEnv("OPENCODE_PLUGIN_MD_EXPAND_DEBUG", "1");
    try {
      expect(resolveMdExpandOptions().debug).toBe(true);
    } finally {
      restore();
    }
  });

  test("enables cache via env var", () => {
    const restore = withEnv("OPENCODE_PLUGIN_MD_EXPAND_CACHE", "1");
    try {
      expect(resolveMdExpandOptions().cache).toBe(true);
    } finally {
      restore();
    }
  });

  describe("extraConfigDirs", () => {
    test("defaults to empty array", () => {
      const o = resolveMdExpandOptions();
      expect(o.extraConfigDirs).toEqual([]);
    });

    test("resolves extraConfigDirs to absolute paths", () => {
      const o = resolveMdExpandOptions({
        extraConfigDirs: ["./extra", "/abs/path"],
      });
      expect(o.extraConfigDirs).toEqual([path.resolve("./extra"), path.resolve("/abs/path")]);
    });

    test("extraConfigDirs does not affect configDirs", () => {
      const o = resolveMdExpandOptions({
        extraConfigDirs: ["/extra"],
      });
      // configDirs stays empty - extraConfigDirs is additive, not a replacement
      expect(o.configDirs).toEqual([]);
      expect(o.extraConfigDirs).toEqual([path.resolve("/extra")]);
    });

    test("configDirs and extraConfigDirs can coexist in resolved options", () => {
      const o = resolveMdExpandOptions({
        configDirs: ["/override"],
        extraConfigDirs: ["/extra"],
      });
      expect(o.configDirs).toEqual([path.resolve("/override")]);
      expect(o.extraConfigDirs).toEqual([path.resolve("/extra")]);
      // The merge logic in index.ts handles precedence (configDirs wins as override).
    });

    test("empty extraConfigDirs array yields empty resolved array", () => {
      const o = resolveMdExpandOptions({
        extraConfigDirs: [],
      });
      expect(o.extraConfigDirs).toEqual([]);
    });
  });
});
