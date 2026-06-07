import { describe, test, expect, beforeEach } from "bun:test";
import os from "node:os";
import path from "node:path";

import { expand, expandWithDiagnostics } from "./expand";
import { clearGitRootCache } from "./git-discovery";
import { makeTmpDir, withEnv, opts, cleanup } from "./test-helpers";

describe("expand: mixed {{env:...}} and file templates", () => {
  test("env tokens and file templates both expand in same string", async () => {
    const dir = await makeTmpDir({ "name.txt": "Alice" });
    cleanup.push(dir);
    const restore = withEnv("MD_EXPAND_TEST_REGION", "us-west");
    try {
      const result = await expand(
        `name={{ file="./name.txt" }} region={{env:MD_EXPAND_TEST_REGION}}`,
        dir,
        opts(),
      );
      expect(result).toBe("name=Alice region=us-west");
    } finally {
      restore();
    }
  });

  test("env values may inject file templates (env expands before file)", async () => {
    const dir = await makeTmpDir({ "from-env.txt": "ENV_TO_FILE_MARKER" });
    cleanup.push(dir);
    const restore = withEnv("MD_EXPAND_TEST_FILE_TOKEN", `{{ file="./from-env.txt" }}`);
    try {
      const result = await expand(`value={{env:MD_EXPAND_TEST_FILE_TOKEN}}`, dir, opts());
      expect(result).toBe("value=ENV_TO_FILE_MARKER");
    } finally {
      restore();
    }
  });
});

describe("expand: no tokens", () => {
  test("returns text unchanged when no tokens present", async () => {
    const result = await expand("plain text with no tokens", "/tmp", opts());
    expect(result).toBe("plain text with no tokens");
  });

  test("returns text unchanged when only plain variable references", async () => {
    const result = await expand("path=GENERAL_RULES_PATH home=$HOME", "/tmp", opts());
    expect(result).toBe("path=GENERAL_RULES_PATH home=$HOME");
  });

  test("leaves empty env token form unchanged", async () => {
    const result = await expand(`empty {{env:}}`, "/tmp", opts());
    expect(result).toBe(`empty {{env:}}`);
  });

  test("blanks empty file template path", async () => {
    const result = await expand(`empty {{ file="" }}`, "/tmp", opts());
    expect(result).toBe("empty ");
  });

  test("leaves unclosed token forms unchanged", async () => {
    const result = await expand(`broken {{env:FOO and {{ file="./x.txt"`, "/tmp", opts());
    expect(result).toBe(`broken {{env:FOO and {{ file="./x.txt"`);
  });

  test("unclosed env does not block later arg expansion", async () => {
    const result = await expand(
      "broken {{env:FOO and {{arg:name}}",
      "/tmp",
      opts({ initialArgs: { name: "ARG_OK" } }),
    );
    expect(result).toBe("broken {{env:FOO and ARG_OK");
  });
});

describe("expand: repeated-call safety", () => {
  test("calling expand twice on same strings works (no stale lastIndex)", async () => {
    const dir = await makeTmpDir({ "x.txt": "X" });
    cleanup.push(dir);
    const text = `value={{ file="./x.txt" }}`;

    const result1 = await expand(text, dir, opts());
    const result2 = await expand(text, dir, opts());
    expect(result1).toBe("value=X");
    expect(result2).toBe("value=X");
  });
});

describe("expandWithDiagnostics", () => {
  test("reports missing files while rendering empty", async () => {
    const dir = await makeTmpDir({});
    cleanup.push(dir);
    const result = await expandWithDiagnostics(`{{ file="./missing.txt" }}`, dir, opts());
    expect(result.text).toBe("");
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].kind).toBe("missing-file");
    expect(result.diagnostics[0].rawPath).toBe("./missing.txt");
  });

  test("reports empty file template paths", async () => {
    const result = await expandWithDiagnostics(`{{ file="" }}`, "/tmp", opts());
    expect(result.text).toBe("");
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].kind).toBe("empty-file");
  });

  test("detects cycles", async () => {
    const dir = await makeTmpDir({
      "cycle-a.md": `A: {{ file="./cycle-b.md" }}`,
      "cycle-b.md": `B: {{ file="./cycle-a.md" }}`,
    });
    cleanup.push(dir);
    const { diagnostics } = await expandWithDiagnostics(`{{ file="./cycle-a.md" }}`, dir, opts());
    expect(diagnostics.some((d) => d.kind === "cycle")).toBe(true);
  });
});

