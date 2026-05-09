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
    expect(o.initialArgs).toBeInstanceOf(Map);
  });

  test("merges custom options", () => {
    const o = resolveMdExpandOptions({
      maxDepth: 3,
      debug: true,
      configDirs: ["/foo"],
      initialArgs: { x: "1" },
    });
    expect(o.maxDepth).toBe(3);
    expect(o.debug).toBe(true);
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
});
