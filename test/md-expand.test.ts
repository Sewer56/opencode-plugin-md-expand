/**
 * Unit tests for opencode-plugin-md-expand
 *
 * Restored and adapted from the original file-interp.test.ts (commit bfe1c6d5)
 * plus coverage for new API surface (resolveMdExpandOptions, hasExpandableToken).
 *
 * Run: `cd opencode-plugin-md-expand && bun test test/md-expand.test.ts`
 */
import { describe, test, expect, afterEach } from "bun:test"
import {
  expand,
  expandWithDiagnostics,
  hasExpandableToken,
  MAX_DEPTH,
  resolvePath,
  resolveMdExpandOptions,
} from "../src/index"
import fsp from "node:fs/promises"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

// ── Test helpers ─────────────────────────────────────────────────────────────

/** Create a temp dir with given files, return the dir path. */
async function makeTmpDir(files: Record<string, string>): Promise<string> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "md-expand-test-"))
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel)
    await fsp.mkdir(path.dirname(full), { recursive: true })
    await fsp.writeFile(full, content, "utf8")
  }
  return dir
}

/** Track dirs/files to clean up after tests. */
const cleanup: string[] = []

afterEach(async () => {
  while (cleanup.length) {
    await fsp.rm(cleanup.pop()!, { recursive: true, force: true })
  }
})

/** Set an env var and return a restore function. */
function withEnv(key: string, value: string | undefined): () => void {
  const orig = process.env[key]
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
  return () => {
    if (orig === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = orig
    }
  }
}

/** Shorthand: resolve options with optional configDirs. */
function opts(extra?: Parameters<typeof resolveMdExpandOptions>[0]) {
  return resolveMdExpandOptions(extra)
}

// ── hasExpandableToken ────────────────────────────────────────────────────────

describe("hasExpandableToken", () => {
  test("returns false for plain text", () => {
    expect(hasExpandableToken("Hello world")).toBe(false)
  })

  test("detects {{arg:key}}", () => {
    expect(hasExpandableToken("{{arg:name}}")).toBe(true)
  })

  test("detects {{env:VAR}}", () => {
    expect(hasExpandableToken("{{env:HOME}}")).toBe(true)
  })

  test("detects {{ file=\"...\" }}", () => {
    expect(hasExpandableToken('{{ file="./test.md" }}')).toBe(true)
  })

  test("detects inline {{ if=... }}", () => {
    expect(hasExpandableToken("{{ if=DEBUG }}")).toBe(true)
  })

  test("returns false for single braces", () => {
    expect(hasExpandableToken("{not-a-token}")).toBe(false)
  })
})

// ── resolveMdExpandOptions ────────────────────────────────────────────────────

describe("resolveMdExpandOptions", () => {
  test("returns defaults", () => {
    const o = resolveMdExpandOptions()
    expect(o.maxDepth).toBe(MAX_DEPTH)
    expect(o.debug).toBe(false)
    expect(o.configDirs).toEqual([])
    expect(o.initialArgs).toBeInstanceOf(Map)
  })

  test("merges custom options", () => {
    const o = resolveMdExpandOptions({ maxDepth: 3, debug: true, configDirs: ["/foo"], initialArgs: { x: "1" } })
    expect(o.maxDepth).toBe(3)
    expect(o.debug).toBe(true)
    expect(o.configDirs).toEqual([path.resolve("/foo")])
    expect(o.initialArgs.get("x")).toBe("1")
  })

  test("enables debug via legacy env var", () => {
    const prev = process.env.FILE_INTERP_DEBUG
    process.env.FILE_INTERP_DEBUG = "1"
    try {
      expect(resolveMdExpandOptions().debug).toBe(true)
    } finally {
      if (prev) process.env.FILE_INTERP_DEBUG = prev
      else delete process.env.FILE_INTERP_DEBUG
    }
  })
})

// ── resolvePath ──────────────────────────────────────────────────────────────

describe("resolvePath", () => {
  const base = "/project"

  test("~/... resolves to $HOME", () => {
    expect(resolvePath("~/foo", base)).toBe(path.join(os.homedir(), "foo"))
  })

  test("bare ~ resolves to $HOME", () => {
    expect(resolvePath("~", base)).toBe(os.homedir())
  })

  test("./... resolves relative to baseDir", () => {
    expect(resolvePath("./src/main.ts", base)).toBe("/project/src/main.ts")
  })

  test("../... resolves relative to baseDir", () => {
    expect(resolvePath("../sibling/file.txt", base)).toBe(
      path.resolve("/project", "../sibling/file.txt"),
    )
  })

  test("absolute path used as-is", () => {
    expect(resolvePath("/etc/hosts", base)).toBe("/etc/hosts")
  })

  test("bare name (no prefix) resolves relative to baseDir", () => {
    expect(resolvePath("README.md", base)).toBe("/project/README.md")
  })
})

// ── expand: env tokens ────────────────────────────────────────────────────────

