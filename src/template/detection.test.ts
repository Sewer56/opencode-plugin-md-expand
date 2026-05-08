import { describe, test, expect } from "bun:test"
import { hasExpandableToken } from "./detection"

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
