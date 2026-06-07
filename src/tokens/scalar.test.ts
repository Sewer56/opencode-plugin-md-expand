import { describe, test, expect, beforeEach } from "bun:test";
import os from "node:os";
import path from "node:path";

import { clearGitRootCache } from "../git-discovery";
import { opts, withEnv } from "../test-helpers";
import { expandScalarTokens } from "./scalar";

const BASE = "/project";

describe("expandScalarTokens: {{path:...}}", () => {
  const pathCases = [
    {
      name: "dot-slash relative",
      input: "./file.txt",
      expected: () => path.resolve(BASE, "./file.txt"),
    },
    {
      name: "parent-dir relative",
      input: "../sibling/file.txt",
      expected: () => path.resolve(BASE, "../sibling/file.txt"),
    },
    {
      name: "home-dir tilde",
      input: "~/file.txt",
      expected: () => path.join(os.homedir(), "file.txt"),
    },
    { name: "bare name", input: "README.md", expected: () => path.resolve(BASE, "README.md") },
  ] as const;

  for (const { name, input, expected } of pathCases) {
    test(`resolves ${name} path relative to baseDir`, () => {
      const result = expandScalarTokens(`path={{path:${input}}}`, new Map(), opts(), BASE);
      expect(result.text).toBe(`path=${expected()}`);
    });
  }

  test("passes through absolute paths unchanged", () => {
    const abs = "/usr/local/bin/tool";
    const result = expandScalarTokens(`path={{path:${abs}}}`, new Map(), opts(), BASE);
    expect(result.text).toBe(`path=${abs}`);
  });

  test("sets hasPathTemplate flag when path token present", () => {
    const result = expandScalarTokens("{{path:./a.txt}}", new Map(), opts(), BASE);
    expect(result.hasPathTemplate).toBe(true);
  });

  test("does not set hasPathTemplate when no path tokens", () => {
    const result = expandScalarTokens("plain text", new Map(), opts(), BASE);
    expect(result.hasPathTemplate).toBe(false);
  });

  test("skips empty {{path:}} tokens", () => {
    const result = expandScalarTokens("before{{path:}}after", new Map(), opts(), BASE);
    expect(result.text).toBe("before{{path:}}after");
  });
});

describe("expandScalarTokens: {{gitpath:...}}", () => {
  beforeEach(() => {
    clearGitRootCache();
  });

  test("resolves relative to git root when inside a repo", () => {
    // In a real git repo (the test runner's cwd), gitpath should resolve
    // relative to the git root. Use process.cwd() as the baseDir so
    // findGitRoot can discover the actual repository root.
    const gitRoot = require("child_process")
      .execSync("git rev-parse --show-toplevel", { encoding: "utf-8" })
      .trim();
    const result = expandScalarTokens("{{gitpath:src/main.ts}}", new Map(), opts(), process.cwd());
    expect(result.text).toBe(path.resolve(gitRoot, "src/main.ts"));
  });

  test("falls back to baseDir when not in a git repo", () => {
    // Use /tmp (unlikely to be a git repo root) as baseDir
    // Clear cache first so stale entries don't interfere
    clearGitRootCache();
    const tmpBase = "/tmp/nonexistent-git-test-" + Date.now();
    const result = expandScalarTokens("{{gitpath:src/main.ts}}", new Map(), opts(), tmpBase);
    // Fallback: resolve relative to tmpBase since /tmp/... is not a git repo
    expect(result.text).toBe(path.resolve(tmpBase, "src/main.ts"));
  });

  test("sets hasPathTemplate flag when gitpath token present", () => {
    clearGitRootCache();
    const result = expandScalarTokens("{{gitpath:src/main.ts}}", new Map(), opts(), BASE);
    expect(result.hasPathTemplate).toBe(true);
  });
});

describe("expandScalarTokens: path + arg/env interaction", () => {
  test("path token in arg value stays literal for expand re-scan", () => {
    const args = new Map([["script", "{{path:./run.sh}}"]]);
    const result = expandScalarTokens("cmd={{arg:script}}", args, opts(), BASE);
    // Arg values containing {{...}} delimiters are protected from re-expansion;
    // the expand() pipeline re-scans to resolve tokens introduced by args.
    expect(result.text).toBe("cmd={{path:./run.sh}}");
    expect(result.hasPathTemplate).toBe(false);
  });

  test("path tokens expand alongside arg tokens", () => {
    const args = new Map([["name", "World"]]);
    const result = expandScalarTokens(
      "hello={{arg:name}} path={{path:./run.sh}}",
      args,
      opts(),
      BASE,
    );
    expect(result.text).toBe(`hello=World path=${path.resolve(BASE, "./run.sh")}`);
  });

  test("arg expansion does not interfere with path token offsets", () => {
    const args = new Map([["dir", "subdir"]]);
    const result = expandScalarTokens(
      "dir={{arg:dir}} and {{path:./file.txt}}",
      args,
      opts(),
      BASE,
    );
    expect(result.text).toContain(path.resolve(BASE, "./file.txt"));
  });

  test("protected ranges remap correctly when path token precedes env token", () => {
    // Path token comes before env token in source text. The combined
    // replacements list (env replacements + path replacements) must be
    // sorted by start offset so remapRanges computes correct deltas
    // for protected ranges and file-arg ranges.
    const restore = withEnv("MD_EXPAND_TEST", "ok");
    try {
      const args = new Map([["arg1", "{{nested}}"]]);
      const result = expandScalarTokens(
        "p={{path:./a.txt}} a={{arg:arg1}} e={{env:MD_EXPAND_TEST}}",
        args,
        opts(),
        BASE,
      );
      // Path resolves, env expands, arg expands with protected range
      expect(result.text).toContain(path.resolve(BASE, "./a.txt"));
      expect(result.text).toContain("{{nested}}");
      expect(result.text).toContain("ok");
      // One protected range for the nested {{...}} in the arg value
      expect(result.protectedRanges.length).toBe(1);
      // The protected range should cover "{{nested}}" in the final output.
      // Compute its expected start offset:
      const prefix = `p=${path.resolve(BASE, "./a.txt")} a=`;
      expect(result.protectedRanges[0].start).toBe(prefix.length);
      expect(result.protectedRanges[0].end).toBe(prefix.length + "{{nested}}".length);
    } finally {
      restore();
    }
  });

  test("path tokens inside file-template arg values stay literal", () => {
    // {{path:...}} inside {{ file="..." x={{path:...}} }} should be protected
    // This is covered by the file-arg-range mechanism; ensure hasPathTemplate
    // is still true even when the token is inside a file arg.
    const result = expandScalarTokens(
      '{{ file="./tmpl.md" x="{{path:./inner.sh}}" }}',
      new Map(),
      opts(),
      BASE,
    );
    // The path token inside the file arg should NOT be expanded;
    // it remains literal for the imported template.
    expect(result.text).not.toContain(path.resolve(BASE, "./inner.sh"));
    expect(result.hasPathTemplate).toBe(true);
  });
});