describe("expand: {{env:...}} tokens", () => {
  test("replaces {{env:VAR}} with the value", async () => {
    const restore = withEnv("MD_EXPAND_TEST_ENV", "hello")
    try {
      const result = await expand("value={{env:MD_EXPAND_TEST_ENV}}", "/tmp", opts())
      expect(result).toBe("value=hello")
    } finally {
      restore()
    }
  })

  test("replaces {{env:VAR}} with empty string when unset", async () => {
    const restore = withEnv("MD_EXPAND_DEFINITELY_NOT_SET", undefined)
    try {
      const result = await expand("value=[{{env:MD_EXPAND_DEFINITELY_NOT_SET}}]", "/tmp", opts())
      expect(result).toBe("value=[]")
    } finally {
      restore()
    }
  })

  test("plain text VARIABLE_NAME is left untouched", async () => {
    const result = await expand("path=GENERAL_RULES_PATH", "/tmp", opts())
    expect(result).toBe("path=GENERAL_RULES_PATH")
  })

  test("removes full line when unset env token is alone", async () => {
    const restore = withEnv("MD_EXPAND_DEFINITELY_NOT_SET", undefined)
    try {
      const result = await expand("before\n{{env:MD_EXPAND_DEFINITELY_NOT_SET}}\nafter", "/tmp", opts())
      expect(result).toBe("before\nafter")
    } finally {
      restore()
    }
  })
})

// ── expand: file templates ────────────────────────────────────────────────────

describe("expand: file templates", () => {
  test("replaces file template with file content", async () => {
    const dir = await makeTmpDir({ "marker.txt": "MARKER-ALPHA-7742" })
    cleanup.push(dir)
    const result = await expand(`code: {{ file="./marker.txt" }}`, dir, opts())
    expect(result).toBe("code: MARKER-ALPHA-7742")
  })

  test("trims file content", async () => {
    const dir = await makeTmpDir({ "padded.txt": "  hello world  \n" })
    cleanup.push(dir)
    const result = await expand(`{{ file="./padded.txt" }}`, dir, opts())
    expect(result).toBe("hello world")
  })

  test("~/... resolves to home-relative file", async () => {
    const tmpFile = path.join(os.homedir(), ".md-expand-test-tmp.txt")
    await fsp.writeFile(tmpFile, "HOME_MARKER", "utf8")
    cleanup.push(tmpFile)
    const result = await expand(`{{ file="~/.md-expand-test-tmp.txt" }}`, "/tmp", opts())
    expect(result).toBe("HOME_MARKER")
  })

  test("../... resolves relative to baseDir parent", async () => {
    const parent = await makeTmpDir({ "parent-marker.txt": "PARENT_MARKER" })
    const child = path.join(parent, "subdir")
    await fsp.mkdir(child, { recursive: true })
    cleanup.push(parent)
    const result = await expand(`{{ file="../parent-marker.txt" }}`, child, opts())
    expect(result).toBe("PARENT_MARKER")
  })

  test("nonexistent relative file returns empty string (ENOENT)", async () => {
    const dir = await makeTmpDir({})
    cleanup.push(dir)
    const result = await expand(`before{{ file="./nope.txt" }}after`, dir, opts())
    expect(result).toBe("beforeafter")
  })

  test("nonexistent absolute file returns empty string (ENOENT, no fallback)", async () => {
    const result = await expand(`{{ file="/tmp/md-expand-no-such-absolute.txt" }}`, "/tmp", opts())
    expect(result).toBe("")
  })

  test("multiple file templates in one string", async () => {
    const dir = await makeTmpDir({
      "a.txt": "AAA",
      "b.txt": "BBB",
    })
    cleanup.push(dir)
    const result = await expand(`{{ file="./a.txt" }} and {{ file="./b.txt" }}`, dir, opts())
    expect(result).toBe("AAA and BBB")
  })

  test("supports zero whitespace after opening and before closing braces", async () => {
    const dir = await makeTmpDir({ "marker.txt": "TIGHT" })
    cleanup.push(dir)
    const result = await expand(`{{file="./marker.txt"}}`, dir, opts())
    expect(result).toBe("TIGHT")
  })

  test("removes full line when file template expands empty", async () => {
    const dir = await makeTmpDir({})
    cleanup.push(dir)
    const result = await expand("before\n  {{ file=\"./missing.txt\" }}  \nafter", dir, opts())
    expect(result).toBe("before\nafter")
  })

  test("blanks inline file template when expansion is empty", async () => {
    const dir = await makeTmpDir({})
    cleanup.push(dir)
    const result = await expand(`before {{ file="./missing.txt" }} after`, dir, opts())
    expect(result).toBe("before  after")
  })

  test("removes multiline template block when false or missing", async () => {
    const dir = await makeTmpDir({})
    cleanup.push(dir)
    const result = await expand(
      `before\n{{\n  file="./missing.txt"\n}}\nafter`,
      dir,
      opts(),
    )
    expect(result).toBe("before\nafter")
  })
})

// ── expand: file template args and {{arg:...}} tokens ────────────────────────

