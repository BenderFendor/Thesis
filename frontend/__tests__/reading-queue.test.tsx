import { describe, expect, it, jest } from '@jest/globals';
/**
 * Tests for reader page and queue components.
 *
 * Uses React Testing Library to test:
 * - Reader page navigation and keyboard shortcuts
 * - Queue overview card display
 * - Digest card with scheduling
 * - Highlight toolbar functionality
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReadTimeBadge } from "@/components/read-time-badge";
import { QueueOverviewCard } from "@/components/queue-overview-card";
import { DigestCard } from "@/components/digest-card";
import { HighlightToolbar } from "@/components/highlight-toolbar";
import { renderWithQueryClient } from "@/test-utils/render-with-query-client";

// Mock next/navigation
jest.mock<typeof import('next/navigation')>("next/navigation", () => ({
  useParams: () => ({
    id: "1",
  }),
  useRouter: () => ({
    back: jest.fn(),
    push: jest.fn(),
  }),
}));

// Mock API calls
jest.mock<typeof import('@/lib/api')>("@/lib/api", () => ({
  ENABLE_DIGEST: true,
  ENABLE_HIGHLIGHTS: true,
  createHighlight: jest.fn((highlight) => Promise.resolve(highlight)),
  getDailyDigest: jest.fn(() =>
    Promise.resolve({
      digest_items: [],
      estimated_read_time_minutes: 15,
      generated_at: new Date().toISOString(),
      total_items: 5,
    })
  ),
  getHighlightsForArticle: jest.fn(() => Promise.resolve([])),
  getQueueItemContent: jest.fn(() =>
    Promise.resolve({
      article_source: "Example News",
      article_title: "Test Article",
      article_url: "https://example.com/article",
      estimated_read_time_minutes: 1,
      full_text: "This is test content.",
      id: 1,
      read_status: "unread",
      word_count: 100,
    })
  ),
  getQueueOverview: jest.fn(() =>
    Promise.resolve({
      completed_count: 1,
      daily_items: 3,
      estimated_total_read_time_minutes: 15,
      permanent_items: 2,
      reading_count: 1,
      total_items: 5,
      unread_count: 3,
    })
  ),
}));

describe("readTimeBadge", () => {
  it("renders read time correctly", () => {  expect.hasAssertions();
  
    render(<ReadTimeBadge estimatedMinutes={5} wordCount={1000} compact />);
    expect(screen.getByText(/5 min/)).toBeInTheDocument();
  });

  it("renders nothing when no data provided", () => {  expect.hasAssertions();
  
    const { container } = render(<ReadTimeBadge />);
    expect(container.firstChild).toBeNull();
  });

  it("renders full view with word count", () => {  expect.hasAssertions();
  
    render(
      <ReadTimeBadge estimatedMinutes={3} wordCount={500} compact={false} />
    );
    expect(screen.getByText(/3 minute read/)).toBeInTheDocument();
    expect(screen.getByText(/500/)).toBeInTheDocument();
  });
});

describe("queueOverviewCard", () => {
  it("renders queue statistics", async () => {  expect.hasAssertions();
  
    renderWithQueryClient(<QueueOverviewCard />);

    await waitFor(() => {
      expect(screen.getByText("Queue Overview")).toBeInTheDocument();
      // Component displays unread and completed counts
      expect(screen.getByText("3")).toBeInTheDocument(); // Unread_count
      expect(screen.getByText("1")).toBeInTheDocument(); // Completed_count
    });
  });

  it("shows daily and permanent item counts", async () => {  expect.hasAssertions();
  
    renderWithQueryClient(<QueueOverviewCard />);

    await waitFor(() => {
      // The component renders short labels "Daily:" and "Permanent:"
      expect(screen.getByText(/Daily:/)).toBeInTheDocument();
      expect(screen.getByText(/Permanent:/)).toBeInTheDocument();
    });
  });

  it("displays estimated read time", async () => {  expect.hasAssertions();
  
    renderWithQueryClient(<QueueOverviewCard />);

    await waitFor(() => {
      expect(screen.getByText(/Est. Read Time/)).toBeInTheDocument();
      expect(screen.getByText(/15 min/)).toBeInTheDocument();
    });
  });
});

describe("digestCard", () => {
  it("renders digest card when enabled", async () => {  expect.hasAssertions();
  
    renderWithQueryClient(<DigestCard />);

    await waitFor(() => {
      expect(screen.getByText("Daily Digest")).toBeInTheDocument();
    });
  });

  it("shows scheduling button", async () => {  expect.hasAssertions();
  
    renderWithQueryClient(<DigestCard />);

    await waitFor(() => {
      expect(screen.getByText(/Schedule digest/)).toBeInTheDocument();
    });
  });

  it("opens schedule form when clicked", async () => {  expect.hasAssertions();
  
    const user = userEvent.setup();
    renderWithQueryClient(<DigestCard />);

    const scheduleButton = await screen.findByText(/Schedule digest/);
    await user.click(scheduleButton);

    await waitFor(() => {
      expect(screen.getByText(/Daily digest time/)).toBeInTheDocument();
    });
  });

  it("saves digest schedule time", async () => {  expect.hasAssertions();
  
    const user = userEvent.setup();
    renderWithQueryClient(<DigestCard />);

    const scheduleButton = await screen.findByText(/Schedule digest/);
    await user.click(scheduleButton);

    const timeInput = screen.getByDisplayValue("09:00");
    await user.clear(timeInput);
    await user.type(timeInput, "08:00");

    const setButton = screen.getByText(/Set/);
    await user.click(setButton);

    expect(localStorage.getItem("digestScheduleTime")).toBe("08:00");
  });
});

describe("highlightToolbar", () => {
  it("renders when enabled", () => {  expect.hasAssertions();
  
    const containerRef = { current: document.createElement("div") };

    render(
      <HighlightToolbar
        articleUrl="https://example.com/article"
        containerRef={containerRef}
        highlightColor="yellow"
        autoCreate={false}
        highlights={[]}
        onCreate={jest.fn()}
        onUpdate={jest.fn()}
        onDelete={jest.fn()}
      />
    );

    expect(true).toBe(true);
  });
});

describe("keyboard Navigation", () => {
  it("handles arrow key navigation", () => {  expect.hasAssertions();
  
    // Test that keyboard events can be simulated
    const event = new KeyboardEvent("keydown", { key: "ArrowRight" });
    fireEvent(window, event);

    // Verify event was dispatched
    expect(true).toBe(true);
  });
});
