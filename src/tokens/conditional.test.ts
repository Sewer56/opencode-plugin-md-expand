import { describe, test, expect } from "bun:test";

import { expand, expandWithDiagnostics } from "../expand";
import { makeTmpDir, withEnv, opts, cleanup } from "../test-helpers";

describe("expand: inline conditional blocks", () => {
  test("if=arg includes block when scoped arg is non-empty", async () => {
    const dir = await makeTmpDir({
      "outer.txt": "before\n{{ if=include_extra }}\nEXTRA\n{{ endif }}\nafter",
    });
    cleanup.push(dir);
    const result = await expand(`{{ file="./outer.txt" include_extra=1 }}`, dir, opts());
    expect(result).toBe("before\nEXTRA\nafter");
  });

  test("if=arg removes block when scoped arg is absent", async () => {
    const dir = await makeTmpDir({
      "outer.txt": "before\n{{ if=include_extra }}\nEXTRA\n{{ endif }}\nafter",
    });
    cleanup.push(dir);
    const result = await expand(`{{ file="./outer.txt" }}`, dir, opts());
    expect(result).toBe("before\nafter");
  });

  test("if=arg with empty string arg is equivalent to omitted arg", async () => {
    const dir = await makeTmpDir({
      "outer.txt": "before\n{{ if=flag }}\nFLAG\n{{ endif }}\nafter",
    });
    cleanup.push(dir);
    const omitted = await expand(`{{ file="./outer.txt" }}`, dir, opts());
    const empty = await expand(`{{ file="./outer.txt" flag="" }}`, dir, opts());
    expect(empty).toBe(omitted);
    expect(empty).toBe("before\nafter");
  });

  test("if=arg==value includes only exact matches", async () => {
    const dir = await makeTmpDir({
      "outer.txt": [
        "start",
        "{{ if=mode==cached }}",
        "CACHED",
        "{{ endif }}",
        "{{ if=mode==cacheless }}",
        "CACHELESS",
        "{{ endif }}",
        "end",
      ].join("\n"),
    });
    cleanup.push(dir);

    const cached = await expand(`{{ file="./outer.txt" mode=cached }}`, dir, opts());
    const cacheless = await expand(`{{ file="./outer.txt" mode=cacheless }}`, dir, opts());

    expect(cached).toBe("start\nCACHED\nend");
    expect(cacheless).toBe("start\nCACHELESS\nend");
  });

  test("if=env:VAR includes block when env var is non-empty", async () => {
    const restore = withEnv("MD_EXPAND_INLINE_ENV", "enabled");
    try {
      const result = await expand(
        "before\n{{ if=env:MD_EXPAND_INLINE_ENV }}\nENV\n{{ endif }}\nafter",
        "/tmp",
        opts(),
      );
      expect(result).toBe("before\nENV\nafter");
    } finally {
      restore();
    }
  });

  test("if=env:VAR==value includes only exact env matches", async () => {
    const restore = withEnv("MD_EXPAND_INLINE_MODE", "cached");
    try {
      const result = await expand(
        [
          "start",
          "{{ if=env:MD_EXPAND_INLINE_MODE==cached }}",
          "CACHED",
          "{{ endif }}",
          "{{ if=env:MD_EXPAND_INLINE_MODE==cacheless }}",
          "CACHELESS",
          "{{ endif }}",
          "end",
        ].join("\n"),
        "/tmp",
        opts(),
      );
      expect(result).toBe("start\nCACHED\nend");
    } finally {
      restore();
    }
  });

  test("nested inline conditionals expand independently", async () => {
    const dir = await makeTmpDir({
      "outer.txt": [
        "start",
        "{{ if=outer }}",
        "OUTER",
        "{{ if=inner }}",
        "INNER",
        "{{ endif }}",
        "DONE",
        "{{ endif }}",
        "end",
      ].join("\n"),
    });
    cleanup.push(dir);

    const both = await expand(`{{ file="./outer.txt" outer=1 inner=1 }}`, dir, opts());
    const outerOnly = await expand(`{{ file="./outer.txt" outer=1 }}`, dir, opts());

    expect(both).toBe("start\nOUTER\nINNER\nDONE\nend");
    expect(outerOnly).toBe("start\nOUTER\nDONE\nend");
  });

  test("false inline block does not read file imports inside", async () => {
    const dir = await makeTmpDir({
      "outer.txt": 'before\n{{ if=mode==cached }}\n{{ file="./missing.txt" }}\n{{ endif }}\nafter',
    });
    cleanup.push(dir);
    const result = await expandWithDiagnostics(
      `{{ file="./outer.txt" mode=cacheless }}`,
      dir,
      opts(),
    );
    expect(result.text).toBe("before\nafter");
    expect(result.diagnostics).toEqual([]);
  });

  test("inline blocks can be used within a single line", async () => {
    const dir = await makeTmpDir({
      "outer.txt": "prefix {{ if=mode==cached }}CACHED{{ endif }} suffix",
    });
    cleanup.push(dir);
    const result = await expand(`{{ file="./outer.txt" mode=cached }}`, dir, opts());
    expect(result).toBe("prefix CACHED suffix");
  });

  test("inline conditional markers in arg values remain literal", async () => {
    const dir = await makeTmpDir({ "tmpl.txt": "{{arg:snippet}}" });
    cleanup.push(dir);
    const result = await expand(
      `{{ file="./tmpl.txt" snippet="{{ if=flag }}YES{{ endif }}" flag=1 }}`,
      dir,
      opts(),
    );
    expect(result).toBe("{{ if=flag }}YES{{ endif }}");
  });

  test("invalid inline condition stays literal for validation", async () => {
    const result = await expand("before\n{{ if=mode=bad }}\nX\n{{ endif }}\nafter", "/tmp", opts());
    expect(result).toBe("before\n{{ if=mode=bad }}\nX\n{{ endif }}\nafter");
  });

  test("unclosed inline condition stays literal for validation", async () => {
    const result = await expand("before\n{{ if=flag }}\nX", "/tmp", opts());
    expect(result).toBe("before\n{{ if=flag }}\nX");
  });

  test("if/else/endif: includes true branch when arg is non-empty", async () => {
    const dir = await makeTmpDir({
      "outer.txt": "before\n{{ if=flag }}\nTRUE\n{{ else }}\nFALSE\n{{ endif }}\nafter",
    });
    cleanup.push(dir);
    const result = await expand(`{{ file="./outer.txt" flag=1 }}`, dir, opts());
    expect(result).toBe("before\nTRUE\nafter");
  });

  test("if/else/endif: includes false branch when arg is absent", async () => {
    const dir = await makeTmpDir({
      "outer.txt": "before\n{{ if=flag }}\nTRUE\n{{ else }}\nFALSE\n{{ endif }}\nafter",
    });
    cleanup.push(dir);
    const result = await expand(`{{ file="./outer.txt" }}`, dir, opts());
    expect(result).toBe("before\nFALSE\nafter");
  });

  test("if/else/endif: inline else on a single line", async () => {
    const dir = await makeTmpDir({
      "outer.txt": "prefix {{ if=mode==cached }}CACHED{{ else }}CACHELESS{{ endif }} suffix",
    });
    cleanup.push(dir);
    const cached = await expand(`{{ file="./outer.txt" mode=cached }}`, dir, opts());
    const cacheless = await expand(`{{ file="./outer.txt" mode=cacheless }}`, dir, opts());
    expect(cached).toBe("prefix CACHED suffix");
    expect(cacheless).toBe("prefix CACHELESS suffix");
  });

  test("if/else/endif: nested if inside true branch", async () => {
    const dir = await makeTmpDir({
      "outer.txt": [
        "start",
        "{{ if=outer }}",
        "OUTER-TRUE",
        "{{ if=inner }}",
        "INNER",
        "{{ endif }}",
        "{{ else }}",
        "OUTER-FALSE",
        "{{ endif }}",
        "end",
      ].join("\n"),
    });
    cleanup.push(dir);
    const both = await expand(`{{ file="./outer.txt" outer=1 inner=1 }}`, dir, opts());
    const outerOnly = await expand(`{{ file="./outer.txt" outer=1 }}`, dir, opts());
    const neither = await expand(`{{ file="./outer.txt" }}`, dir, opts());
    expect(both).toBe("start\nOUTER-TRUE\nINNER\nend");
    expect(outerOnly).toBe("start\nOUTER-TRUE\nend");
    expect(neither).toBe("start\nOUTER-FALSE\nend");
  });

  test("if/else/endif: nested if inside false branch", async () => {
    const dir = await makeTmpDir({
      "outer.txt": [
        "start",
        "{{ if=outer }}",
        "TRUE",
        "{{ else }}",
        "FALSE",
        "{{ if=inner }}",
        "INNER",
        "{{ endif }}",
        "{{ endif }}",
        "end",
      ].join("\n"),
    });
    cleanup.push(dir);
    const withInner = await expand(`{{ file="./outer.txt" inner=1 }}`, dir, opts());
    const withoutInner = await expand(`{{ file="./outer.txt" }}`, dir, opts());
    expect(withInner).toBe("start\nFALSE\nINNER\nend");
    expect(withoutInner).toBe("start\nFALSE\nend");
  });

  test("if/else/endif: false branch does not read file imports inside", async () => {
    const dir = await makeTmpDir({
      "outer.txt":
        'before\n{{ if=flag }}\n{{ file="./missing.txt" }}\n{{ else }}\nFALLBACK\n{{ endif }}\nafter',
    });
    cleanup.push(dir);
    const result = await expandWithDiagnostics(`{{ file="./outer.txt" }}`, dir, opts());
    expect(result.text).toBe("before\nFALLBACK\nafter");
    expect(result.diagnostics).toEqual([]);
  });

  // ── inline conditionals with initialArgs (no file wrapping) ──

  test("includes block when initialArgs arg is truthy", async () => {
    const result = await expand(
      "{{ if=DEBUG }}debug on{{ endif }}",
      "/tmp",
      opts({ initialArgs: { DEBUG: "1" } }),
    );
    expect(result).toBe("debug on");
  });

  test("removes block when initialArgs arg is empty", async () => {
    const result = await expand("{{ if=DEBUG }}debug on{{ endif }}", "/tmp", opts());
    expect(result.trim()).toBe("");
  });

  test("includes true branch with else from initialArgs", async () => {
    const result = await expand(
      "{{ if=mode==cached }}Cached{{ else }}Live{{ endif }}",
      "/tmp",
      opts({ initialArgs: { mode: "cached" } }),
    );
    expect(result).toBe("Cached");
  });

  test("includes false branch with else from initialArgs", async () => {
    const result = await expand(
      "{{ if=mode==cached }}Cached{{ else }}Live{{ endif }}",
      "/tmp",
      opts({ initialArgs: { mode: "live" } }),
    );
    expect(result).toBe("Live");
  });

  test("removes block when if=env:VAR is unset", async () => {
    const result = await expand("{{ if=env:NONEXISTENT }}got it{{ endif }}", "/tmp", opts());
    expect(result.trim()).toBe("");
  });

  // ── != inequality operator ────────────────────────────────────────────────

  test("if=arg!=value includes block when arg differs", async () => {
    const dir = await makeTmpDir({
      "outer.txt": ["start", "{{ if=mode!=cached }}", "NOT-CACHED", "{{ endif }}", "end"].join(
        "\n",
      ),
    });
    cleanup.push(dir);
    const result = await expand(`{{ file="./outer.txt" mode=live }}`, dir, opts());
    expect(result).toBe("start\nNOT-CACHED\nend");
  });

  test("if=arg!=value excludes block when arg matches", async () => {
    const dir = await makeTmpDir({
      "outer.txt": ["start", "{{ if=mode!=cached }}", "NOT-CACHED", "{{ endif }}", "end"].join(
        "\n",
      ),
    });
    cleanup.push(dir);
    const result = await expand(`{{ file="./outer.txt" mode=cached }}`, dir, opts());
    expect(result).toBe("start\nend");
  });

  test("if=arg!= includes block when arg is absent (negated truthiness)", async () => {
    const dir = await makeTmpDir({
      "outer.txt": "before\n{{ if=flag!= }}\nNO-FLAG\n{{ endif }}\nafter",
    });
    cleanup.push(dir);
    const result = await expand(`{{ file="./outer.txt" }}`, dir, opts());
    expect(result).toBe("before\nNO-FLAG\nafter");
  });

  test("if=arg!= excludes block when arg is present (negated truthiness)", async () => {
    const dir = await makeTmpDir({
      "outer.txt": "before\n{{ if=flag!= }}\nNO-FLAG\n{{ endif }}\nafter",
    });
    cleanup.push(dir);
    const result = await expand(`{{ file="./outer.txt" flag=1 }}`, dir, opts());
    expect(result).toBe("before\nafter");
  });

  test("if=env:VAR!=value includes block when env var differs", async () => {
    const restore = withEnv("MD_EXPAND_NEQ_MODE", "live");
    try {
      const result = await expand(
        [
          "start",
          "{{ if=env:MD_EXPAND_NEQ_MODE!=cached }}",
          "NOT-CACHED",
          "{{ endif }}",
          "end",
        ].join("\n"),
        "/tmp",
        opts(),
      );
      expect(result).toBe("start\nNOT-CACHED\nend");
    } finally {
      restore();
    }
  });

  test("if=env:VAR!=value excludes block when env var matches", async () => {
    const restore = withEnv("MD_EXPAND_NEQ_MODE", "cached");
    try {
      const result = await expand(
        [
          "start",
          "{{ if=env:MD_EXPAND_NEQ_MODE!=cached }}",
          "NOT-CACHED",
          "{{ endif }}",
          "end",
        ].join("\n"),
        "/tmp",
        opts(),
      );
      expect(result).toBe("start\nend");
    } finally {
      restore();
    }
  });

  test("if=arg!=value with else includes false branch when arg matches", async () => {
    const dir = await makeTmpDir({
      "outer.txt": "prefix {{ if=mode!=cached }}NOT-CACHED{{ else }}CACHED{{ endif }} suffix",
    });
    cleanup.push(dir);
    const result = await expand(`{{ file="./outer.txt" mode=cached }}`, dir, opts());
    expect(result).toBe("prefix CACHED suffix");
  });

  test("if=arg!=value with else includes true branch when arg differs", async () => {
    const dir = await makeTmpDir({
      "outer.txt": "prefix {{ if=mode!=cached }}NOT-CACHED{{ else }}CACHED{{ endif }} suffix",
    });
    cleanup.push(dir);
    const result = await expand(`{{ file="./outer.txt" mode=live }}`, dir, opts());
    expect(result).toBe("prefix NOT-CACHED suffix");
  });

  test("if=arg!=value with initialArgs includes when differing", async () => {
    const result = await expand(
      "{{ if=mode!=cached }}Live{{ else }}Cached{{ endif }}",
      "/tmp",
      opts({ initialArgs: { mode: "live" } }),
    );
    expect(result).toBe("Live");
  });

  test("if=arg!=value with initialArgs excludes when matching", async () => {
    const result = await expand(
      "{{ if=mode!=cached }}Live{{ else }}Cached{{ endif }}",
      "/tmp",
      opts({ initialArgs: { mode: "cached" } }),
    );
    expect(result).toBe("Cached");
  });
});