describe("expand: file template args and {{arg:...}} tokens", () => {
  test("passes a basic arg into an embedded file", async () => {
    const dir = await makeTmpDir({ "tmpl.txt": "domain={{arg:domain}}" })
    cleanup.push(dir)
    const result = await expand(`{{ file="./tmpl.txt" domain=correctness }}`, dir, opts())
    expect(result).toBe("domain=correctness")
  })

  test("supports quoted arg values with spaces", async () => {
    const dir = await makeTmpDir({ "tmpl.txt": "value={{arg:key}}" })
    cleanup.push(dir)
    const result = await expand(`{{ file="./tmpl.txt" key="val with spaces" }}`, dir, opts())
    expect(result).toBe("value=val with spaces")
  })

  test("supports multiple args", async () => {
    const dir = await makeTmpDir({ "tmpl.txt": "{{arg:key1}}/{{arg:key2}}" })
    cleanup.push(dir)
    const result = await expand(`{{ file="./tmpl.txt" key1=a key2=b }}`, dir, opts())
    expect(result).toBe("a/b")
  })

  test("supports multiline file templates with whitespace between attrs", async () => {
    const dir = await makeTmpDir({ "tmpl.txt": "{{arg:key1}}/{{arg:key2}}" })
    cleanup.push(dir)
    const result = await expand(
      `{{
        file = "./tmpl.txt"
        key1 = "a value"
        key2 = b
      }}`,
      dir,
      opts(),
    )
    expect(result).toBe("a value/b")
  })

  test("decodes common escapes in template args", async () => {
    const dir = await makeTmpDir({ "tmpl.txt": "{{arg:lines}}|{{arg:tab}}|{{arg:quote}}|{{arg:slash}}" })
    cleanup.push(dir)
    const result = await expand(
      `{{ file="./tmpl.txt" lines="one\\ntwo" tab=a\\tb quote="say \\"hi\\"" slash="a\\\\b" }}`,
      dir,
      opts(),
    )
    expect(result).toBe("one\ntwo|a\tb|say \"hi\"|a\\b")
  })

  test("unrecognized escapes drop the backslash (backtick, letters)", async () => {
    const dir = await makeTmpDir({ "tmpl.txt": "{{arg:a}}|{{arg:b}}" })
    cleanup.push(dir)
    const bt = "`"
    const result = await expand(
      `{{ file="./tmpl.txt" a="\\${bt}x\\${bt}" b="\\z" }}`,
      dir,
      opts(),
    )
    expect(result).toBe("`x`|z")
  })

  test("undefined args resolve to empty string", async () => {
    const dir = await makeTmpDir({ "tmpl.txt": "before[{{arg:missing}}]after" })
    cleanup.push(dir)
    const result = await expand(`{{ file="./tmpl.txt" }}`, dir, opts())
    expect(result).toBe("before[]after")
  })

  test("undefined arg removes full line when alone", async () => {
    const dir = await makeTmpDir({ "tmpl.txt": "before\n{{arg:missing}}\nafter" })
    cleanup.push(dir)
    const result = await expand(`{{ file="./tmpl.txt" }}`, dir, opts())
    expect(result).toBe("before\nafter")
  })

  test("args can compose nested file paths", async () => {
    const dir = await makeTmpDir({
      "tmpl.txt": `{{ file="./rules/{{arg:topic}}.md" }}`,
      "rules/testing.md": "TEST_RULE",
    })
    cleanup.push(dir)
    const result = await expand(`{{ file="./tmpl.txt" topic=testing }}`, dir, opts())
    expect(result).toBe("TEST_RULE")
  })

  test("nested files without args do not inherit parent args", async () => {
    const dir = await makeTmpDir({
      "outer.txt": `outer={{arg:key}}; inner={{ file="./inner.txt" }}`,
      "inner.txt": "inner={{arg:key}}",
    })
    cleanup.push(dir)
    const result = await expand(`{{ file="./outer.txt" key=OUTER }}`, dir, opts())
    expect(result).toBe("outer=OUTER; inner=inner=")
  })

  test("nested files receive only their own args", async () => {
    const dir = await makeTmpDir({
      "outer.txt": `outer={{arg:key}}; inner={{ file="./inner.txt" key=INNER other=2 }}`,
      "inner.txt": "inner={{arg:key}}/{{arg:other}}/{{arg:missing}}",
    })
    cleanup.push(dir)
    const result = await expand(`{{ file="./outer.txt" key=OUTER other=1 }}`, dir, opts())
    expect(result).toBe("outer=OUTER; inner=inner=INNER/2/")
  })

  test("supports quoted file paths with spaces", async () => {
    const dir = await makeTmpDir({ "path with spaces.txt": "{{arg:key}}" })
    cleanup.push(dir)
    const result = await expand(`{{ file="./path with spaces.txt" key=val }}`, dir, opts())
    expect(result).toBe("val")
  })

  test("duplicate arg keys use the last value", async () => {
    const dir = await makeTmpDir({ "tmpl.txt": "{{arg:key}}" })
    cleanup.push(dir)
    const result = await expand(`{{ file="./tmpl.txt" key=a key=b }}`, dir, opts())
    expect(result).toBe("b")
  })

  test("arg values containing env tokens remain literal", async () => {
    const dir = await makeTmpDir({ "tmpl.txt": "{{arg:key}}" })
    cleanup.push(dir)
    const restore = withEnv("MD_EXPAND_ARG_LITERAL", "EXPANDED")
    try {
      const result = await expand(`{{ file="./tmpl.txt" key="{{env:MD_EXPAND_ARG_LITERAL}}" }}`, dir, opts())
      expect(result).toBe("{{env:MD_EXPAND_ARG_LITERAL}}")
    } finally {
      restore()
    }
  })

  test("arg values containing file templates remain literal", async () => {
    const dir = await makeTmpDir({
      "tmpl.txt": "{{arg:key}}",
      "secret.txt": "SHOULD_NOT_EXPAND",
    })
    cleanup.push(dir)
    const result = await expand(`{{ file="./tmpl.txt" key="{{ file=\\\"./secret.txt\\\" }}" }}`, dir, opts())
    expect(result).toBe(`{{ file="./secret.txt" }}`)
  })

  test("arg tokens in arg values cascade from parent scope", async () => {
    const dir = await makeTmpDir({
      "outer.txt": `{{ file="./inner.txt" x="{{arg:subject}}" }}`,
      "inner.txt": "x={{arg:x}}",
    })
    cleanup.push(dir)
    const result = await expand(`{{ file="./outer.txt" subject=hello }}`, dir, opts())
    expect(result).toBe("x=hello")
  })

  test("file templates work with zero args", async () => {
    const dir = await makeTmpDir({ "plain.txt": "PLAIN" })
    cleanup.push(dir)
    const result = await expand(`{{ file="./plain.txt" }}`, dir, opts())
    expect(result).toBe("PLAIN")
  })

  test("expands {{arg:key}} from initialArgs", async () => {
    const result = await expand("Hello {{arg:name}}!", "/tmp", opts({ initialArgs: { name: "World" } }))
    expect(result).toBe("Hello World!")
  })

  test("blank for undefined arg from initialArgs", async () => {
    const result = await expand("Hello {{arg:missing}}!", "/tmp", opts())
    expect(result).toBe("Hello !")
  })
})

