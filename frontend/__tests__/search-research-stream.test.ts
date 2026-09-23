import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, jest } from "@jest/globals";
import { useState } from "react";
import { processResearchEvent } from "@/app/search/research/stream/protocol";
import { useResearchTransport } from "@/app/search/research/hooks/use-research-transport";
import type { ApiOpaqueObject } from "@/lib/api";
import type { ResearchStreamActions } from "@/app/search/research/hooks/use-research-transport";
import type {
  Message,
  ReadonlyThinkingStep,
  ResearchActivity,
  ResearchStreamContext,
  StartResearchParameters,
  StructuredArticlesPayload,
  UpdateChatMessages,
} from "@/app/search/research/model/types";

const createStreamContext = () => {
  let messages: readonly Message[] = [
    {
      content: "Topic: climate risks",
      id: "assistant-1",
      isStreaming: true,
      streamingStatus: "Starting research...",
      timestamp: new Date("2026-09-11T12:00:00.000Z"),
      type: "assistant",
    },
  ];
  // SAFETY: null is the initial absence state before the stream provides articles.
  let structuredArticles = null as StructuredArticlesPayload | null;
  const thinkingSteps: ReadonlyThinkingStep[] = [];
  const activities: ResearchActivity[] = [];
  const context: ResearchStreamContext = {
    assistantGroupId: "group-1",
    assistantId: "assistant-1",
    chatId: "chat-1",
    focusInput: () => {},
    isCurrentRequest: () => true,
    setActiveAssistantVersion: () => {},
    setIsSearching: () => {},
    streamState: {
      get activities() {
        return activities;
      },
      addActivity: (activity) => {
        activities.push(activity);
      },
      addThinkingStep: (step) => {
        thinkingSteps.push(step);
      },
      clearStallTimeout: () => {},
      setClearStallTimeout: () => {},
      setStructuredArticles: (articles) => {
        structuredArticles = articles;
      },
      get structuredArticles() {
        return structuredArticles ?? void 0;
      },
      get thinkingSteps() {
        return thinkingSteps;
      },
    },
    updateChatMessages: (_chatId, updater) => {
      messages = updater(messages);
    },
  };
  return { context, getMessages: () => messages };
};

const emit = (context: ResearchStreamContext, payload: ApiOpaqueObject): void => {
  processResearchEvent(`data: ${JSON.stringify(payload)}`, context);
};

const emitAgentEvents = (context: ResearchStreamContext): void => {
  emit(context, { content: "Planning the search", type: "thinking" });
  emit(context, {
    args: { query: "climate risks" },
    tool: "web_search",
    type: "tool_start",
  });
  emit(context, { content: "Three relevant sources", type: "tool_result" });
  emit(context, {
    step: {
      content: "Three relevant sources",
      timestamp: "2026-09-11T12:00:01.000Z",
      type: "observation",
    },
    type: "thinking_step",
  });
};

const emitLegacyCompletion = (context: ResearchStreamContext): void => {
  emit(context, {
    result: {
      answer: "A source-backed answer.",
      articles_searched: 3,
      query: "climate risks",
      structured_articles: "",
      success: true,
    },
    type: "complete",
  });
};

