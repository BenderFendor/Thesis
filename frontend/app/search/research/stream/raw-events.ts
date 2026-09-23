import type {
  ReadonlyThinkingStep,
  ResearchStreamMessage,
  ThinkingMessage,
  ToolResultMessage,
  ToolStartMessage,
} from "../model/types";

type RawResearchMessage = ThinkingMessage | ToolStartMessage | ToolResultMessage;

const isRawResearchMessage = (
  message: Readonly<ResearchStreamMessage>,
): message is RawResearchMessage =>
  message.type === "thinking" || message.type === "tool_start" || message.type === "tool_result";

const createRawThinkingStep = (message: Readonly<RawResearchMessage>): ReadonlyThinkingStep => {
  const timestamp = message.timestamp ?? new Date().toISOString();
  if (message.type === "thinking") {
    return { content: message.content, timestamp, type: "thought" };
  }
  if (message.type === "tool_start") {
    const tool = message.tool ?? "unknown tool";
    const args = JSON.stringify(message.args ?? {}) ?? "{}";
    return { content: `Tool request: ${tool} ${args}`, timestamp, type: "tool_start" };
  }
  return {
    content: message.content ?? "No result returned.",
    timestamp,
    type: "observation",
  };
};

export { createRawThinkingStep, isRawResearchMessage };