// ── expand: file template if conditions ─────────────────────────────────────

describe("expand: file template if conditions", () => {
  test("if=arg includes when arg is non-empty", async () => {
    const dir = await makeTmpDir({
      "outer.txt": "before\n{{ file=\"./extra.txt\" if=include_extra }}\nafter",
      "extra.txt": "EXTRA",
    })
    cleanup.push(dir)
    const result = await expand(`{{ file="./outer.txt" include_extra=1 }}`, dir, opts())
    expect(result).toBe("before\nEXTRA\nafter")
  })

  test("if=arg removes line when arg is absent", async () => {
    const dir = await makeTmpDir({
      "outer.txt": "before\n{{ file=\"./extra.txt\" if=include_extra }}\nafter",
      "extra.txt": "EXTRA",
    })
    cleanup.push(dir)
    const result = await expand(`{{ file="./outer.txt" }}`, dir, opts())
    expect(result).toBe("before\nafter")
  })

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
    })
    cleanup.push(dir)

    const cached = await expand(`{{ file="./outer.txt" mode=cached }}`, dir, opts())
    const cacheless = await expand(`{{ file="./outer.txt" mode=cacheless }}`, dir, opts())

    expect(cached).toBe("start\nCACHED\nend")
    expect(cacheless).toBe("start\nCACHELESS\nend")
  })

  test("if condition can use same-template args", async () => {
    const dir = await makeTmpDir({ "extra.txt": "EXTRA" })
    cleanup.push(dir)
    const result = await expand(`{{ file="./extra.txt" if=mode==cached mode=cached }}`, dir, opts())
    expect(result).toBe("EXTRA")
  })

  test("false if does not read file", async () => {
    const dir = await makeTmpDir({
      "outer.txt": "before\n{{ file=\"./missing.txt\" if=mode==cached }}\nafter",
    })
    cleanup.push(dir)
    const result = await expandWithDiagnostics(`{{ file="./outer.txt" mode=cacheless }}`, dir, opts())
    expect(result.text).toBe("before\nafter")
    expect(result.diagnostics).toEqual([])
  })

  test("invalid if condition leaves template literal for validation", async () => {
    const dir = await makeTmpDir({ "extra.txt": "EXTRA" })
    cleanup.push(dir)
    const result = await expand(`{{ file="./extra.txt" if=mode=bad }}`, dir, opts())
    expect(result).toBe(`{{ file="./extra.txt" if=mode=bad }}`)
  })
})

// ── expand: inline conditional blocks ────────────────────────────────────────

