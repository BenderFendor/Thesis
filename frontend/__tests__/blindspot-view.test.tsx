import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { screen, waitFor } from "@testing-library/react";
import { BlindspotView } from "@/components/blindspot-view";
import type { BlindspotViewServices } from "@/components/blindspot-view";
import { renderWithQueryClient } from "@/test-utils/render-with-query-client";
import userEvent from "@testing-library/user-event";

const fetchBlindspotViewer = jest.fn<BlindspotViewServices["fetchBlindspotViewer"]>();
const blindspotServices = { fetchBlindspotViewer };

describe("blindspotView", () => {
  beforeEach(() => {
    fetchBlindspotViewer.mockReset();
    fetchBlindspotViewer.mockImplementation((params) => {
      const lens = params?.lens;
      return Promise.resolve({
      available_lenses: [
        {
          available: true,
          description: "Bias lens",
          id: "bias",
          label: "Left vs Right",
          unavailable_reason: null,
        },
        {
          available: true,
          description: "Credibility lens",
          id: "credibility",
          label: "Credible vs Uncredible",
          unavailable_reason: null,
        },
      ],
      cards: Array.from({ length: 12 }, (_item, index) => {
        const clusterLabel = () => {
          if (lens === "credibility" && index === 0) {
            return "Verification push";
          }
          if (index === 0) {
            return "Campaign rally";
          }
          return `Blindspot ${index + 1}`;
        };
        return {
        article_count: 5 + index,
        articles: [
          {
            id: 200 + index,
            image_url: null,
            published_at: "2026-03-21T11:00:00Z",
            similarity: 1,
            source: "Example Wire",
            source_id: "example-wire",
            summary: null,
            title: "Article one",
            url: "https://example.com/article-one",
          },
          {
            id: 300 + index,
            image_url: null,
            published_at: "2026-03-21T11:00:00Z",
            similarity: 0.9,
            source: "Second Desk",
            source_id: "second-desk",
            summary: null,
            title: "Article two",
            url: "https://example.com/article-two",
          },
        ],
        balance_score: 0.1,
        blindspot_score: 20 - index,
        cluster_id: index + 1,
        cluster_label: clusterLabel(),
        coverage_counts: { pole_a: 0, pole_b: 4, shared: 1 },
        coverage_shares: { pole_a: 0, pole_b: 0.8, shared: 0.2 },
        explanation: "4 sources versus 0 sources.",
        geography_signals: [],
        keywords: ["campaign", "policy"],
        lane: "pole_a" as const,
        paywall_concentration: {
          best_free_sources: [],
          free_articles: 2,
          paywall_share: 0,
          paywalled_articles: 0,
          status: "low",
          total_articles: 2,
          unknown_articles: 0,
        },
        published_at: "2026-03-21T11:00:00Z",
        representative_article: {
          id: 100 + index,
          image_url: null,
          published_at: "2026-03-21T11:00:00Z",
          similarity: 1,
          source: "Example Wire",
          source_id: "example-wire",
          summary: null,
          title: "Lead article",
          url: "https://example.com/article",
        },
        source_count: 4,
        };
      }),
      lanes: [
        {
          cluster_count: 1,
          description: "Lane A",
          id: "pole_a",
          label: (() => {
  if (lens === "credibility") {
    return "For High Credibility";
  }
  return "For the Left";
})(),
        },
        {
          cluster_count: 1,
          description: "Lane shared",
          id: "shared",
          label: "Shared Coverage",
        },
        {
          cluster_count: 1,
          description: "Lane B",
          id: "pole_b",
          label: (() => {
  if (lens === "credibility") {
    return "For Low Credibility";
  }
  return "For the Right";
})(),
        },
      ],
      selected_lens: {
        available: true,
        description: (() => {
  if (lens === "credibility") {
    return "Credibility lens";
  }
  return "Bias lens";
})(),
        id: (() => {
  if (lens === "credibility") {
    return "credibility";
  }
  return "bias";
})(),
        label: (() => {
  if (lens === "credibility") {
    return "Credible vs Uncredible";
  }
  return "Left vs Right";
})(),
        unavailable_reason: null,
      },
      status: "ok",
      summary: {
        category: "all",
        eligible_clusters: 6,
        generated_at: "2026-03-21T12:00:00Z",
        source_filters: [],
        total_clusters: 12,
        window: "1w",
      },
      });
    });
  });

  it("renders cards and switches lenses", async () => {
    expect.hasAssertions();

    const user = userEvent.setup();

    renderWithQueryClient(<BlindspotView category="all" services={blindspotServices} />);

    await expect(screen.findByText("Media Blindspots")).resolves.toBeInTheDocument();
    const initialCampaignLabels = await screen.findAllByText("Campaign rally");
    expect(initialCampaignLabels.length).toBeGreaterThan(0);

    const lensSelect = screen.getByDisplayValue("Left vs Right");
    await user.selectOptions(lensSelect, "credibility");

    await waitFor(() => {
      expect(fetchBlindspotViewer).toHaveBeenLastCalledWith(
        expect.objectContaining({ lens: "credibility" }),
      );
    });

    const verificationLabels = await screen.findAllByText("Verification push");
    expect(verificationLabels.length).toBeGreaterThan(0);
    expect(screen.getAllByText(/For High Credibility/iu).length).toBeGreaterThan(0);
  });

  it("reveals additional lane cards on demand", async () => {
    expect.hasAssertions();

    const user = userEvent.setup();

    renderWithQueryClient(<BlindspotView category="all" services={blindspotServices} />);

    const campaignLabels = await screen.findAllByText("Campaign rally");
    expect(campaignLabels.length).toBeGreaterThan(0);
    expect(screen.queryByText("Blindspot 11")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /show 2 more blindspots/iu }));

    const additionalLabels = await screen.findAllByText("Blindspot 11");
    expect(additionalLabels.length).toBeGreaterThan(0);
    expect(screen.getAllByText(/2 sampled articles/iu).length).toBeGreaterThan(0);
  });
});
