import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  ReactNode,
} from "react";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import NewsResearchPage from "@/app/search/page";
import { renderWithQueryClient } from "@/test-utils/render-with-query-client";

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({
    children,
    href,
  }: {
    children: ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

jest.mock("framer-motion", () => ({
  motion: {
    div: ({
      children,
      ...props
    }: HTMLAttributes<HTMLDivElement> & {
      animate?: unknown;
      children: ReactNode;
      initial?: unknown;
      transition?: unknown;
    }) => {
      const {
        animate,
        initial,
        transition,
        ...domProps
      } = props as HTMLAttributes<HTMLDivElement> & {
        animate?: unknown;
        initial?: unknown;
        transition?: unknown;
      };
      void animate;
      void initial;
      void transition;
      return <div {...domProps}>{children}</div>;
    },
    button: ({
      children,
      ...props
    }: ButtonHTMLAttributes<HTMLButtonElement> & {
      animate?: unknown;
      children: ReactNode;
      initial?: unknown;
      transition?: unknown;
    }) => {
      const {
        animate,
        initial,
        transition,
        ...domProps
      } = props as ButtonHTMLAttributes<HTMLButtonElement> & {
        animate?: unknown;
        initial?: unknown;
        transition?: unknown;
      };
      void animate;
      void initial;
      void transition;
      return <button {...domProps}>{children}</button>;
    },
  },
}));

jest.mock("react-markdown", () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

jest.mock("remark-gfm", () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock("@/lib/api", () => ({
  API_BASE_URL: "http://localhost:8000",
  semanticSearch: jest.fn(async () => ({ results: [] })),
}));

jest.mock("@/components/article-detail-modal", () => ({
  ArticleDetailModal: () => null,
}));

jest.mock("@/components/chat-sidebar", () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock("@/components/search-suggestions", () => ({
  SearchSuggestions: () => null,
}));

jest.mock("@/components/verification-panel", () => ({
  VerificationPanel: () => null,
}));

describe("NewsResearchPage inline editing", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(
      "news-research.chat-state",
      JSON.stringify({
        version: 1,
        activeChatId: "chat-1",
        chats: [
          {
            id: "chat-1",
            title: "Hi dude what is up",
            lastMessage: "Hi dude what is up",
            updatedAt: "2026-03-21T14:21:00.000Z",
          },
        ],
        activeAssistantVersionMap: {
          "chat-1": {},
        },
        messages: {
          "chat-1": [
            {
              id: "user-1",
              type: "user",
              content: "Hi dude what is up",
              timestamp: "2026-03-21T14:21:00.000Z",
            },
          ],
        },
      }),
    );
  });

  it("edits the selected message inline instead of filling the composer", async () => {
    const user = userEvent.setup();

    renderWithQueryClient(<NewsResearchPage />);

    await screen.findByRole("button", { name: "Edit" });

    const composer = screen.getByPlaceholderText(
      "Ask a question and press Enter...",
    ) as HTMLTextAreaElement;

    expect(composer).toHaveValue("");

    await user.click(screen.getByRole("button", { name: "Edit" }));

    await waitFor(() => {
      expect(screen.getByDisplayValue("Hi dude what is up")).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(composer).toHaveValue("");
  });
});