describe("expand: inline conditional blocks", () => {
  test("if=arg includes block when scoped arg is non-empty", async () => {
    const dir = await makeTmpDir({
      "outer.txt": "before\n{{ if=include_extra }}\nEXTRA\n{{ endif }}\nafter",
    })
    cleanup.push(dir)
    const result = await expand(`{{ file="./outer.txt" include_extra=1 }}`, dir, opts())
    expect(result).toBe("before\nEXTRA\nafter")
  })

  test("if=arg removes block when scoped arg is absent", async () => {
    const dir = await makeTmpDir({
      "outer.txt": "before\n{{ if=include_extra }}\nEXTRA\n{{ endif }}\nafter",
    })
    cleanup.push(dir)
    const result = await expand(`{{ file="./outer.txt" }}`, dir, opts())
    expect(result).toBe("before\nafter")
  })

  test("if=arg with empty string arg is equivalent to omitted arg", async () => {
    const dir = await makeTmpDir({
      "outer.txt": "before\n{{ if=flag }}\nFLAG\n{{ endif }}\nafter",
    })
    cleanup.push(dir)
    const omitted = await expand(`{{ file="./outer.txt" }}`, dir, opts())
    const empty = await expand(`{{ file="./outer.txt" flag="" }}`, dir, opts())
    expect(empty).toBe(omitted)
    expect(empty).toBe("before\nafter")
  })

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
    })
    cleanup.push(dir)

    const cached = await expand(`{{ file="./outer.txt" mode=cached }}`, dir, opts())
    const cacheless = await expand(`{{ file="./outer.txt" mode=cacheless }}`, dir, opts())

    expect(cached).toBe("start\nCACHED\nend")
    expect(cacheless).toBe("start\nCACHELESS\nend")
  })

  test("if=env:VAR includes block when env var is non-empty", async () => {
    const restore = withEnv("MD_EXPAND_INLINE_ENV", "enabled")
    try {
      const result = await expand(
        "before\n{{ if=env:MD_EXPAND_INLINE_ENV }}\nENV\n{{ endif }}\nafter",
        "/tmp",
        opts(),
      )
      expect(result).toBe("before\nENV\nafter")
    } finally {
      restore()
    }
  })

  test("if=env:VAR==value includes only exact env matches", async () => {
    const restore = withEnv("MD_EXPAND_INLINE_MODE", "cached")
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
      )
      expect(result).toBe("start\nCACHED\nend")
    } finally {
      restore()
    }
  })

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
    })
    cleanup.push(dir)

    const both = await expand(`{{ file="./outer.txt" outer=1 inner=1 }}`, dir, opts())
    const outerOnly = await expand(`{{ file="./outer.txt" outer=1 }}`, dir, opts())

    expect(both).toBe("start\nOUTER\nINNER\nDONE\nend")
    expect(outerOnly).toBe("start\nOUTER\nDONE\nend")
  })

  test("false inline block does not read file imports inside", async () => {
    const dir = await makeTmpDir({
      "outer.txt": "before\n{{ if=mode==cached }}\n{{ file=\"./missing.txt\" }}\n{{ endif }}\nafter",
    })
    cleanup.push(dir)
    const result = await expandWithDiagnostics(`{{ file="./outer.txt" mode=cacheless }}`, dir, opts())
    expect(result.text).toBe("before\nafter")
    expect(result.diagnostics).toEqual([])
  })

  test("inline blocks can be used within a single line", async () => {
    const dir = await makeTmpDir({ "outer.txt": "prefix {{ if=mode==cached }}CACHED{{ endif }} suffix" })
    cleanup.push(dir)
    const result = await expand(`{{ file="./outer.txt" mode=cached }}`, dir, opts())
    expect(result).toBe("prefix CACHED suffix")
  })

  test("inline conditional markers in arg values remain literal", async () => {
    const dir = await makeTmpDir({ "tmpl.txt": "{{arg:snippet}}" })
    cleanup.push(dir)
    const result = await expand(
      `{{ file="./tmpl.txt" snippet="{{ if=flag }}YES{{ endif }}" flag=1 }}`,
      dir,
      opts(),
    )
    expect(result).toBe("{{ if=flag }}YES{{ endif }}")
  })

  test("invalid inline condition stays literal for validation", async () => {
    const result = await expand("before\n{{ if=mode=bad }}\nX\n{{ endif }}\nafter", "/tmp", opts())
    expect(result).toBe("before\n{{ if=mode=bad }}\nX\n{{ endif }}\nafter")
  })

  test("unclosed inline condition stays literal for validation", async () => {
    const result = await expand("before\n{{ if=flag }}\nX", "/tmp", opts())
    expect(result).toBe("before\n{{ if=flag }}\nX")
  })

  test("if/else/endif: includes true branch when arg is non-empty", async () => {
    const dir = await makeTmpDir({
      "outer.txt": "before\n{{ if=flag }}\nTRUE\n{{ else }}\nFALSE\n{{ endif }}\nafter",
    })
    cleanup.push(dir)
    const result = await expand(`{{ file="./outer.txt" flag=1 }}`, dir, opts())
    expect(result).toBe("before\nTRUE\nafter")
  })

  test("if/else/endif: includes false branch when arg is absent", async () => {
    const dir = await makeTmpDir({
      "outer.txt": "before\n{{ if=flag }}\nTRUE\n{{ else }}\nFALSE\n{{ endif }}\nafter",
    })
    cleanup.push(dir)
    const result = await expand(`{{ file="./outer.txt" }}`, dir, opts())
    expect(result).toBe("before\nFALSE\nafter")
  })

  test("if/else/endif: inline else on a single line", async () => {
    const dir = await makeTmpDir({
      "outer.txt": "prefix {{ if=mode==cached }}CACHED{{ else }}CACHELESS{{ endif }} suffix",
    })
    cleanup.push(dir)
    const cached = await expand(`{{ file="./outer.txt" mode=cached }}`, dir, opts())
    const cacheless = await expand(`{{ file="./outer.txt" mode=cacheless }}`, dir, opts())
    expect(cached).toBe("prefix CACHED suffix")
    expect(cacheless).toBe("prefix CACHELESS suffix")
  })

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
    })
    cleanup.push(dir)
    const both = await expand(`{{ file="./outer.txt" outer=1 inner=1 }}`, dir, opts())
    const outerOnly = await expand(`{{ file="./outer.txt" outer=1 }}`, dir, opts())
    const neither = await expand(`{{ file="./outer.txt" }}`, dir, opts())
    expect(both).toBe("start\nOUTER-TRUE\nINNER\nend")
    expect(outerOnly).toBe("start\nOUTER-TRUE\nend")
    expect(neither).toBe("start\nOUTER-FALSE\nend")
  })

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
    })
    cleanup.push(dir)
    const withInner = await expand(`{{ file="./outer.txt" inner=1 }}`, dir, opts())
    const withoutInner = await expand(`{{ file="./outer.txt" }}`, dir, opts())
    expect(withInner).toBe("start\nFALSE\nINNER\nend")
    expect(withoutInner).toBe("start\nFALSE\nend")
  })

  test("if/else/endif: false branch does not read file imports inside", async () => {
    const dir = await makeTmpDir({
      "outer.txt": "before\n{{ if=flag }}\n{{ file=\"./missing.txt\" }}\n{{ else }}\nFALLBACK\n{{ endif }}\nafter",
    })
    cleanup.push(dir)
    const result = await expandWithDiagnostics(`{{ file="./outer.txt" }}`, dir, opts())
    expect(result.text).toBe("before\nFALLBACK\nafter")
    expect(result.diagnostics).toEqual([])
  })

  // ── inline conditionals with initialArgs (no file wrapping) ──

  test("includes block when initialArgs arg is truthy", async () => {
    const result = await expand("{{ if=DEBUG }}debug on{{ endif }}", "/tmp", opts({ initialArgs: { DEBUG: "1" } }))
    expect(result).toBe("debug on")
  })

  test("removes block when initialArgs arg is empty", async () => {
    const result = await expand("{{ if=DEBUG }}debug on{{ endif }}", "/tmp", opts())
    expect(result.trim()).toBe("")
  })

  test("includes true branch with else from initialArgs", async () => {
    const result = await expand("{{ if=mode==cached }}Cached{{ else }}Live{{ endif }}", "/tmp", opts({ initialArgs: { mode: "cached" } }))
    expect(result).toBe("Cached")
  })

  test("includes false branch with else from initialArgs", async () => {
    const result = await expand("{{ if=mode==cached }}Cached{{ else }}Live{{ endif }}", "/tmp", opts({ initialArgs: { mode: "live" } }))
    expect(result).toBe("Live")
  })

  test("removes block when if=env:VAR is unset", async () => {
    const result = await expand("{{ if=env:NONEXISTENT }}got it{{ endif }}", "/tmp", opts())
    expect(result.trim()).toBe("")
  })
})

