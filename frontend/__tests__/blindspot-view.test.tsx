import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { BlindspotView } from "@/components/blindspot-view"
import { renderWithQueryClient } from "@/test-utils/render-with-query-client"

const mockFetchBlindspotViewer = jest.fn()

jest.mock("@/lib/api", () => ({
  fetchBlindspotViewer: (...args: unknown[]) => mockFetchBlindspotViewer(...args),
}))

jest.mock("@/components/cluster-detail-modal", () => ({
  ClusterDetailModal: () => null,
}))

describe("BlindspotView", () => {
  beforeEach(() => {
    mockFetchBlindspotViewer.mockReset()
    mockFetchBlindspotViewer.mockImplementation(
      async ({ lens }: { lens?: string } = {}) => ({
        available_lenses: [
          {
            id: "bias",
            label: "Left vs Right",
            description: "Bias lens",
            available: true,
            unavailable_reason: null,
          },
          {
            id: "credibility",
            label: "Credible vs Uncredible",
            description: "Credibility lens",
            available: true,
            unavailable_reason: null,
          },
        ],
        selected_lens: {
          id: lens === "credibility" ? "credibility" : "bias",
          label: lens === "credibility" ? "Credible vs Uncredible" : "Left vs Right",
          description:
            lens === "credibility" ? "Credibility lens" : "Bias lens",
          available: true,
          unavailable_reason: null,
        },
        summary: {
          window: "1w",
          total_clusters: 12,
          eligible_clusters: 6,
          generated_at: "2026-03-21T12:00:00Z",
          category: "all",
          source_filters: [],
        },
        lanes: [
          {
            id: "pole_a",
            label:
              lens === "credibility" ? "For High Credibility" : "For the Left",
            description: "Lane A",
            cluster_count: 1,
          },
          {
            id: "shared",
            label: "Shared Coverage",
            description: "Lane shared",
            cluster_count: 1,
          },
          {
            id: "pole_b",
            label:
              lens === "credibility" ? "For Low Credibility" : "For the Right",
            description: "Lane B",
            cluster_count: 1,
          },
        ],
        cards: [
          {
            cluster_id: 1,
            cluster_label: lens === "credibility" ? "Verification push" : "Campaign rally",
            keywords: ["campaign", "policy"],
            article_count: 5,
            source_count: 4,
            lane: "pole_a",
            blindspot_score: 2.5,
            balance_score: 0.1,
            published_at: "2026-03-21T11:00:00Z",
            explanation: "4 sources versus 0 sources.",
            coverage_counts: { pole_a: 0, shared: 1, pole_b: 4 },
            coverage_shares: { pole_a: 0, shared: 0.2, pole_b: 0.8 },
            representative_article: {
              id: 11,
              title: "Lead article",
              source: "Example Wire",
              url: "https://example.com/article",
              image_url: null,
              published_at: "2026-03-21T11:00:00Z",
              summary: null,
              similarity: 1,
            },
            articles: [],
          },
        ],
        status: "ok",
      }),
    )
  })

  it("renders cards and switches lenses", async () => {
    const user = userEvent.setup()

    renderWithQueryClient(<BlindspotView category="all" />)

    expect(await screen.findByText("Blindspot Viewer")).toBeInTheDocument()
    expect(await screen.findByText("Campaign rally")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Credible vs Uncredible" }))

    await waitFor(() => {
      expect(mockFetchBlindspotViewer).toHaveBeenLastCalledWith(
        expect.objectContaining({ lens: "credibility" }),
      )
    })

    expect(await screen.findByText("Verification push")).toBeInTheDocument()
    expect(
      screen.getByRole("heading", { name: "For High Credibility" }),
    ).toBeInTheDocument()
  })
})
