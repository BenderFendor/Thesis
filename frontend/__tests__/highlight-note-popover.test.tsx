import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { HighlightNotePopover } from "@/components/highlight-note-popover";
import type { Highlight } from "@/lib/api";

jest.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

describe("HighlightNotePopover", () => {
  it("saves notes for client-only highlights", async () => {
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    Object.defineProperty(anchor, "getBoundingClientRect", {
      value: () => ({
        top: 10,
        left: 20,
        bottom: 30,
        right: 60,
        width: 40,
        height: 20,
        x: 20,
        y: 10,
        toJSON: () => ({}),
      }),
    });

    const highlight: Highlight = {
      client_id: "client-123",
      article_url: "https://example.com/story",
      highlighted_text: "Important sentence",
      color: "yellow",
      note: "",
      character_start: 10,
      character_end: 28,
    };
    const onSave = jest.fn(async () => undefined);

    render(
      <HighlightNotePopover
        open={true}
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
});