// ── expand: mixed tokens ──────────────────────────────────────────────────────

describe("expand: mixed {{env:...}} and file templates", () => {
  test("env tokens and file templates both expand in same string", async () => {
    const dir = await makeTmpDir({ "name.txt": "Alice" })
    cleanup.push(dir)
    const restore = withEnv("MD_EXPAND_TEST_REGION", "us-west")
    try {
      const result = await expand(
        `name={{ file="./name.txt" }} region={{env:MD_EXPAND_TEST_REGION}}`,
        dir,
        opts(),
      )
      expect(result).toBe("name=Alice region=us-west")
    } finally {
      restore()
    }
  })

  test("env values may inject file templates (env expands before file)", async () => {
    const dir = await makeTmpDir({ "from-env.txt": "ENV_TO_FILE_MARKER" })
    cleanup.push(dir)
    const restore = withEnv("MD_EXPAND_TEST_FILE_TOKEN", `{{ file="./from-env.txt" }}`)
    try {
      const result = await expand(`value={{env:MD_EXPAND_TEST_FILE_TOKEN}}`, dir, opts())
      expect(result).toBe("value=ENV_TO_FILE_MARKER")
    } finally {
      restore()
    }
  })
})

// ── expand: no tokens ─────────────────────────────────────────────────────────

describe("expand: no tokens", () => {
  test("returns text unchanged when no tokens present", async () => {
    const result = await expand("plain text with no tokens", "/tmp", opts())
    expect(result).toBe("plain text with no tokens")
  })

  test("returns text unchanged when only plain variable references", async () => {
    const result = await expand("path=GENERAL_RULES_PATH home=$HOME", "/tmp", opts())
    expect(result).toBe("path=GENERAL_RULES_PATH home=$HOME")
  })

  test("leaves empty env token form unchanged", async () => {
    const result = await expand(`empty {{env:}}`, "/tmp", opts())
    expect(result).toBe(`empty {{env:}}`)
  })

  test("blanks empty file template path", async () => {
    const result = await expand(`empty {{ file="" }}`, "/tmp", opts())
    expect(result).toBe("empty ")
  })

  test("leaves unclosed token forms unchanged", async () => {
    const result = await expand(`broken {{env:FOO and {{ file="./x.txt"`, "/tmp", opts())
    expect(result).toBe(`broken {{env:FOO and {{ file="./x.txt"`)
  })
})

// ── expand: config-dir fallback ────────────────────────────────────────────────

describe("expand: config-dir fallback", () => {
  test("relative file template falls back to configDir when not found in baseDir", async () => {
    const configDir = await makeTmpDir({
      ".opencode/shared-rules.md": "FALLBACK_MARKER",
    })
    cleanup.push(configDir)

    const fakeDir = await makeTmpDir({})
    cleanup.push(fakeDir)

    const result = await expand(
      `{{ file="./.opencode/shared-rules.md" }}`,
      fakeDir,
      opts({ configDirs: [configDir] }),
    )
    expect(result).toBe("FALLBACK_MARKER")
  })

  test("fallback NOT used when file exists in baseDir", async () => {
    const configDir = await makeTmpDir({
      ".opencode/test-fallback.txt": "SHOULD_NOT_SEE_THIS",
    })
    cleanup.push(configDir)

    const dir = await makeTmpDir({ ".opencode/test-fallback.txt": "PRIMARY_MARKER" })
    cleanup.push(dir)

    const result = await expand(
      `{{ file="./.opencode/test-fallback.txt" }}`,
      dir,
      opts({ configDirs: [configDir] }),
    )
    expect(result).toBe("PRIMARY_MARKER")
  })
})

// ── expand: repeated-call safety ──────────────────────────────────────────────

describe("expand: repeated-call safety", () => {
  test("calling expand twice on same strings works (no stale lastIndex)", async () => {
    const dir = await makeTmpDir({ "x.txt": "X" })
    cleanup.push(dir)
    const text = `value={{ file="./x.txt" }}`

    const result1 = await expand(text, dir, opts())
    const result2 = await expand(text, dir, opts())
    expect(result1).toBe("value=X")
    expect(result2).toBe("value=X")
  })
})

// ── expandWithDiagnostics ────────────────────────────────────────────────────

