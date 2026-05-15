import { describe, test, expect } from "bun:test";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { expand, expandWithDiagnostics } from "../expand";
import { makeTmpDir, withEnv, opts, cleanup } from "../test-helpers";
import { MAX_DEPTH } from "../token-syntax";

describe("expand: file templates", () => {
  test("replaces file template with file content", async () => {
    const dir = await makeTmpDir({ "marker.txt": "MARKER-ALPHA-7742" });
    cleanup.push(dir);
    const result = await expand(`code: {{ file="./marker.txt" }}`, dir, opts());
    expect(result).toBe("code: MARKER-ALPHA-7742");
  });

  test("trims file content", async () => {
    const dir = await makeTmpDir({ "padded.txt": "  hello world  \n" });
    cleanup.push(dir);
    const result = await expand(`{{ file="./padded.txt" }}`, dir, opts());
    expect(result).toBe("hello world");
  });

  test("~/... resolves to home-relative file", async () => {
    const tmpFile = path.join(os.homedir(), ".md-expand-test-tmp.txt");
    await fsp.writeFile(tmpFile, "HOME_MARKER", "utf8");
    cleanup.push(tmpFile);
    const result = await expand(`{{ file="~/.md-expand-test-tmp.txt" }}`, "/tmp", opts());
    expect(result).toBe("HOME_MARKER");
  });

  test("../... resolves relative to baseDir parent", async () => {
    const parent = await makeTmpDir({ "parent-marker.txt": "PARENT_MARKER" });
    const child = path.join(parent, "subdir");
    await fsp.mkdir(child, { recursive: true });
    cleanup.push(parent);
    const result = await expand(`{{ file="../parent-marker.txt" }}`, child, opts());
    expect(result).toBe("PARENT_MARKER");
  });

  test("nonexistent relative file returns empty string (ENOENT)", async () => {
    const dir = await makeTmpDir({});
    cleanup.push(dir);
    const result = await expand(`before{{ file="./nope.txt" }}after`, dir, opts());
    expect(result).toBe("beforeafter");
  });

  test("nonexistent absolute file returns empty string (ENOENT, no fallback)", async () => {
    const result = await expand(`{{ file="/tmp/md-expand-no-such-absolute.txt" }}`, "/tmp", opts());
    expect(result).toBe("");
  });

  test("multiple file templates in one string", async () => {
    const dir = await makeTmpDir({
      "a.txt": "AAA",
      "b.txt": "BBB",
    });
    cleanup.push(dir);
    const result = await expand(`{{ file="./a.txt" }} and {{ file="./b.txt" }}`, dir, opts());
    expect(result).toBe("AAA and BBB");
  });

  test("supports zero whitespace after opening and before closing braces", async () => {
    const dir = await makeTmpDir({ "marker.txt": "TIGHT" });
    cleanup.push(dir);
    const result = await expand(`{{file="./marker.txt"}}`, dir, opts());
    expect(result).toBe("TIGHT");
  });

  test("arg expansion can form the file attribute name", async () => {
    const dir = await makeTmpDir({ "marker.txt": "ATTR_FROM_ARG" });
    cleanup.push(dir);
    const result = await expand(
      `{{ {{arg:attr}}="./marker.txt" }}`,
      dir,
      opts({ initialArgs: { attr: "file" } }),
    );
    expect(result).toBe("ATTR_FROM_ARG");
  });

  test("removes full line when file template expands empty", async () => {
    const dir = await makeTmpDir({});
    cleanup.push(dir);
    const result = await expand('before\n  {{ file="./missing.txt" }}  \nafter', dir, opts());
    expect(result).toBe("before\nafter");
  });

  test("blanks inline file template when expansion is empty", async () => {
    const dir = await makeTmpDir({});
    cleanup.push(dir);
    const result = await expand(`before {{ file="./missing.txt" }} after`, dir, opts());
    expect(result).toBe("before  after");
  });

  test("removes multiline template block when false or missing", async () => {
    const dir = await makeTmpDir({});
    cleanup.push(dir);
    const result = await expand(`before\n{{\n  file="./missing.txt"\n}}\nafter`, dir, opts());
    expect(result).toBe("before\nafter");
  });
});

