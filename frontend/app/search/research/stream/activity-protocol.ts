import type {
  ChatMessageUpdateOptions,
  Message,
  ModelDeltaMessage,
  ResearchActivity,
  ResearchStreamContext,
  ResearchStreamMessage,
  ThinkingStepMessage,
  ToolResultMessage,
  ToolStartMessage,
} from "../model/types";
import { createRawThinkingStep, isRawResearchMessage } from "./raw-events";

const updateAssistantMessage = (
  context: Readonly<ResearchStreamContext>,
  updater: (message: Readonly<Message>) => Message,
  options?: Readonly<ChatMessageUpdateOptions>,
): void => {
  if (!context.isCurrentRequest()) {
    return;
  }
  context.updateChatMessages(
    context.chatId,
    (messages) =>
      messages.map((message) => {
        if (message.id === context.assistantId) {
          return updater(message);
        }
        return message;
      }),
    options,
  );
};

const stepStatusLabel = (stepType: string): string => {
  switch (stepType) {
    case "thought": {
      return "Working through the question.";
    }
    case "tool_start":
    case "action": {
      return "Checking more sources.";
    }
    case "observation": {
      return "Reviewing results.";
    }
    default: {
      return "Working.";
    }
  }
};

const activityId = (
  context: Readonly<ResearchStreamContext>,
  type: ResearchActivity["type"],
  timestamp?: string,
): string => `${type}-${timestamp ?? "now"}-${context.streamState.activities.length}`;

const addResearchActivity = (
  context: Readonly<ResearchStreamContext>,
  activity: ResearchActivity,
): void => {
  const previous = context.streamState.activities.at(-1);
  if (
    previous?.type === activity.type &&
    previous.content === activity.content &&
    previous.tool === activity.tool
  ) {
    return;
  }
  context.streamState.addActivity(activity);
};

const updateActivityMessage = (context: Readonly<ResearchStreamContext>): void => {
  updateAssistantMessage(
    context,
    (message) => ({
      ...message,
      activities: [...context.streamState.activities],
      thinking_steps: [...context.streamState.thinkingSteps],
    }),
    { syncSummary: false },
  );
};

const processResearchThinking = (
  data: Readonly<ThinkingStepMessage>,
  context: Readonly<ResearchStreamContext>,
): void => {
  const previous = context.streamState.thinkingSteps.at(-1);
  if (previous?.type === data.step.type && previous.content === data.step.content) {
    return;
  }
  context.streamState.addThinkingStep(data.step);
  if (data.step.type === "thought") {
    addResearchActivity(context, {
      content: data.step.content,
      id: activityId(context, "thought", data.step.timestamp),
      timestamp: data.step.timestamp,
      type: "thought",
    });
  }
  updateAssistantMessage(
    context,
    (message) => ({
      ...message,
      activities: [...context.streamState.activities],
      streamingStatus: stepStatusLabel(data.step.type),
      thinking_steps: [...context.streamState.thinkingSteps],
    }),
    { syncSummary: false },
  );
};

const processRawToolStart = (
  data: Readonly<ToolStartMessage>,
  context: Readonly<ResearchStreamContext>,
): void => {
  const timestamp = data.timestamp;
  const tool = data.tool ?? "tool";
  context.streamState.addThinkingStep({
    content: `Tool request: ${tool} ${JSON.stringify(data.args ?? {})}`,
    timestamp: timestamp ?? new Date().toISOString(),
    type: "tool_start",
  });
  addResearchActivity(context, {
    args: data.args,
    content: `Calling ${tool}`,
    id: activityId(context, "tool_start", timestamp),
    timestamp,
    tool: data.tool,
    type: "tool_start",
  });
  updateActivityMessage(context);
};

const processRawToolResult = (
  data: Readonly<ToolResultMessage>,
  context: Readonly<ResearchStreamContext>,
): void => {
  const timestamp = data.timestamp;
  context.streamState.addThinkingStep({
    content: data.content ?? "No result returned.",
    timestamp: timestamp ?? new Date().toISOString(),
    type: "observation",
  });
  addResearchActivity(context, {
    content: data.content ?? "Tool returned no visible output.",
    id: activityId(context, "tool_result", timestamp),
    timestamp,
    tool: data.tool,
    type: "tool_result",
  });
  updateActivityMessage(context);
};

const processRawResearchEvent = (
  data: Readonly<ResearchStreamMessage>,
  context: Readonly<ResearchStreamContext>,
): void => {
  if (!isRawResearchMessage(data)) {
    return;
  }
  if (data.type === "tool_start") {
    processRawToolStart(data, context);
    return;
  }
  if (data.type === "tool_result") {
    processRawToolResult(data, context);
    return;
  }
  processResearchThinking(
    { step: createRawThinkingStep(data), type: "thinking_step" },
    context,
  );
};

const processModelDelta = (
  data: Readonly<ResearchStreamMessage>,
  context: Readonly<ResearchStreamContext>,
): void => {
  if (!isModelDelta(data)) {
    return;
  }
  updateAssistantMessage(context, (message) => {
    const sameMessage = message.streamingMessageId === data.message_id;
    let previousText = "";
    let previousReasoning = "";
    let streamingStatus = "Writing response";
    if (sameMessage) {
      previousText = message.streamingText ?? "";
      previousReasoning = message.streamingReasoning ?? "";
    }
    if (data.reasoning) {
      streamingStatus = "Model reasoning";
    }
    return {
      ...message,
      streamingMessageId: data.message_id,
      streamingReasoning: previousReasoning + data.reasoning,
      streamingStatus,
      streamingText: previousText + data.content,
    };
  }, { syncSummary: false });
};

const isModelDelta = (data: Readonly<ResearchStreamMessage>): data is ModelDeltaMessage =>
  data.type === "model_delta";

export { processModelDelta, processRawResearchEvent, processResearchThinking, updateAssistantMessage };
