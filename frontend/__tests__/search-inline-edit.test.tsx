import { describe, expect, it } from '@jest/globals';
import { screen, waitFor } from "@testing-library/react";
import NewsResearchPage from "@/app/search/page";
import type { NewsResearchPageServices } from "@/app/search/page";
import { renderWithQueryClient } from "@/test-utils/render-with-query-client";
import userEvent from "@testing-library/user-event";

const navigationServices: NewsResearchPageServices = {
  useRouter: () => ({ replace: (_href: string): void => undefined }),
  useSearchParams: () => new URLSearchParams(),
},
  renderInlineEditPage = async (): Promise<HTMLElement> => {
    renderWithQueryClient(<NewsResearchPage services={navigationServices} />);
    await screen.findByRole("button", { name: "Edit" });
    return screen.getByPlaceholderText("Ask a question and press Enter...");
  },
  seedInlineEditChat = (): void => {
  globalThis.localStorage.clear();
  globalThis.localStorage.setItem(
    "news-research.chat-state",
    JSON.stringify({
      activeAssistantVersionMap: {
        "chat-1": {},
      },
      activeChatId: "chat-1",
      chats: [
        {
          id: "chat-1",
          lastMessage: "Hi dude what is up",
          title: "Hi dude what is up",
          updatedAt: "2026-03-21T14:21:00.000Z",
        },
      ],
      messages: {
        "chat-1": [
          {
            content: "Hi dude what is up",
            id: "user-1",
            timestamp: "2026-03-21T14:21:00.000Z",
            type: "user",
          },
        ],
      },
      version: 1,
    }),
  );
  };

describe("newsResearchPage inline editing", () => {
  it("edits the selected message inline instead of filling the composer", async () => {  expect.hasAssertions();
    seedInlineEditChat();

    const composer = await renderInlineEditPage(),
      user = userEvent.setup();

    expect(composer).toHaveValue("");

    await user.click(screen.getByRole("button", { name: "Edit" }));

    await waitFor(() => {
      expect(screen.getByDisplayValue("Hi dude what is up")).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(composer).toHaveValue("");
  });
});