describe("expand: depth limit", () => {
  test("leaves file templates literal at maxDepth=0", async () => {
    const dir = await makeTmpDir({
      "greeting.md": "Hello {{arg:name}}!",
      "double.md": `Top\n{{ file="./.opencode/greeting.md" name=World }}\nBottom`,
    });
    cleanup.push(dir);
    const result = await expand('{{ file="./double.md" }}', dir, opts({ maxDepth: 0 }));
    expect(result.includes("{{ file=")).toBe(true);
  });
});

describe("line cleanup", () => {
  test("removes marker-only lines", async () => {
    const result = await expand("Line before\n{{arg:missing}}\nLine after", "/tmp", opts());
    const lines = result.split("\n");
    expect(lines.length).toBe(2);
    expect(lines[0]).toBe("Line before");
    expect(lines[1]).toBe("Line after");
  });
});

describe("expand: {{path:...}} tokens", () => {
  test("resolves {{path:./file.txt}} relative to baseDir", async () => {
    const dir = await makeTmpDir({ "placeholder.txt": "content" });
    cleanup.push(dir);
    const result = await expand("run={{path:./verify.sh}}", dir, opts());
    expect(result).toBe(`run=${path.resolve(dir, "./verify.sh")}`);
  });

  test("resolves {{path:~/file.txt}} to $HOME", async () => {
    const result = await expand("home={{path:~/file.txt}}", "/tmp", opts());
    expect(result).toBe(`home=${path.join(os.homedir(), "file.txt")}`);
  });

  test("arg value introducing {{path:...}} stays literal in single expand pass", async () => {
    // Arg values containing {{...}} delimiters are protected from re-expansion
    // within a single expand() call. The caller re-scans on the next call.
    const dir = await makeTmpDir({});
    cleanup.push(dir);
    const result = await expand(
      "script={{arg:script}}",
      dir,
      opts({ initialArgs: { script: "{{path:./verify.sh}}" } }),
    );
    expect(result).toBe("script={{path:./verify.sh}}");
  });

  test("path token works alongside env token", async () => {
    const dir = await makeTmpDir({});
    cleanup.push(dir);
    const restore = withEnv("MD_EXPAND_TEST_REGION", "us-west");
    try {
      const result = await expand(
        "region={{env:MD_EXPAND_TEST_REGION}} path={{path:./run.sh}}",
        dir,
        opts(),
      );
      expect(result).toBe(`region=us-west path=${path.resolve(dir, "./run.sh")}`);
    } finally {
      restore();
    }
  });

  test("path token inside file-template arg stays literal", async () => {
    const dir = await makeTmpDir({
      "inner.md": "inner-path={{arg:p}}",
    });
    cleanup.push(dir);
    const result = await expand('{{ file="./inner.md" p="{{path:./verify.sh}}" }}', dir, opts());
    // The {{path:./verify.sh}} should remain literal string "{{path:./verify.sh}}"
    // inside the file-template arg; it is NOT resolved as an absolute path.
    expect(result).toBe("inner-path={{path:./verify.sh}}");
  });
});

describe("expand: {{gitpath:...}} tokens", () => {
  beforeEach(() => {
    clearGitRootCache();
  });

  test("resolves {{gitpath:...}} relative to git root", async () => {
    const gitRoot = require("child_process")
      .execSync("git rev-parse --show-toplevel", { encoding: "utf-8" })
      .trim();
    const result = await expand("src={{gitpath:src/main.ts}}", gitRoot, opts());
    expect(result).toBe(`src=${path.resolve(gitRoot, "src/main.ts")}`);
  });
});

describe("expand: no-path-token fast path", () => {
  test("text with only env tokens (no path) returns correctly", async () => {
    const restore = withEnv("MD_EXPAND_TEST_FAST", "fast");
    try {
      const result = await expand("value={{env:MD_EXPAND_TEST_FAST}}", "/tmp", opts());
      expect(result).toBe("value=fast");
    } finally {
      restore();
    }
  });
});
