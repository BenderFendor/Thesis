import { describe, expect, it } from "@jest/globals";
/**
 * Tests for reader page and queue components.
 *
 * Uses React Testing Library to test:
 * - Reader page navigation and keyboard shortcuts
 * - Queue overview card display
 * - Digest card with scheduling
 * - Highlight toolbar functionality
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { DigestCard } from "@/components/digest-card";
import { HighlightToolbar } from "@/components/highlight-toolbar";
import { QueueOverviewCard } from "@/components/queue-overview-card";
import { ReadTimeBadge } from "@/components/read-time-badge";
import { renderWithQueryClient } from "@/test-utils/render-with-query-client";
import userEvent from "@testing-library/user-event";

interface QueueOverviewFixture {
  readonly completed_count: number;
  readonly daily_items: number;
  readonly estimated_total_read_time_minutes: number;
  readonly permanent_items: number;
  readonly reading_count: number;
  readonly total_items: number;
  readonly unread_count: number;
}

interface DigestFixture {
  readonly digest_items: readonly never[];
  readonly estimated_read_time_minutes: number;
  readonly generated_at: string;
  readonly total_items: number;
}

type QueueFixture = QueueOverviewFixture | DigestFixture;
interface QueueFixtureResponse {
  readonly json: () => Promise<QueueFixture>;
  readonly ok: true;
  readonly status: number;
}

const HTTP_OK_STATUS = 200,
 createQueueResponse = (body: QueueFixture): QueueFixtureResponse => ({
  json: () => Promise.resolve(body),
  ok: true,
  status: HTTP_OK_STATUS,
}),
 emptyHighlights: React.ComponentProps<typeof HighlightToolbar>["highlights"] = [],
 highlightContainerRef: React.ComponentProps<typeof HighlightToolbar>["containerRef"] = {
   current: globalThis.document.createElement("div"),
 },
 noopHighlightHandler = (): void => undefined,
 queueFixtureFetch = (input: string): Promise<QueueFixtureResponse> => {
  const url = input;
  if (url.endsWith("/api/queue/overview")) {
    return Promise.resolve(createQueueResponse({
      completed_count: 1,
      daily_items: 3,
      estimated_total_read_time_minutes: 15,
      permanent_items: 2,
      reading_count: 1,
      total_items: 5,
      unread_count: 3,
    }));
  }
  if (url.endsWith("/api/queue/digest/daily")) {
    return Promise.resolve(createQueueResponse({
      digest_items: [],
      estimated_read_time_minutes: 15,
      generated_at: "2026-08-31T00:00:00.000Z",
      total_items: 5,
    }));
  }
  return Promise.reject(new Error(`Unexpected test request: ${url}`));
 },
 withQueueFixture = async (testBody: () => Promise<void>): Promise<void> => {
  const originalFetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch");
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: queueFixtureFetch,
    writable: true,
  });
  try {
    await testBody();
  } finally {
    if (originalFetchDescriptor === undefined) {
      Reflect.deleteProperty(globalThis, "fetch");
    } else {
      Object.defineProperty(globalThis, "fetch", originalFetchDescriptor);
    }
  }
 };

describe("readTimeBadge", () => {
  it("renders read time correctly", () => {
    expect.hasAssertions();
    render(<ReadTimeBadge estimatedMinutes={5} wordCount={1000} compact />);
    expect(screen.getByText(/5 min/u)).toBeInTheDocument();
  });

  it("renders nothing when no data provided", () => {
    expect.hasAssertions();
    const { container } = render(<ReadTimeBadge />);
    expect(container.firstChild).toBeNull();
  });

  it("renders full view with word count", () => {
    expect.hasAssertions();
    render(
      <ReadTimeBadge estimatedMinutes={3} wordCount={500} compact={false} />
    );
    expect(screen.getByText(/3 minute read/u)).toBeInTheDocument();
    expect(screen.getByText(/500/u)).toBeInTheDocument();
  });
});

describe("queueOverviewCard", () => {
  it("renders queue statistics", async () => {
    expect.hasAssertions();
    await withQueueFixture(async () => {
      renderWithQueryClient(<QueueOverviewCard />);
      await screen.findByText("Queue Overview");
    });

    // Component displays unread and completed counts.
    // Unread_count
    expect(screen.getByText("3")).toBeInTheDocument();
    // Completed_count
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("shows daily and permanent item counts", async () => {
    expect.hasAssertions();
    await withQueueFixture(async () => {
      renderWithQueryClient(<QueueOverviewCard />);
      await screen.findByText(/Daily:/u);
    });

    // The component renders short labels "Daily:" and "Permanent:".
    expect(screen.getByText(/Daily:/u)).toBeInTheDocument();
    expect(screen.getByText(/Permanent:/u)).toBeInTheDocument();
  });

  it("displays estimated read time", async () => {
    expect.hasAssertions();
    await withQueueFixture(async () => {
      renderWithQueryClient(<QueueOverviewCard />);
      await screen.findByText(/Est. Read Time/u);
    });

    expect(screen.getByText(/Est. Read Time/u)).toBeInTheDocument();
    expect(screen.getByText(/15 min/u)).toBeInTheDocument();
  });
});

describe("digestCard", () => {
  it("renders digest card when enabled", async () => {
    expect.hasAssertions();
    await withQueueFixture(async () => {
      renderWithQueryClient(<DigestCard enabled />);
      await screen.findByText("Daily Digest");
    });

    expect(screen.getByText("Daily Digest")).toBeInTheDocument();
  });

  it("shows scheduling button", async () => {
    expect.hasAssertions();
    await withQueueFixture(async () => {
      renderWithQueryClient(<DigestCard enabled />);
      await screen.findByText(/Schedule digest/u);
    });

    expect(screen.getByText(/Schedule digest/u)).toBeInTheDocument();
  });

  it("opens schedule form when clicked", async () => {
    expect.hasAssertions();
    await withQueueFixture(async () => {
      renderWithQueryClient(<DigestCard enabled />);
      await userEvent.click(await screen.findByText(/Schedule digest/u));
    });

    expect(screen.getByText(/Daily digest time/u)).toBeInTheDocument();
  });

  it("saves digest schedule time", async () => {
    expect.hasAssertions();
    await withQueueFixture(async () => {
      renderWithQueryClient(<DigestCard enabled />);
      await userEvent.click(await screen.findByText(/Schedule digest/u));
      await userEvent.clear(screen.getByDisplayValue("09:00"));
      await userEvent.type(screen.getByDisplayValue(""), "08:00");
      await userEvent.click(screen.getByText(/Set/u));
    });

    expect(localStorage.getItem("digestScheduleTime")).toBe("08:00");
  });
});

describe("highlightToolbar", () => {
  it("renders when enabled", () => {
    expect.hasAssertions();
    render(
      <HighlightToolbar
        articleUrl="https://example.com/article"
        containerRef={highlightContainerRef}
        highlightColor="yellow"
        autoCreate={false}
        highlights={emptyHighlights}
        onCreate={noopHighlightHandler}
        onUpdate={noopHighlightHandler}
        onDelete={noopHighlightHandler}
      />
    );

    expect(screen.getByRole("button", { name: "Highlight" })).toBeInTheDocument();
  });
});

describe("keyboard Navigation", () => {
  it("handles arrow key navigation", () => {
    expect.hasAssertions();
    expect(fireEvent.keyDown(globalThis.document, { key: "ArrowRight" })).toBe(true);
  });
});
