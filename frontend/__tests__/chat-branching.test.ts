import { describe, expect, it } from '@jest/globals';
import {
  getMessageVersionInfo,
  getVisibleConversationMessages,
} from "@/lib/chat-branching";
import fc from "fast-check";

interface TestMessage {
  readonly id: string;
  readonly type: "user" | "assistant";
  readonly toolType?: string;
  readonly retryOfMessageId?: string;
  readonly parentMessageId?: string;
}

interface BranchCase {
  readonly activeVersionByGroup: Readonly<Record<string, string>>;
  readonly expectedIds: readonly string[];
}

const EXPECTED_BRANCH_CASES = 15,
  baseMessages: readonly TestMessage[] = [
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
],
  branchCases: readonly BranchCase[] = [
    {
      activeVersionByGroup: {},
      expectedIds: ["user-1", "assistant-1", "user-2b", "assistant-2c"],
    },
    {
      activeVersionByGroup: { "assistant-2": "assistant-2" },
      expectedIds: ["user-1", "assistant-1", "user-2b", "assistant-2c"],
    },
    {
      activeVersionByGroup: { "assistant-2": "assistant-2b" },
      expectedIds: ["user-1", "assistant-1", "user-2b", "assistant-2b"],
    },
    {
      activeVersionByGroup: { "assistant-2": "assistant-2c" },
      expectedIds: ["user-1", "assistant-1", "user-2b", "assistant-2c"],
    },
    {
      activeVersionByGroup: { "assistant-2": "missing-version" },
      expectedIds: ["user-1", "assistant-1", "user-2b", "assistant-2c"],
    },
    {
      activeVersionByGroup: { "user-2": "user-2" },
      expectedIds: ["user-1", "assistant-1", "user-2", "assistant-2"],
    },
    {
      activeVersionByGroup: { "assistant-2": "assistant-2", "user-2": "user-2" },
      expectedIds: ["user-1", "assistant-1", "user-2", "assistant-2"],
    },
    {
      activeVersionByGroup: { "assistant-2": "assistant-2b", "user-2": "user-2" },
      expectedIds: ["user-1", "assistant-1", "user-2", "assistant-2"],
    },
    {
      activeVersionByGroup: { "assistant-2": "assistant-2c", "user-2": "user-2" },
      expectedIds: ["user-1", "assistant-1", "user-2", "assistant-2"],
    },
    {
      activeVersionByGroup: { "assistant-2": "missing-version", "user-2": "user-2" },
      expectedIds: ["user-1", "assistant-1", "user-2", "assistant-2"],
    },
    {
      activeVersionByGroup: { "user-2": "user-2b" },
      expectedIds: ["user-1", "assistant-1", "user-2b", "assistant-2c"],
    },
    {
      activeVersionByGroup: { "assistant-2": "assistant-2", "user-2": "user-2b" },
      expectedIds: ["user-1", "assistant-1", "user-2b", "assistant-2c"],
    },
    {
      activeVersionByGroup: { "assistant-2": "assistant-2b", "user-2": "user-2b" },
      expectedIds: ["user-1", "assistant-1", "user-2b", "assistant-2b"],
    },
    {
      activeVersionByGroup: { "assistant-2": "assistant-2c", "user-2": "user-2b" },
      expectedIds: ["user-1", "assistant-1", "user-2b", "assistant-2c"],
    },
    {
      activeVersionByGroup: { "assistant-2": "missing-version", "user-2": "user-2b" },
      expectedIds: ["user-1", "assistant-1", "user-2b", "assistant-2c"],
    },
  ];

describe("visible conversation branches", () => {
  it("follows the active user branch and assistant retry version", () => {  expect.hasAssertions();

    fc.assert(
      fc.property(fc.constantFrom(...branchCases), (branchCase: Readonly<BranchCase>) => {
        const visible = getVisibleConversationMessages(
          baseMessages,
          branchCase.activeVersionByGroup,
        );
        expect(visible.map((message) => message.id)).toStrictEqual(
          branchCase.expectedIds,
        );
      }),
    );
    expect(branchCases).toHaveLength(EXPECTED_BRANCH_CASES);
  });
});

describe("chat message version metadata", () => {
  it("reports version metadata for user and assistant siblings", () => {  expect.hasAssertions();

    const assistantVersionInfo = getMessageVersionInfo(baseMessages, "assistant-2b", {
      "assistant-2": "assistant-2b",
    }),
      userVersionInfo = getMessageVersionInfo(baseMessages, "user-2", {
        "user-2": "user-2b",
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