describe("expandWithDiagnostics", () => {
  test("reports missing files while rendering empty", async () => {
    const dir = await makeTmpDir({})
    cleanup.push(dir)
    const result = await expandWithDiagnostics(`{{ file="./missing.txt" }}`, dir, opts())
    expect(result.text).toBe("")
    expect(result.diagnostics).toHaveLength(1)
    expect(result.diagnostics[0].kind).toBe("missing-file")
    expect(result.diagnostics[0].rawPath).toBe("./missing.txt")
  })

  test("reports empty file template paths", async () => {
    const result = await expandWithDiagnostics(`{{ file="" }}`, "/tmp", opts())
    expect(result.text).toBe("")
    expect(result.diagnostics).toHaveLength(1)
    expect(result.diagnostics[0].kind).toBe("empty-file")
  })

  test("detects cycles", async () => {
    const dir = await makeTmpDir({
      "cycle-a.md": `A: {{ file="./cycle-b.md" }}`,
      "cycle-b.md": `B: {{ file="./cycle-a.md" }}`,
    })
    cleanup.push(dir)
    const { diagnostics } = await expandWithDiagnostics(
      `{{ file="./cycle-a.md" }}`,
      dir,
      opts(),
    )
    expect(diagnostics.some(d => d.kind === "cycle")).toBe(true)
  })
})

// ── expand: recursive file templates ─────────────────────────────────────────

describe("expand: recursive file templates", () => {
  test("recursively expands file templates in imported content", async () => {
    const dir = await makeTmpDir({
      "inner.txt": "INNER_CONTENT",
      "outer.txt": `outer: {{ file="./inner.txt" }}`,
    })
    cleanup.push(dir)
    const result = await expand(`{{ file="./outer.txt" }}`, dir, opts())
    expect(result).toBe("outer: INNER_CONTENT")
  })

  test("expands multi-level chain (3 deep)", async () => {
    const dir = await makeTmpDir({
      "c.txt": "C_VALUE",
      "b.txt": `B:{{ file="./c.txt" }}`,
      "a.txt": `A:{{ file="./b.txt" }}`,
    })
    cleanup.push(dir)
    const result = await expand(`{{ file="./a.txt" }}`, dir, opts())
    expect(result).toBe("A:B:C_VALUE")
  })

  test("detects self-referential cycle and replaces with empty string", async () => {
    const dir = await makeTmpDir({
      "loop.txt": `start {{ file="./loop.txt" }} end`,
    })
    cleanup.push(dir)
    const result = await expand(`{{ file="./loop.txt" }}`, dir, opts())
    expect(result).toBe("start  end")
  })

  test("missing file within recursive chain resolves to empty string", async () => {
    const dir = await makeTmpDir({
      "outer.txt": `prefix {{ file="./missing.txt" }} suffix`,
    })
    cleanup.push(dir)
    const result = await expand(`{{ file="./outer.txt" }}`, dir, opts())
    expect(result).toBe("prefix  suffix")
  })

  test("detects mutual cycle (A→B→A) and breaks it", async () => {
    const dir = await makeTmpDir({
      "a.txt": `A-{{ file="./b.txt" }}`,
      "b.txt": `B-{{ file="./a.txt" }}`,
    })
    cleanup.push(dir)
    const result = await expand(`{{ file="./a.txt" }}`, dir, opts())
    expect(result).toBe("A-B-")
  })

  test("sibling tokens referencing same file both resolve (diamond pattern)", async () => {
    const dir = await makeTmpDir({
      "shared.txt": "SHARED",
      "top.txt": `{{ file="./shared.txt" }} and {{ file="./shared.txt" }}`,
    })
    cleanup.push(dir)
    const result = await expand(`{{ file="./top.txt" }}`, dir, opts())
    expect(result).toBe("SHARED and SHARED")
  })

  test("expands chain exactly MAX_DEPTH levels deep", async () => {
    const files: Record<string, string> = {}
    for (let i = 0; i < MAX_DEPTH; i++) {
      if (i === MAX_DEPTH - 1) {
        files[`d${i}.txt`] = `LEAF`
      } else {
        files[`d${i}.txt`] = `D${i}:{{ file="./d${i + 1}.txt" }}`
      }
    }
    const dir = await makeTmpDir(files)
    cleanup.push(dir)
    const result = await expand(`{{ file="./d0.txt" }}`, dir, opts())
    expect(result).toContain("LEAF")
  })

  test("at MAX_DEPTH, leaves unexpanded file templates as literal text", async () => {
    const files: Record<string, string> = {}
    for (let i = 0; i < MAX_DEPTH; i++) {
      if (i === MAX_DEPTH - 1) {
        files[`e${i}.txt`] = `DEEP_{{ file="./e-leaf.txt" }}_{{env:MD_EXPAND_DEPTH_ENV}}`
      } else {
        files[`e${i}.txt`] = `E${i}:{{ file="./e${i + 1}.txt" }}`
      }
    }
    files["e-leaf.txt"] = `NEVER_READ`
    const dir = await makeTmpDir(files)
    cleanup.push(dir)
    const restore = withEnv("MD_EXPAND_DEPTH_ENV", "YES")
    try {
      const result = await expand(`{{ file="./e0.txt" }}`, dir, opts())
      expect(result).toContain("DEEP_")
      expect(result).toContain(`{{ file="./e-leaf.txt" }}`)
      expect(result).toContain("YES")
      expect(result).not.toContain("NEVER_READ")
    } finally {
      restore()
    }
  })

  test("expands {{env:...}} inside recursively imported content", async () => {
    const dir = await makeTmpDir({
      "with-env.txt": "region={{env:MD_EXPAND_RECURSE_ENV}}",
    })
    cleanup.push(dir)
    const restore = withEnv("MD_EXPAND_RECURSE_ENV", "eu-west")
    try {
      const result = await expand(`{{ file="./with-env.txt" }}`, dir, opts())
      expect(result).toBe("region=eu-west")
    } finally {
      restore()
    }
  })

  test("skips recursive expansion when imported file has no tokens", async () => {
    const dir = await makeTmpDir({
      "plain.txt": "NO_TOKENS_HERE",
    })
    cleanup.push(dir)
    const result = await expand(`{{ file="./plain.txt" }}`, dir, opts())
    expect(result).toBe("NO_TOKENS_HERE")
  })

  test("readCache deduplicates raw I/O for same path across branches", async () => {
    const dir = await makeTmpDir({
      "shared.txt": "SHARED",
      "ref-a.txt": `A:{{ file="./shared.txt" }}`,
      "ref-b.txt": `B:{{ file="./shared.txt" }}`,
      "top.txt": `{{ file="./ref-a.txt" }} | {{ file="./ref-b.txt" }}`,
    })
    cleanup.push(dir)
    const result = await expand(`{{ file="./top.txt" }}`, dir, opts())
    expect(result).toBe("A:SHARED | B:SHARED")
  })

  test("expansion is independent per ancestor chain (no cross-contamination)", async () => {
    const dir = await makeTmpDir({
      "shared.txt": `S:{{ file="./ref-a.txt" }}`,
      "ref-a.txt": "A_CONTENT",
      "ref-b.txt": `B:{{ file="./shared.txt" }}`,
      "top.txt": `{{ file="./ref-a.txt" }} | {{ file="./ref-b.txt" }}`,
    })
    cleanup.push(dir)
    const result = await expand(`{{ file="./top.txt" }}`, dir, opts())
    expect(result).toBe("A_CONTENT | B:S:A_CONTENT")
  })
})

