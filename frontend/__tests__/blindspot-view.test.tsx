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
          ...Array.from({ length: 12 }, (_, index) => ({
            cluster_id: index + 1,
            cluster_label:
              lens === "credibility" && index === 0
                ? "Verification push"
                : index === 0
                  ? "Campaign rally"
                  : `Blindspot ${index + 1}`,
            keywords: ["campaign", "policy"],
            article_count: 5 + index,
            source_count: 4,
            lane: "pole_a" as const,
            blindspot_score: 20 - index,
            balance_score: 0.1,
            published_at: "2026-03-21T11:00:00Z",
            explanation: "4 sources versus 0 sources.",
            coverage_counts: { pole_a: 0, shared: 1, pole_b: 4 },
            coverage_shares: { pole_a: 0, shared: 0.2, pole_b: 0.8 },
            representative_article: {
              id: 100 + index,
              title: "Lead article",
              source: "Example Wire",
              source_id: "example-wire",
              url: "https://example.com/article",
              image_url: null,
              published_at: "2026-03-21T11:00:00Z",
              summary: null,
              similarity: 1,
            },
            articles: [
              {
                id: 200 + index,
                title: "Article one",
                source: "Example Wire",
                source_id: "example-wire",
                url: "https://example.com/article-one",
                image_url: null,
                published_at: "2026-03-21T11:00:00Z",
                summary: null,
                similarity: 1,
              },
              {
                id: 300 + index,
                title: "Article two",
                source: "Second Desk",
                source_id: "second-desk",
                url: "https://example.com/article-two",
                image_url: null,
                published_at: "2026-03-21T11:00:00Z",
                summary: null,
                similarity: 0.9,
              },
            ],
          })),
        ],
        status: "ok",
      }),
    )
  })

  it("renders cards and switches lenses", async () => {
    const user = userEvent.setup()

    renderWithQueryClient(<BlindspotView category="all" />)

    expect(await screen.findByText("Media Blindspots")).toBeInTheDocument()
    expect(await screen.findByText("Campaign rally")).toBeInTheDocument()

    const [lensSelect] = await screen.findAllByRole("combobox")
    await user.selectOptions(lensSelect, "credibility")

    await waitFor(() => {
      expect(mockFetchBlindspotViewer).toHaveBeenLastCalledWith(
        expect.objectContaining({ lens: "credibility" }),
      )
    })

    expect(await screen.findByText("Verification push")).toBeInTheDocument()
    expect(screen.getAllByText(/For High Credibility/i).length).toBeGreaterThan(0)
  })

  it("reveals additional lane cards on demand", async () => {
    const user = userEvent.setup()

    renderWithQueryClient(<BlindspotView category="all" />)

    expect(await screen.findByText("Campaign rally")).toBeInTheDocument()
    expect(screen.queryByText("Blindspot 11")).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /show 2 more blindspots/i }))

    expect(await screen.findByText("Blindspot 11")).toBeInTheDocument()
    expect(screen.getAllByText(/2 sampled articles/i).length).toBeGreaterThan(0)
  })
})
