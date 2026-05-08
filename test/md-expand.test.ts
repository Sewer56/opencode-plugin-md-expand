import { describe, it, expect, beforeAll, afterAll } from "bun:test"
import path from "node:path"
import fs from "node:fs"
import os from "node:os"
import {
  expand,
  expandWithDiagnostics,
  hasExpandableToken,
  MAX_DEPTH,
  resolvePath,
  resolveMdExpandOptions,
} from "../src/index"

const tmpBase = path.join(os.tmpdir(), "opencode-plugin-md-expand-test-" + Date.now())
const projectDir = path.join(tmpBase, "project")
const configDir = path.join(tmpBase, "config")

beforeAll(() => {
  fs.mkdirSync(tmpBase, { recursive: true })
  fs.mkdirSync(projectDir, { recursive: true })
  fs.mkdirSync(path.join(projectDir, ".opencode"), { recursive: true })
  fs.mkdirSync(configDir, { recursive: true })
  fs.mkdirSync(path.join(configDir, ".opencode"), { recursive: true })

  // Write a test template file in the project
  fs.writeFileSync(path.join(projectDir, ".opencode", "greeting.md"), "Hello {{arg:name}}!")
  fs.writeFileSync(path.join(projectDir, ".opencode", "env-test.md"), "Region: {{env:TEST_REGION}}")
  fs.writeFileSync(path.join(projectDir, ".opencode", "double-include.md"), `Top
{{ file="./.opencode/greeting.md" name=World }}
Bottom`)
  fs.writeFileSync(path.join(projectDir, ".opencode", "cycle-a.md"), `A: {{ file="./.opencode/cycle-b.md" }}`)
  fs.writeFileSync(path.join(projectDir, ".opencode", "cycle-b.md"), `B: {{ file="./.opencode/cycle-a.md" }}`)
  fs.writeFileSync(path.join(projectDir, ".opencode", "conditional.md"), `{{ if=DEBUG }}
Debug mode
{{ endif }}`)
  fs.writeFileSync(path.join(projectDir, ".opencode", "conditional-else.md"), `{{ if=mode==cached }}
Cached
{{ else }}
Live
{{ endif }}`)
  fs.writeFileSync(path.join(projectDir, ".opencode", "with-args.md"), `Path: {{arg:path}}
Name: {{arg:name}}`)
  fs.writeFileSync(path.join(projectDir, ".opencode", "invalid-key.md"), `{{ file="./greeting.md" invalid-key=value }}`)

  // Config dir file (for fallback)
  fs.writeFileSync(path.join(configDir, ".opencode", "shared-rules.md"), "Shared rules content")

  process.env.TEST_REGION = "us-west-2"
})

afterAll(() => {
  delete process.env.TEST_REGION
  fs.rmSync(tmpBase, { recursive: true, force: true })
})

// ── hasExpandableToken ────────────────────────────────────────────────────────

describe("hasExpandableToken", () => {
  it("returns false for plain text", () => {
    expect(hasExpandableToken("Hello world")).toBe(false)
  })
  it("detects {{arg:key}}", () => {
    expect(hasExpandableToken("{{arg:name}}")).toBe(true)
  })
  it("detects {{env:VAR}}", () => {
    expect(hasExpandableToken("{{env:HOME}}")).toBe(true)
  })
  it("detects {{ file=\"...\" }}", () => {
    expect(hasExpandableToken('{{ file="./test.md" }}')).toBe(true)
  })
  it("detects inline {{ if=... }}", () => {
    expect(hasExpandableToken("{{ if=DEBUG }}")).toBe(true)
  })
  it("returns false for single braces", () => {
    expect(hasExpandableToken("{not-a-token}")).toBe(false)
  })
})

// ── resolvePath ──────────────────────────────────────────────────────────────