const useTransportHarness = () => {
  const [messages, setMessages] = useState<readonly Message[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const updateChatMessages: UpdateChatMessages = (_chatId, updater) => {
    setMessages((previous) => updater(previous));
  };
  const transport = useResearchTransport({
    activeAssistantVersionMap: {},
    activeChatId: "chat-1",
    chats: [{ id: "chat-1", title: "Climate risks" }],
    focusInput: () => {},
    setActiveAssistantVersion: () => {},
    setIsSearching,
    updateChatMessages,
  });
  return { isSearching, messages, transport };
};

const createRejectingFetch = () => {
  let signal: AbortSignal | null = null;
  const fetch = jest.fn<typeof globalThis.fetch>(async (_input, init) => {
    signal = init?.signal ?? signal;
    await Promise.resolve();
    await Promise.resolve();
    throw new Error("test request ended");
  });
  return { fetch, getSignal: () => signal };
};

const createAbortableStreamFetch = () => {
  const requests: AbortSignal[] = [];
  const fetch = jest.fn<typeof globalThis.fetch>((_input, init) => {
    if (new Headers(init?.headers).get("Accept") !== "text/event-stream") {
      return Promise.reject(new Error("ignore semantic search in this test"));
    }
    const signal = init?.signal;
    if (signal === undefined || signal === null) {
      return Promise.resolve(new Response(null));
    }
    requests.push(signal);
    const pending = Promise.withResolvers<Response>();
    signal.addEventListener("abort", () => {
      pending.reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
    return pending.promise;
  });
  return { fetch, requests };
};

const muteResearchLogs = (): (() => void) => {
  const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  const error = jest.spyOn(console, "error").mockImplementation(() => {});
  return () => {
    warn.mockRestore();
    error.mockRestore();
  };
};

const installAbortableStreamFetch = () => {
  const originalFetch = globalThis.fetch;
  const controlledFetch = createAbortableStreamFetch();
  const restoreResearchLogs = muteResearchLogs();
  globalThis.fetch = controlledFetch.fetch;
  return {
    controlledFetch,
    restore: () => {
      globalThis.fetch = originalFetch;
      restoreResearchLogs();
    },
  };
};

const installRejectingFetch = () => {
  const originalFetch = globalThis.fetch;
  const rejectingFetch = createRejectingFetch();
  const restoreResearchLogs = muteResearchLogs();
  globalThis.fetch = rejectingFetch.fetch;
  return {
    rejectingFetch,
    restore: () => {
      globalThis.fetch = originalFetch;
      restoreResearchLogs();
    },
  };
};

const startSupersedingRequest = async (
  getStartResearch: () => ResearchStreamActions["startResearch"],
  parameters: StartResearchParameters,
  requests: readonly AbortSignal[],
): Promise<{ secondRequest: Promise<void> }> => {
  let firstRequest = Promise.resolve();
  act(() => {
    firstRequest = getStartResearch()(parameters);
  });
  await waitFor(() => {
    expect(requests).toHaveLength(1);
  });
  let secondRequest = Promise.resolve();
  act(() => {
    secondRequest = getStartResearch()(parameters);
  });
  await waitFor(() => {
    expect(requests).toHaveLength(2);
  });
  await act(async () => {
    await firstRequest;
  });
  expect(requests.map((signal) => signal.aborted)).toStrictEqual([true, false]);
  return { secondRequest };
};

const expectSupersededRequestClosed = (messages: readonly Message[], isSearching: boolean): void => {
  const assistantMessages = messages.filter((message) => message.type === "assistant");
  expect(new Set(assistantMessages.map((message) => message.id)).size).toBe(2);
  expect(assistantMessages[0]).toMatchObject({ isStreaming: false });
  expect(assistantMessages[1]).toMatchObject({ isStreaming: true });
  expect(isSearching).toBe(true);
};

describe("research stream protocol events", () => {
  it("renders raw agent events and accepts the legacy completion shape", () => {
    const stream = createStreamContext();

    emitAgentEvents(stream.context);

    const duringStream = stream.getMessages()[0];
    expect({
      activityTypes: duringStream?.activities?.map((activity) => activity.type),
      thinkingTypes: duringStream?.thinking_steps?.map((step) => step.type),
      tool: duringStream?.activities?.[1]?.tool,
    }).toStrictEqual({
      activityTypes: ["thought", "tool_start", "tool_result"],
      thinkingTypes: ["thought", "tool_start", "observation"],
      tool: "web_search",
    });

    emitLegacyCompletion(stream.context);

    const completed = stream.getMessages()[0];
    expect(completed).toMatchObject({ content: "A source-backed answer.", isStreaming: false });
    expect(completed?.thinking_steps).toHaveLength(3);
  });

});

describe("research transport", () => {
  it("does not abort the stream when adding the streaming placeholder rerenders the hook", async () => {
    const fetchSetup = installRejectingFetch();
    const { result } = renderHook(() => useTransportHarness());
    let startPromise = Promise.resolve();
    let signalSurvivedRerender = false;

    try {
      await act(async () => {
        startPromise = result.current.transport.startResearch({
          chatId: "chat-1",
          prompt: "Question",
          seedMessages: [],
        });
        await Promise.resolve();
        signalSurvivedRerender = fetchSetup.rejectingFetch.getSignal()?.aborted === false;
        await startPromise;
      });
    } finally {
      fetchSetup.restore();
    }
    expect(signalSurvivedRerender).toBe(true);
  });

});

describe("overlapping research requests", () => {
  it("uses distinct request IDs and closes the superseded placeholder", async () => {
    const fetchSetup = installAbortableStreamFetch();
    const { result } = renderHook(() => useTransportHarness());
    const parameters = { chatId: "chat-1", prompt: "Question", seedMessages: [] };

    try {
      const { secondRequest } = await startSupersedingRequest(
        () => result.current.transport.startResearch,
        parameters,
        fetchSetup.controlledFetch.requests,
      );
      await waitFor(() => {
        expectSupersededRequestClosed(result.current.messages, result.current.isSearching);
      });
      act(() => {
        result.current.transport.stopResearch();
      });
      await act(async () => {
        await secondRequest;
      });
    } finally {
      fetchSetup.restore();
    }
    expect(fetchSetup.controlledFetch.requests).toHaveLength(2);
  });
});
