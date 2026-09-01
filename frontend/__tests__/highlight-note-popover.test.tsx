import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { HighlightNotePopover } from "@/components/highlight-note-popover";
import type { Highlight } from "@/lib/api";

describe("highlightNotePopover", () => {
  it("saves notes for client-only highlights", async () => {expect.hasAssertions();
    const anchor = document.createElement("button");
    document.body.append(anchor);
    Object.defineProperty(anchor, "getBoundingClientRect", {
      value: () => ({
        bottom: 30,
        height: 20,
        left: 20,
        right: 60,
        toJSON: () => ({}),
        top: 10,
        width: 40,
        x: 20,
        y: 10,
      }),
    });

    const highlight: Highlight = {
      article_url: "https://example.com/story",
      character_end: 28,
      character_start: 10,
      client_id: "client-123",
      color: "yellow",
      highlighted_text: "Important sentence",
      note: "",
    },
     onSave = jest.fn(async (..._args: [string, string]): Promise<void> => {
      await Promise.resolve()
    });

    render(
      <HighlightNotePopover
        open
        highlight={highlight}
        anchorEl={anchor}
        onClose={jest.fn()}
        onSave={onSave}
      />,
    );

    fireEvent.change(await screen.findByPlaceholderText("Add a note"), {
      target: { value: "local draft note" },
    });
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith("client:client-123", "local draft note");
    });
  });

  it("keeps the popover open while typing inside the note field", async () => {expect.hasAssertions();
    const anchor = document.createElement("button");
    document.body.append(anchor);
    Object.defineProperty(anchor, "getBoundingClientRect", {
      value: () => ({
        bottom: 30,
        height: 20,
        left: 20,
        right: 60,
        toJSON: () => ({}),
        top: 10,
        width: 40,
        x: 20,
        y: 10,
      }),
    });

    const onClose = jest.fn();

    render(
      <HighlightNotePopover
        open
        highlight={{
          article_url: "https://example.com/story",
          character_end: 31,
          character_start: 4,
          client_id: "client-456",
          color: "yellow",
          highlighted_text: "Another important sentence",
          note: "",
        }}
        anchorEl={anchor}
        onClose={onClose}
        onSave={jest.fn(async () => {})}
      />,
    );

    const textarea = await screen.findByPlaceholderText("Add a note");
    fireEvent.mouseDown(textarea);
    fireEvent.change(textarea, { target: { value: "keep this open" } });

    expect(onClose).not.toHaveBeenCalled();
    expect(textarea).toHaveValue("keep this open");
  });
});
