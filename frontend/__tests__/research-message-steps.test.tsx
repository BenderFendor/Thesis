import { describe, expect, it } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import { MessageStepsToggle } from "@/app/search/research/components/message-item-actions";
import type { Message } from "@/app/search/research/model/types";

const duplicateStepsMessage = (): Message => ({
  content: "Answer",
  id: "assistant-1",
  thinking_steps: [
    {
      content: "Use search_internal_news first.",
      timestamp: "2026-09-12T00:00:00.000Z",
      type: "observation",
    },
    {
      content: "Use search_internal_news first.",
      timestamp: "2026-09-12T00:00:00.000Z",
      type: "observation",
    },
  ],
  timestamp: new Date("2026-09-12T00:00:00.000Z"),
  type: "assistant",
});

const NOOP = (): void => {};

describe("research message steps", () => {
it("renders repeated research steps as separate entries", () => {
  render(
    <MessageStepsToggle
      isAssistant
      message={duplicateStepsMessage()}
      onToggleSteps={NOOP}
      stepsExpanded
    />,
  );

  expect(screen.getAllByText(/Step \d:/u)).toHaveLength(2);
});
});