describe("expand: file template args", () => {
  test("passes a basic arg into an embedded file", async () => {
    const dir = await makeTmpDir({ "tmpl.txt": "domain={{arg:domain}}" });
    cleanup.push(dir);
    const result = await expand(`{{ file="./tmpl.txt" domain=correctness }}`, dir, opts());
    expect(result).toBe("domain=correctness");
  });

  test("supports quoted arg values with spaces", async () => {
    const dir = await makeTmpDir({ "tmpl.txt": "value={{arg:key}}" });
    cleanup.push(dir);
    const result = await expand(`{{ file="./tmpl.txt" key="val with spaces" }}`, dir, opts());
    expect(result).toBe("value=val with spaces");
  });

  test("supports multiple args", async () => {
    const dir = await makeTmpDir({ "tmpl.txt": "{{arg:key1}}/{{arg:key2}}" });
    cleanup.push(dir);
    const result = await expand(`{{ file="./tmpl.txt" key1=a key2=b }}`, dir, opts());
    expect(result).toBe("a/b");
  });

  test("supports multiline file templates with whitespace between attrs", async () => {
    const dir = await makeTmpDir({ "tmpl.txt": "{{arg:key1}}/{{arg:key2}}" });
    cleanup.push(dir);
    const result = await expand(
      `{{
        file = "./tmpl.txt"
        key1 = "a value"
        key2 = b
      }}`,
      dir,
      opts(),
    );
    expect(result).toBe("a value/b");
  });

  test("decodes common escapes in template args", async () => {
    const dir = await makeTmpDir({
      "tmpl.txt": "{{arg:lines}}|{{arg:tab}}|{{arg:quote}}|{{arg:slash}}",
    });
    cleanup.push(dir);
    const result = await expand(
      `{{ file="./tmpl.txt" lines="one\\ntwo" tab=a\\tb quote="say \\"hi\\"" slash="a\\\\b" }}`,
      dir,
      opts(),
    );
    expect(result).toBe('one\ntwo|a\tb|say "hi"|a\\b');
  });

  test("unrecognized escapes drop the backslash (backtick, letters)", async () => {
    const dir = await makeTmpDir({ "tmpl.txt": "{{arg:a}}|{{arg:b}}" });
    cleanup.push(dir);
    const bt = "`";
    const result = await expand(`{{ file="./tmpl.txt" a="\\${bt}x\\${bt}" b="\\z" }}`, dir, opts());
    expect(result).toBe("`x`|z");
  });

  test("undefined args resolve to empty string", async () => {
    const dir = await makeTmpDir({ "tmpl.txt": "before[{{arg:missing}}]after" });
    cleanup.push(dir);
    const result = await expand(`{{ file="./tmpl.txt" }}`, dir, opts());
    expect(result).toBe("before[]after");
  });

  test("undefined arg removes full line when alone", async () => {
    const dir = await makeTmpDir({ "tmpl.txt": "before\n{{arg:missing}}\nafter" });
    cleanup.push(dir);
    const result = await expand(`{{ file="./tmpl.txt" }}`, dir, opts());
    expect(result).toBe("before\nafter");
  });

  test("args can compose nested file paths", async () => {
    const dir = await makeTmpDir({
      "tmpl.txt": `{{ file="./rules/{{arg:topic}}.md" }}`,
      "rules/testing.md": "TEST_RULE",
    });
    cleanup.push(dir);
    const result = await expand(`{{ file="./tmpl.txt" topic=testing }}`, dir, opts());
    expect(result).toBe("TEST_RULE");
  });

  test("nested files without args do not inherit parent args", async () => {
    const dir = await makeTmpDir({
      "outer.txt": `outer={{arg:key}}; inner={{ file="./inner.txt" }}`,
      "inner.txt": "inner={{arg:key}}",
    });
    cleanup.push(dir);
    const result = await expand(`{{ file="./outer.txt" key=OUTER }}`, dir, opts());
    expect(result).toBe("outer=OUTER; inner=inner=");
  });

  test("nested files receive only their own args", async () => {
    const dir = await makeTmpDir({
      "outer.txt": `outer={{arg:key}}; inner={{ file="./inner.txt" key=INNER other=2 }}`,
      "inner.txt": "inner={{arg:key}}/{{arg:other}}/{{arg:missing}}",
    });
    cleanup.push(dir);
    const result = await expand(`{{ file="./outer.txt" key=OUTER other=1 }}`, dir, opts());
    expect(result).toBe("outer=OUTER; inner=inner=INNER/2/");
  });

  test("supports quoted file paths with spaces", async () => {
    const dir = await makeTmpDir({ "path with spaces.txt": "{{arg:key}}" });
    cleanup.push(dir);
    const result = await expand(`{{ file="./path with spaces.txt" key=val }}`, dir, opts());
    expect(result).toBe("val");
  });

  test("duplicate arg keys use the last value", async () => {
    const dir = await makeTmpDir({ "tmpl.txt": "{{arg:key}}" });
    cleanup.push(dir);
    const result = await expand(`{{ file="./tmpl.txt" key=a key=b }}`, dir, opts());
    expect(result).toBe("b");
  });

  test("arg values containing env tokens remain literal", async () => {
    const dir = await makeTmpDir({ "tmpl.txt": "{{arg:key}}" });
    cleanup.push(dir);
    const restore = withEnv("MD_EXPAND_ARG_LITERAL", "EXPANDED");
    try {
      const result = await expand(
        `{{ file="./tmpl.txt" key="{{env:MD_EXPAND_ARG_LITERAL}}" }}`,
        dir,
        opts(),
      );
      expect(result).toBe("{{env:MD_EXPAND_ARG_LITERAL}}");
    } finally {
      restore();
    }
  });

  test("arg values containing file templates remain literal", async () => {
    const dir = await makeTmpDir({
      "tmpl.txt": "{{arg:key}}",
      "secret.txt": "SHOULD_NOT_EXPAND",
    });
    cleanup.push(dir);
    const result = await expand(
      `{{ file="./tmpl.txt" key="{{ file=\\\"./secret.txt\\\" }}" }}`,
      dir,
      opts(),
    );
    expect(result).toBe(`{{ file="./secret.txt" }}`);
  });

  test("arg tokens in arg values cascade from parent scope", async () => {
    const dir = await makeTmpDir({
      "outer.txt": `{{ file="./inner.txt" x="{{arg:subject}}" }}`,
      "inner.txt": "x={{arg:x}}",
    });
    cleanup.push(dir);
    const result = await expand(`{{ file="./outer.txt" subject=hello }}`, dir, opts());
    expect(result).toBe("x=hello");
  });

  test("file templates work with zero args", async () => {
    const dir = await makeTmpDir({ "plain.txt": "PLAIN" });
    cleanup.push(dir);
    const result = await expand(`{{ file="./plain.txt" }}`, dir, opts());
    expect(result).toBe("PLAIN");
  });
});

