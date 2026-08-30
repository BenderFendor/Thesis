import { describe, expect, it } from '@jest/globals';
import fc from "fast-check";

import {
  getMessageVersionInfo,
  getVisibleConversationMessages,
} from "@/lib/chat-branching";

interface TestMessage {
  id: string;
  type: "user" | "assistant";
  toolType?: string;
  retryOfMessageId?: string;
  parentMessageId?: string;
}

const baseMessages: TestMessage[] = [
  { id: "user-1", type: "user" },
  { id: "assistant-1", parentMessageId: "user-1", type: "assistant" },
  { id: "user-2", parentMessageId: "assistant-1", type: "user" },
  { id: "assistant-2", parentMessageId: "user-2", type: "assistant" },
  {
    id: "user-2b",
    parentMessageId: "assistant-1",
    retryOfMessageId: "user-2",
    type: "user",
  },
  {
    id: "assistant-2b",
    parentMessageId: "user-2b",
    retryOfMessageId: "assistant-2",
    type: "assistant",
  },
  {
    id: "assistant-2c",
    parentMessageId: "user-2b",
    retryOfMessageId: "assistant-2",
    type: "assistant",
  },
  {
    id: "semantic-2c",
    parentMessageId: "user-2b",
    retryOfMessageId: "assistant-2",
    toolType: "semantic_search",
    type: "assistant",
  },
];

describe("chat branching helpers", () => {
  it("follows the active user branch and assistant retry version", () => {  expect.hasAssertions();
  
    fc.assert(
      fc.property(
        fc.constantFrom<string | undefined>(
          undefined,
          "user-2",
          "user-2b",
        ),
        fc.constantFrom<string | undefined>(
          undefined,
          "assistant-2",
          "assistant-2b",
          "assistant-2c",
          "missing-version",
        ),
        (activeUserVersionId, activeAssistantVersionId) => {
          const visible = getVisibleConversationMessages(baseMessages, {
            ...(activeUserVersionId ? { "user-2": activeUserVersionId } : {}),
            ...(activeAssistantVersionId
              ? { "assistant-2": activeAssistantVersionId }
              : {}),
          }),

           expectedUserVersion = activeUserVersionId ?? "user-2b",
           expectedAssistantVersion =
            expectedUserVersion === "user-2"
              ? "assistant-2"
              : (activeAssistantVersionId &&
                  ["assistant-2b", "assistant-2c"].includes(activeAssistantVersionId)
                ? activeAssistantVersionId
                : "assistant-2c");

          expect(visible.map((message) => message.id)).toStrictEqual([
            "user-1",
            "assistant-1",
            expectedUserVersion,
            expectedAssistantVersion,
          ]);
        },
      ),
    );
  });

  it("reports version metadata for user and assistant siblings", () => {  expect.hasAssertions();
  
    const userVersionInfo = getMessageVersionInfo(baseMessages, "user-2", {
      "user-2": "user-2b",
    }),
     assistantVersionInfo = getMessageVersionInfo(baseMessages, "assistant-2b", {
      "assistant-2": "assistant-2b",
    });

    expect(userVersionInfo).toStrictEqual({
      currentIndex: 1,
      groupId: "user-2",
      totalVersions: 2,
      versionIds: ["user-2", "user-2b"],
    });
    expect(assistantVersionInfo).toStrictEqual({
      currentIndex: 0,
      groupId: "assistant-2",
      totalVersions: 2,
      versionIds: ["assistant-2b", "assistant-2c"],
    });
  });
});
