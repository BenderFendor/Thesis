import fc from "fast-check";

import {
  getMessageVersionInfo,
  getVisibleConversationMessages,
} from "@/lib/chat-branching";

type TestMessage = {
  id: string;
  type: "user" | "assistant";
  toolType?: string;
  retryOfMessageId?: string;
  parentMessageId?: string;
};

const baseMessages: TestMessage[] = [
  { id: "user-1", type: "user" },
  { id: "assistant-1", type: "assistant", parentMessageId: "user-1" },
  { id: "user-2", type: "user", parentMessageId: "assistant-1" },
  { id: "assistant-2", type: "assistant", parentMessageId: "user-2" },
  {
    id: "user-2b",
    type: "user",
    retryOfMessageId: "user-2",
    parentMessageId: "assistant-1",
  },
  {
    id: "assistant-2b",
    type: "assistant",
    retryOfMessageId: "assistant-2",
    parentMessageId: "user-2b",
  },
  {
    id: "assistant-2c",
    type: "assistant",
    retryOfMessageId: "assistant-2",
    parentMessageId: "user-2b",
  },
  {
    id: "semantic-2c",
    type: "assistant",
    toolType: "semantic_search",
    retryOfMessageId: "assistant-2",
    parentMessageId: "user-2b",
  },
];

describe("chat branching helpers", () => {
  it("follows the active user branch and assistant retry version", () => {
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
          });

          const expectedUserVersion = activeUserVersionId ?? "user-2b";
          const expectedAssistantVersion =
            expectedUserVersion === "user-2"
              ? "assistant-2"
              : activeAssistantVersionId &&
                  ["assistant-2b", "assistant-2c"].includes(activeAssistantVersionId)
                ? activeAssistantVersionId
                : "assistant-2c";

          expect(visible.map((message) => message.id)).toEqual([
            "user-1",
            "assistant-1",
            expectedUserVersion,
            expectedAssistantVersion,
          ]);
        },
      ),
    );
  });

  it("reports version metadata for user and assistant siblings", () => {
    const userVersionInfo = getMessageVersionInfo(baseMessages, "user-2", {
      "user-2": "user-2b",
    });
    const assistantVersionInfo = getMessageVersionInfo(baseMessages, "assistant-2b", {
      "assistant-2": "assistant-2b",
    });

    expect(userVersionInfo).toEqual({
      groupId: "user-2",
      currentIndex: 1,
      totalVersions: 2,
      versionIds: ["user-2", "user-2b"],
    });
    expect(assistantVersionInfo).toEqual({
      groupId: "assistant-2",
      currentIndex: 0,
      totalVersions: 2,
      versionIds: ["assistant-2b", "assistant-2c"],
    });
  });
});
