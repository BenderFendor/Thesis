import {
  createInitialResearchState,
  researchReducer,
} from "@/app/search/research/state/research-reducer";
import { describe, expect, it } from "@jest/globals";
import {
  parsePersistedChatState,
  reviveStoredChatMessages,
} from "@/app/search/research/state/persistence";
import type { ChatSummary } from "@/components/chat-sidebar";
import type { Message } from "@/app/search/research/model/types";

const chat: ChatSummary = {
  id: "chat-1",
  title: "Renewable energy",
};

const userMessage: Message = {
  content: "How do sources cover renewable energy?",
  id: "message-1",
  timestamp: new Date("2026-09-01T12:00:00.000Z"),
  type: "user",
};

const revivePersistedMessages = (serialized: string) => {
  const parsed = parsePersistedChatState(serialized);
  return reviveStoredChatMessages(parsed?.messages ?? {});
};

describe("research state", () => {
  it("updates message summaries without mutating prior state", () => {  expect.hasAssertions();

    const initial = createInitialResearchState();
    const withChat = researchReducer(initial, { type: "set-chats", value: [chat] });
    const withMessages = researchReducer(withChat, {
      type: "set-chat-messages-map",
      value: { "chat-1": [userMessage] },
    });
    const next = researchReducer(withMessages, {
      chatId: "chat-1",
      type: "update-chat-messages",
      updater: (messages) => [
        ...messages,
        {
          content: "Source-backed answer",
          id: "message-2",
          timestamp: new Date("2026-09-01T12:01:00.000Z"),
          type: "assistant",
        },
      ],
    });

    expect(withMessages.chats[0]?.lastMessage).toBeUndefined();
    expect(next.chats[0]?.lastMessage).toBe("Source-backed answer");
    expect(withMessages.chatMessagesMap["chat-1"]).toHaveLength(1);
    expect(next.chatMessagesMap["chat-1"]).toHaveLength(2);
  });

  it("toggles visibility using a new set", () => {  expect.hasAssertions();

    const initial = createInitialResearchState();
    const expanded = researchReducer(initial, {
      messageId: "message-1",
      type: "toggle-step-visibility",
    });
    const collapsed = researchReducer(expanded, {
      messageId: "message-1",
      type: "toggle-step-visibility",
    });

    expect(initial.expandedStepMessageIds.has("message-1")).toBe(false);
    expect(expanded.expandedStepMessageIds.has("message-1")).toBe(true);
    expect(collapsed.expandedStepMessageIds.has("message-1")).toBe(false);
    expect(collapsed.expandedStepMessageIds).not.toBe(expanded.expandedStepMessageIds);
  });
});

describe("persisted research state", () => {
  it("validates stored data and revives message timestamps", () => {  expect.hasAssertions();

    const serialized = JSON.stringify({
      chats: [chat],
      messages: {
        "chat-1": [
          {
            content: "Saved answer",
            id: "message-2",
            timestamp: "2026-09-01T12:01:00.000Z",
            type: "assistant",
          },
        ],
      },
      version: 1,
    });
    const revived = revivePersistedMessages(serialized);
    expect(revived["chat-1"]?.[0]?.timestamp).toStrictEqual(new Date("2026-09-01T12:01:00.000Z"));
    expect(parsePersistedChatState("not-json")).toBeUndefined();
  });
});
