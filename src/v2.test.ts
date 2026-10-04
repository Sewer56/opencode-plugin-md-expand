import { describe, expect, test } from "bun:test";

import { makeTmpDir, cleanup, opts } from "./test-helpers";
import { handleSessionEvent } from "./v2";
import type { V2SessionEvent } from "./v2";

function createContext() {
  return undefined;
}

function fakeEvent(): V2SessionEvent {
  return {
    system: [
      { type: "text", text: "default base prompt from the harness" },
      { type: "text", text: 'Rules:\n{{ file="./rules.md" }}' },
      { type: "text", text: "plain part" },
      { type: "text", text: "another plain part" },
    ],
    messages: [
      {
        info: { role: "user" },
        parts: [{ type: "text", text: 'see {{ file="./rules.md" }}' }],
      },
      {
        info: { role: "assistant" },
        parts: [{ type: "text", text: '{{ file="./rules.md" }}' }],
      },
    ],
    tools: {
      read: { description: "read" },
      edit: { description: "edit" },
      glob: { description: "glob" },
      grep: { description: "grep" },
      shell: { description: "shell" },
      write: { description: "write" },
    },
    agent: "build",
  };
}

describe("handleSessionEvent", () => {
  test("includes_should_expand_when_present_in_system_and_user_parts", async () => {
    const dir = await makeTmpDir({ "rules.md": "be terse" });
    cleanup.push(dir);
    const options = opts({ configDirs: [dir] });
    const event = fakeEvent();

    await handleSessionEvent(event, { options, createContext });

    expect(event.system!.some((p) => p.text?.includes("be terse"))).toBe(true);
    expect(event.system!.some((p) => p.text?.includes("{{ file"))).toBe(false);
    expect(event.messages![0]!.parts![0]!.text).toBe("see be terse");
    // Assistant messages are left untouched, matching the V1 hook.
    expect(event.messages![1]!.parts![0]!.text).toContain("{{ file");
  });

  test("comments_should_be_removed_from_system_but_kept_in_user_text", async () => {
    // Arrange
    const comment = "<!--- note --->\n";
    const event = fakeEvent();
    event.system = [{ type: "text", text: `${comment}agent prompt` }];
    event.messages![0]!.parts![0]!.text = `${comment}{{arg:missing}}x`;

    // Act
    await handleSessionEvent(event, { options: opts(), createContext });

    // Assert
    expect(event.system![0]!.text).toBe("agent prompt");
    expect(event.messages![0]!.parts![0]!.text).toBe(`${comment}x`);
  });

  test("plain_parts_should_be_untouched_when_no_tokens_present", async () => {
    const event = fakeEvent();
    event.system = [{ type: "text", text: "custom agent prompt" }];
    const options = opts();

    await handleSessionEvent(event, { options, createContext });

    expect(event.system!.length).toBe(1);
    expect(event.system![0]!.text).toBe("custom agent prompt");
  });
});
