import { describe, test, expect } from "bun:test"
import { expand } from "../expand"
import { withEnv, opts } from "../test-helpers"

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