describe("expand: file template if conditions", () => {
  test("if=arg includes when arg is non-empty", async () => {
    const dir = await makeTmpDir({
      "outer.txt": 'before\n{{ file="./extra.txt" if=include_extra }}\nafter',
      "extra.txt": "EXTRA",
    });
    cleanup.push(dir);
    const result = await expand(`{{ file="./outer.txt" include_extra=1 }}`, dir, opts());
    expect(result).toBe("before\nEXTRA\nafter");
  });

  test("if=arg removes line when arg is absent", async () => {
    const dir = await makeTmpDir({
      "outer.txt": 'before\n{{ file="./extra.txt" if=include_extra }}\nafter',
      "extra.txt": "EXTRA",
    });
    cleanup.push(dir);
    const result = await expand(`{{ file="./outer.txt" }}`, dir, opts());
    expect(result).toBe("before\nafter");
  });

  test("if=arg==value includes only exact matches", async () => {
    const dir = await makeTmpDir({
      "outer.txt": [
        "start",
        `{{ file="./cached.txt" if=mode==cached }}`,
        `{{ file="./cacheless.txt" if=mode==cacheless }}`,
        "end",
      ].join("\n"),
      "cached.txt": "CACHED",
      "cacheless.txt": "CACHELESS",
    });
    cleanup.push(dir);

    const cached = await expand(`{{ file="./outer.txt" mode=cached }}`, dir, opts());
    const cacheless = await expand(`{{ file="./outer.txt" mode=cacheless }}`, dir, opts());

    expect(cached).toBe("start\nCACHED\nend");
    expect(cacheless).toBe("start\nCACHELESS\nend");
  });

  test("if condition can use same-template args", async () => {
    const dir = await makeTmpDir({ "extra.txt": "EXTRA" });
    cleanup.push(dir);
    const result = await expand(
      `{{ file="./extra.txt" if=mode==cached mode=cached }}`,
      dir,
      opts(),
    );
    expect(result).toBe("EXTRA");
  });

  test("false if does not read file", async () => {
    const dir = await makeTmpDir({
      "outer.txt": 'before\n{{ file="./missing.txt" if=mode==cached }}\nafter',
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

  test("invalid if condition leaves template literal for validation", async () => {
    const dir = await makeTmpDir({ "extra.txt": "EXTRA" });
    cleanup.push(dir);
    const result = await expand(`{{ file="./extra.txt" if=mode=bad }}`, dir, opts());
    expect(result).toBe(`{{ file="./extra.txt" if=mode=bad }}`);
  });

  // ── != inequality operator ────────────────────────────────────────────────

  test("if=arg!=value includes when arg does not match", async () => {
    const dir = await makeTmpDir({
      "outer.txt": [
        "start",
        `{{ file="./cached.txt" if=mode!=cached }}`,
        `{{ file="./cacheless.txt" if=mode!=cacheless }}`,
        "end",
      ].join("\n"),
      "cached.txt": "CACHED",
      "cacheless.txt": "CACHELESS",
    });
    cleanup.push(dir);

    const cached = await expand(`{{ file="./outer.txt" mode=cached }}`, dir, opts());
    const cacheless = await expand(`{{ file="./outer.txt" mode=cacheless }}`, dir, opts());

    expect(cached).toBe("start\nCACHELESS\nend");
    expect(cacheless).toBe("start\nCACHED\nend");
  });

  test("if=arg!=value excludes when arg matches", async () => {
    const dir = await makeTmpDir({
      "outer.txt": 'before\n{{ file="./extra.txt" if=mode!=cached }}\nafter',
      "extra.txt": "EXTRA",
    });
    cleanup.push(dir);
    const result = await expand(`{{ file="./outer.txt" mode=cached }}`, dir, opts());
    expect(result).toBe("before\nafter");
  });

  test("if=arg!= includes when arg is absent (negated truthiness)", async () => {
    const dir = await makeTmpDir({ "extra.txt": "EXTRA" });
    cleanup.push(dir);
    const result = await expand(`{{ file="./extra.txt" if=flag!= }}`, dir, opts());
    expect(result).toBe("EXTRA");
  });

  test("if=arg!= excludes when arg is present (negated truthiness)", async () => {
    const dir = await makeTmpDir({ "extra.txt": "EXTRA" });
    cleanup.push(dir);
    const result = await expand(`{{ file="./extra.txt" if=flag!= flag=1 }}`, dir, opts());
    expect(result).toBe("");
  });

  test("false if=arg!= does not read file", async () => {
    const dir = await makeTmpDir({
      "outer.txt": 'before\n{{ file="./missing.txt" if=mode!=cacheless }}\nafter',
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
});

describe("expand: config-dir fallback", () => {
  test("relative file template falls back to configDir when not found in baseDir", async () => {
    const configDir = await makeTmpDir({
      ".opencode/shared-rules.md": "FALLBACK_MARKER",
    });
    cleanup.push(configDir);

    const fakeDir = await makeTmpDir({});
    cleanup.push(fakeDir);

    const result = await expand(
      `{{ file="./.opencode/shared-rules.md" }}`,
      fakeDir,
      opts({ configDirs: [configDir] }),
    );
    expect(result).toBe("FALLBACK_MARKER");
  });

  test("fallback NOT used when file exists in baseDir", async () => {
    const configDir = await makeTmpDir({
      ".opencode/test-fallback.txt": "SHOULD_NOT_SEE_THIS",
    });
    cleanup.push(configDir);

    const dir = await makeTmpDir({ ".opencode/test-fallback.txt": "PRIMARY_MARKER" });
    cleanup.push(dir);

    const result = await expand(
      `{{ file="./.opencode/test-fallback.txt" }}`,
      dir,
      opts({ configDirs: [configDir] }),
    );
    expect(result).toBe("PRIMARY_MARKER");
  });
});

describe("expand: recursive file templates", () => {
  test("recursively expands file templates in imported content", async () => {
    const dir = await makeTmpDir({
      "inner.txt": "INNER_CONTENT",
      "outer.txt": `outer: {{ file="./inner.txt" }}`,
    });
    cleanup.push(dir);
    const result = await expand(`{{ file="./outer.txt" }}`, dir, opts());
    expect(result).toBe("outer: INNER_CONTENT");
  });

  test("expands multi-level chain (3 deep)", async () => {
    const dir = await makeTmpDir({
      "c.txt": "C_VALUE",
      "b.txt": `B:{{ file="./c.txt" }}`,
      "a.txt": `A:{{ file="./b.txt" }}`,
    });
    cleanup.push(dir);
    const result = await expand(`{{ file="./a.txt" }}`, dir, opts());
    expect(result).toBe("A:B:C_VALUE");
  });

  test("detects self-referential cycle and replaces with empty string", async () => {
    const dir = await makeTmpDir({
      "loop.txt": `start {{ file="./loop.txt" }} end`,
    });
    cleanup.push(dir);
    const result = await expand(`{{ file="./loop.txt" }}`, dir, opts());
    expect(result).toBe("start  end");
  });

  test("missing file within recursive chain resolves to empty string", async () => {
    const dir = await makeTmpDir({
      "outer.txt": `prefix {{ file="./missing.txt" }} suffix`,
    });
    cleanup.push(dir);
    const result = await expand(`{{ file="./outer.txt" }}`, dir, opts());
    expect(result).toBe("prefix  suffix");
  });

  test("detects mutual cycle (A→B→A) and breaks it", async () => {
    const dir = await makeTmpDir({
      "a.txt": `A-{{ file="./b.txt" }}`,
      "b.txt": `B-{{ file="./a.txt" }}`,
    });
    cleanup.push(dir);
    const result = await expand(`{{ file="./a.txt" }}`, dir, opts());
    expect(result).toBe("A-B-");
  });

  test("sibling tokens referencing same file both resolve (diamond pattern)", async () => {
    const dir = await makeTmpDir({
      "shared.txt": "SHARED",
      "top.txt": `{{ file="./shared.txt" }} and {{ file="./shared.txt" }}`,
    });
    cleanup.push(dir);
    const result = await expand(`{{ file="./top.txt" }}`, dir, opts());
    expect(result).toBe("SHARED and SHARED");
  });

  test("expands chain exactly MAX_DEPTH levels deep", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < MAX_DEPTH; i++) {
      if (i === MAX_DEPTH - 1) {
        files[`d${i}.txt`] = `LEAF`;
      } else {
        files[`d${i}.txt`] = `D${i}:{{ file="./d${i + 1}.txt" }}`;
      }
    }
    const dir = await makeTmpDir(files);
    cleanup.push(dir);
    const result = await expand(`{{ file="./d0.txt" }}`, dir, opts());
    expect(result).toContain("LEAF");
  });

  test("at MAX_DEPTH, leaves unexpanded file templates as literal text", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < MAX_DEPTH; i++) {
      if (i === MAX_DEPTH - 1) {
        files[`e${i}.txt`] = `DEEP_{{ file="./e-leaf.txt" }}_{{env:MD_EXPAND_DEPTH_ENV}}`;
      } else {
        files[`e${i}.txt`] = `E${i}:{{ file="./e${i + 1}.txt" }}`;
      }
    }
    files["e-leaf.txt"] = `NEVER_READ`;
    const dir = await makeTmpDir(files);
    cleanup.push(dir);
    const restore = withEnv("MD_EXPAND_DEPTH_ENV", "YES");
    try {
      const result = await expand(`{{ file="./e0.txt" }}`, dir, opts());
      expect(result).toContain("DEEP_");
      expect(result).toContain(`{{ file="./e-leaf.txt" }}`);
      expect(result).toContain("YES");
      expect(result).not.toContain("NEVER_READ");
    } finally {
      restore();
    }
  });

  test("expands {{env:...}} inside recursively imported content", async () => {
    const dir = await makeTmpDir({
      "with-env.txt": "region={{env:MD_EXPAND_RECURSE_ENV}}",
    });
    cleanup.push(dir);
    const restore = withEnv("MD_EXPAND_RECURSE_ENV", "eu-west");
    try {
      const result = await expand(`{{ file="./with-env.txt" }}`, dir, opts());
      expect(result).toBe("region=eu-west");
    } finally {
      restore();
    }
  });

  test("skips recursive expansion when imported file has no tokens", async () => {
    const dir = await makeTmpDir({
      "plain.txt": "NO_TOKENS_HERE",
    });
    cleanup.push(dir);
    const result = await expand(`{{ file="./plain.txt" }}`, dir, opts());
    expect(result).toBe("NO_TOKENS_HERE");
  });

  test("readCache deduplicates raw I/O for same path across branches", async () => {
    const dir = await makeTmpDir({
      "shared.txt": "SHARED",
      "ref-a.txt": `A:{{ file="./shared.txt" }}`,
      "ref-b.txt": `B:{{ file="./shared.txt" }}`,
      "top.txt": `{{ file="./ref-a.txt" }} | {{ file="./ref-b.txt" }}`,
    });
    cleanup.push(dir);
    const result = await expand(`{{ file="./top.txt" }}`, dir, opts());
    expect(result).toBe("A:SHARED | B:SHARED");
  });

  test("expansion is independent per ancestor chain (no cross-contamination)", async () => {
    const dir = await makeTmpDir({
      "shared.txt": `S:{{ file="./ref-a.txt" }}`,
      "ref-a.txt": "A_CONTENT",
      "ref-b.txt": `B:{{ file="./shared.txt" }}`,
      "top.txt": `{{ file="./ref-a.txt" }} | {{ file="./ref-b.txt" }}`,
    });
    cleanup.push(dir);
    const result = await expand(`{{ file="./top.txt" }}`, dir, opts());
    expect(result).toBe("A_CONTENT | B:S:A_CONTENT");
  });

  test("expanded-file cache keeps ancestor chains independent", async () => {
    const dir = await makeTmpDir({
      "shared.txt": `S:{{ file="./ref-a.txt" }}`,
      "ref-a.txt": "A_CONTENT",
      "ref-b.txt": `B:{{ file="./shared.txt" }}`,
      "top.txt": `{{ file="./ref-a.txt" }} | {{ file="./ref-b.txt" }}`,
    });
    cleanup.push(dir);
    const result = await expand(`{{ file="./top.txt" }}`, dir, opts({ cache: true }));
    expect(result).toBe("A_CONTENT | B:S:A_CONTENT");
  });
});

describe("expand: include boundary whitespace", () => {
  test("standalone file include does not produce double blank lines at boundary", async () => {
    const dir = await makeTmpDir({
      "header.txt": `Step 1\nStep 2\nStep 3`,
      "main.md": `{{ file="./header.txt" }}\n\nStep 4`,
    });
    cleanup.push(dir);
    const result = await expand(`{{ file="./main.md" }}`, dir, opts());
    expect(result).toBe("Step 1\nStep 2\nStep 3\n\nStep 4");
  });

  test("file include ending with conditional does not produce double blank lines", async () => {
    const dir = await makeTmpDir({
      "header.txt": `Step 1\nStep 2\nStep 3\n{{ if=show_extra }}\nExtra\n{{ endif }}`,
      "main.md": `{{ file="./header.txt" }}\n\nStep 4`,
    });
    cleanup.push(dir);
    const result = await expand(`{{ file="./main.md" }}`, dir, opts());
    expect(result).toBe("Step 1\nStep 2\nStep 3\n\nStep 4");
  });

  test("file include with if/else at end does not produce double blank lines", async () => {
    const dir = await makeTmpDir({
      "footer.txt": `Step 5\n{{ if=pointer }}\nPointer\n{{ else }}\nFull\n{{ endif }}`,
      "main.md": `Step 4\n\n{{ file="./footer.txt" }}\n\n# Output`,
    });
    cleanup.push(dir);
    const result = await expand(`{{ file="./main.md" }}`, dir, opts());
    expect(result).toBe("Step 4\n\nStep 5\nFull\n\n# Output");
  });

  test("inline file include (not on own line) is unaffected", async () => {
    const dir = await makeTmpDir({
      "name.txt": `Alice\n`,
      "main.md": `Hello {{ file="./name.txt" }}!`,
    });
    cleanup.push(dir);
    const result = await expand(`{{ file="./main.md" }}`, dir, opts());
    expect(result).toBe("Hello Alice!");
  });

  test("multiple file includes in sequence do not accumulate extra blank lines", async () => {
    const dir = await makeTmpDir({
      "a.txt": `A-content`,
      "b.txt": `B-content`,
      "c.txt": `C-content`,
      "main.md": `{{ file="./a.txt" }}\n{{ file="./b.txt" }}\n{{ file="./c.txt" }}`,
    });
    cleanup.push(dir);
    const result = await expand(`{{ file="./main.md" }}`, dir, opts());
    expect(result).toBe("A-content\nB-content\nC-content");
  });

  test("deeply nested includes do not produce double blank lines at any boundary", async () => {
    const dir = await makeTmpDir({
      "inner.txt": `Inner-content`,
      "middle.txt": `Middle-before\n{{ file="./inner.txt" }}\nMiddle-after`,
      "outer.md": `Outer-before\n{{ file="./middle.txt" }}\nOuter-after`,
    });
    cleanup.push(dir);
    const result = await expand(`{{ file="./outer.md" }}`, dir, opts());
    expect(result).toBe("Outer-before\nMiddle-before\nInner-content\nMiddle-after\nOuter-after");
  });
});