describe("resolvePath", () => {
  it("resolves ~/ paths", () => {
    const result = resolvePath("~/test.txt", "/base")
    expect(result).toBe(path.join(os.homedir(), "test.txt"))
  })
  it("resolves ./ relative paths", () => {
    const result = resolvePath("./sub/file.txt", "/base")
    expect(result).toBe(path.resolve("/base", "./sub/file.txt"))
  })
  it("resolves ../ relative paths", () => {
    const result = resolvePath("../other/file.txt", "/base/project")
    expect(result).toBe(path.resolve("/base/project", "../other/file.txt"))
  })
  it("keeps absolute paths", () => {
    expect(resolvePath("/abs/path.txt", "/base")).toBe("/abs/path.txt")
  })
})

// ── resolveMdExpandOptions ────────────────────────────────────────────────────

describe("resolveMdExpandOptions", () => {
  it("returns defaults", () => {
    const opts = resolveMdExpandOptions()
    expect(opts.maxDepth).toBe(MAX_DEPTH)
    expect(opts.debug).toBe(false)
    expect(opts.configDirs).toEqual([])
    expect(opts.initialArgs).toBeInstanceOf(Map)
  })
  it("merges custom options", () => {
    const opts = resolveMdExpandOptions({ maxDepth: 3, debug: true, configDirs: ["/foo"], initialArgs: { x: "1" } })
    expect(opts.maxDepth).toBe(3)
    expect(opts.debug).toBe(true)
    expect(opts.configDirs).toEqual([path.resolve("/foo")])
    expect(opts.initialArgs.get("x")).toBe("1")
  })
  it("enables debug via legacy env var", () => {
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

// ── expand: arg tokens ────────────────────────────────────────────────────────

describe("expand: arg tokens", () => {
  it("expands {{arg:key}} from scoped args", async () => {
    const result = await expand("Hello {{arg:name}}!", projectDir, resolveMdExpandOptions({ configDirs: [configDir], initialArgs: { name: "World" } }))
    expect(result).toBe("Hello World!")
  })
  it("blank for undefined arg", async () => {
    const result = await expand("Hello {{arg:missing}}!", projectDir, resolveMdExpandOptions({ configDirs: [configDir] }))
    expect(result).toBe("Hello !")
  })
})

// ── expand: env tokens ────────────────────────────────────────────────────────

describe("expand: env tokens", () => {
  it("expands {{env:VAR}}", async () => {
    const result = await expand("Region: {{env:TEST_REGION}}", projectDir, resolveMdExpandOptions({ configDirs: [configDir] }))
    expect(result).toBe("Region: us-west-2")
  })
  it("blank for unset env var", async () => {
    const result = await expand("Missing: {{env:NONEXISTENT}}", projectDir, resolveMdExpandOptions({ configDirs: [configDir] }))
    expect(result).toBe("Missing: ")
  })
})

// ── expand: file tokens ──────────────────────────────────────────────────────

describe("expand: file tokens", () => {
  it("includes file content", async () => {
    const result = await expand('Include: {{ file="./.opencode/greeting.md" name=World }}', projectDir, resolveMdExpandOptions({ configDirs: [configDir] }))
    expect(result).toBe("Include: Hello World!")
  })
  it("handles empty file path diagnostic", async () => {
    const { text, diagnostics } = await expandWithDiagnostics('{{ file="" }}', projectDir, resolveMdExpandOptions({ configDirs: [configDir] }))
    expect(text).toBe("")
    expect(diagnostics.length).toBe(1)
    expect(diagnostics[0].kind).toBe("empty-file")
  })
  it("handles missing file", async () => {
    const { text, diagnostics } = await expandWithDiagnostics('{{ file="./nonexistent.md" }}', projectDir, resolveMdExpandOptions({ configDirs: [configDir] }))
    expect(text).toBe("")
    expect(diagnostics.some(d => d.kind === "missing-file")).toBe(true)
  })
  it("detects cycles", async () => {
    const { text, diagnostics } = await expandWithDiagnostics('{{ file="./.opencode/cycle-a.md" }}', projectDir, resolveMdExpandOptions({ configDirs: [configDir] }))
    expect(diagnostics.some(d => d.kind === "cycle")).toBe(true)
  })
  it("falls back to configDir for relative paths (configDirs fallback)", async () => {
    // File exists only in configDir's .opencode, not in projectDir
    const { text, diagnostics } = await expandWithDiagnostics('{{ file="./.opencode/shared-rules.md" }}', projectDir, resolveMdExpandOptions({ configDirs: [configDir] }))
    expect(text).toBe("Shared rules content")
    expect(diagnostics.length).toBe(0)
  })
})

// ── expand: inline conditionals ──────────────────────────────────────────────

describe("expand: inline conditionals", () => {
  it("includes block when if=arg is truthy", async () => {
    const result = await expand("{{ if=DEBUG }}debug on{{ endif }}", projectDir, resolveMdExpandOptions({ configDirs: [configDir], initialArgs: { DEBUG: "1" } }))
    expect(result).toBe("debug on")
  })
  it("removes block when if=arg is empty", async () => {
    const result = await expand("{{ if=DEBUG }}debug on{{ endif }}", projectDir, resolveMdExpandOptions({ configDirs: [configDir] }))
    expect(result.trim()).toBe("")
  })
  it("includes true branch with else", async () => {
    const result = await expand("{{ if=mode==cached }}Cached{{ else }}Live{{ endif }}", projectDir, resolveMdExpandOptions({ configDirs: [configDir], initialArgs: { mode: "cached" } }))
    expect(result).toBe("Cached")
  })
  it("includes false branch with else", async () => {
    const result = await expand("{{ if=mode==cached }}Cached{{ else }}Live{{ endif }}", projectDir, resolveMdExpandOptions({ configDirs: [configDir], initialArgs: { mode: "live" } }))
    expect(result).toBe("Live")
  })
  it("removes block when if=env:VAR is unset", async () => {
    const result = await expand("{{ if=env:NONEXISTENT }}got it{{ endif }}", projectDir, resolveMdExpandOptions({ configDirs: [configDir] }))
    expect(result.trim()).toBe("")
  })
})

// ── expand: depth limit ──────────────────────────────────────────────────────

describe("expand: depth limit", () => {
  it("leaves file templates literal at MAX_DEPTH", async () => {
    // Double-include goes one level deep; at maxDepth=0 it should leave literal
    const result = await expand('{{ file="./.opencode/double-include.md" }}', projectDir, resolveMdExpandOptions({ configDirs: [configDir], maxDepth: 0 }))
    // Should contain literal {{ file=... }} since depth prevents expansion
    expect(result.includes("{{ file=")).toBe(true)
  })
})

// ── expand: arg cascade ──────────────────────────────────────────────────────

describe("expand: arg cascade", () => {
  it("passes args to included files", async () => {
    const result = await expand('{{ file="./.opencode/with-args.md" path=./test name=Alice }}', projectDir, resolveMdExpandOptions({ configDirs: [configDir] }))
    expect(result).toContain("Path: ./test")
    expect(result).toContain("Name: Alice")
  })
})

// ── expandWithDiagnostics ─────────────────────────────────────────────────────

describe("expandWithDiagnostics", () => {
  it("collects diagnostics for cycle detection", async () => {
    const { diagnostics } = await expandWithDiagnostics(
      '{{ file="./.opencode/cycle-a.md" }}',
      projectDir,
      resolveMdExpandOptions({ configDirs: [configDir] }),
    )
    expect(diagnostics.some(d => d.kind === "cycle")).toBe(true)
  })
})

// ── invalid key handling ──────────────────────────────────────────────────────

describe("invalid key handling", () => {
  it("skips invalid arg keys in file templates", async () => {
    const result = await expand('{{ file="./.opencode/greeting.md" name=World }}', projectDir, resolveMdExpandOptions({ configDirs: [configDir] }))
    expect(result).toBe("Hello World!")
  })
})

// ── stripEmptyExpansionMarkers / line cleanup ────────────────────────────────

describe("line cleanup", () => {
  it("removes marker-only lines", async () => {
    // When a token expands to empty, the marker remains on a line; the whole line should be removed
    const result = await expand("Line before\n{{arg:missing}}\nLine after", projectDir, resolveMdExpandOptions({ configDirs: [configDir] }))
    // The marker line should be removed, leaving just two lines
    const lines = result.split("\n")
    expect(lines.length).toBe(2)
    expect(lines[0]).toBe("Line before")
    expect(lines[1]).toBe("Line after")
  })
})