// ── expand: include boundary whitespace ────────────────────────────────────────

describe("expand: include boundary whitespace", () => {
  test("standalone file include does not produce double blank lines at boundary", async () => {
    const dir = await makeTmpDir({
      "header.txt": `Step 1\nStep 2\nStep 3`,
      "main.md": `{{ file="./header.txt" }}\n\nStep 4`,
    })
    cleanup.push(dir)
    const result = await expand(`{{ file="./main.md" }}`, dir, opts())
    expect(result).toBe("Step 1\nStep 2\nStep 3\n\nStep 4")
  })

  test("file include ending with conditional does not produce double blank lines", async () => {
    const dir = await makeTmpDir({
      "header.txt": `Step 1\nStep 2\nStep 3\n{{ if=show_extra }}\nExtra\n{{ endif }}`,
      "main.md": `{{ file="./header.txt" }}\n\nStep 4`,
    })
    cleanup.push(dir)
    const result = await expand(`{{ file="./main.md" }}`, dir, opts())
    expect(result).toBe("Step 1\nStep 2\nStep 3\n\nStep 4")
  })

  test("file include with if/else at end does not produce double blank lines", async () => {
    const dir = await makeTmpDir({
      "footer.txt": `Step 5\n{{ if=pointer }}\nPointer\n{{ else }}\nFull\n{{ endif }}`,
      "main.md": `Step 4\n\n{{ file="./footer.txt" }}\n\n# Output`,
    })
    cleanup.push(dir)
    const result = await expand(`{{ file="./main.md" }}`, dir, opts())
    expect(result).toBe("Step 4\n\nStep 5\nFull\n\n# Output")
  })

  test("inline file include (not on own line) is unaffected", async () => {
    const dir = await makeTmpDir({
      "name.txt": `Alice\n`,
      "main.md": `Hello {{ file="./name.txt" }}!`,
    })
    cleanup.push(dir)
    const result = await expand(`{{ file="./main.md" }}`, dir, opts())
    expect(result).toBe("Hello Alice!")
  })

  test("multiple file includes in sequence do not accumulate extra blank lines", async () => {
    const dir = await makeTmpDir({
      "a.txt": `A-content`,
      "b.txt": `B-content`,
      "c.txt": `C-content`,
      "main.md": `{{ file="./a.txt" }}\n{{ file="./b.txt" }}\n{{ file="./c.txt" }}`,
    })
    cleanup.push(dir)
    const result = await expand(`{{ file="./main.md" }}`, dir, opts())
    expect(result).toBe("A-content\nB-content\nC-content")
  })

  test("deeply nested includes do not produce double blank lines at any boundary", async () => {
    const dir = await makeTmpDir({
      "inner.txt": `Inner-content`,
      "middle.txt": `Middle-before\n{{ file="./inner.txt" }}\nMiddle-after`,
      "outer.md": `Outer-before\n{{ file="./middle.txt" }}\nOuter-after`,
    })
    cleanup.push(dir)
    const result = await expand(`{{ file="./outer.md" }}`, dir, opts())
    expect(result).toBe("Outer-before\nMiddle-before\nInner-content\nMiddle-after\nOuter-after")
  })
})

// ── expand: depth limit ──────────────────────────────────────────────────────

describe("expand: depth limit", () => {
  test("leaves file templates literal at maxDepth=0", async () => {
    const dir = await makeTmpDir({
      "greeting.md": "Hello {{arg:name}}!",
      "double.md": `Top\n{{ file="./.opencode/greeting.md" name=World }}\nBottom`,
    })
    cleanup.push(dir)
    const result = await expand('{{ file="./double.md" }}', dir, opts({ maxDepth: 0 }))
    expect(result.includes("{{ file=")).toBe(true)
  })
})

// ── expand: line cleanup ──────────────────────────────────────────────────────

describe("line cleanup", () => {
  test("removes marker-only lines", async () => {
    const result = await expand("Line before\n{{arg:missing}}\nLine after", "/tmp", opts())
    const lines = result.split("\n")
    expect(lines.length).toBe(2)
    expect(lines[0]).toBe("Line before")
    expect(lines[1]).toBe("Line after")
  })
})
