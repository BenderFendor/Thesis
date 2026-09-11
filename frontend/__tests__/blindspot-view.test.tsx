import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BlindspotView } from "@/components/blindspot-view";
import type { BlindspotViewServices } from "@/components/blindspot-view";
import type { BlindspotCard, BlindspotLane, BlindspotLens } from "@/lib/api/types";
import { renderWithQueryClient } from "@/test-utils/render-with-query-client";

type BlindspotViewerParams = Parameters<BlindspotViewServices["fetchBlindspotViewer"]>[0];
type BlindspotViewerResponse = Awaited<
  ReturnType<BlindspotViewServices["fetchBlindspotViewer"]>
>;
type BlindspotPreviewArticle = BlindspotCard["articles"][number];

const fetchBlindspotViewer = jest.fn<BlindspotViewServices["fetchBlindspotViewer"]>();
const blindspotServices = { fetchBlindspotViewer };

const createPreviewArticle = (
  id: number,
  title: string,
  similarity: number,
  source: string,
  urlPath: string,
): BlindspotPreviewArticle => ({
  id,
  image_url: null,
  published_at: "2026-03-21T11:00:00Z",
  similarity,
  source,
  source_id: source.toLowerCase().replaceAll(" ", "-"),
  summary: null,
  title,
  url: `https://example.com/${urlPath}`,
});

const getClusterLabel = (index: number, lens: BlindspotLens["id"] | undefined): string => {
  if (lens === "credibility" && index === 0) {
    return "Verification push";
  }
  if (index === 0) {
    return "Campaign rally";
  }
  return `Blindspot ${index + 1}`;
};

const createBlindspotCard = (
  index: number,
  lens: BlindspotLens["id"] | undefined,
): BlindspotCard => ({
  article_count: 5 + index,
  articles: [
    createPreviewArticle(
      200 + index,
      "Article one",
      1,
      "Example Wire",
      "article-one",
    ),
    createPreviewArticle(
      300 + index,
      "Article two",
      0.9,
      "Second Desk",
      "article-two",
    ),
  ],
  balance_score: 0.1,
  blindspot_score: 20 - index,
  cluster_id: index + 1,
  cluster_label: getClusterLabel(index, lens),
  coverage_counts: { pole_a: 0, pole_b: 4, shared: 1 },
  coverage_shares: { pole_a: 0, pole_b: 0.8, shared: 0.2 },
  explanation: "4 sources versus 0 sources.",
  geography_signals: [],
  keywords: ["campaign", "policy"],
  lane: "pole_a",
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
  representative_article: createPreviewArticle(
    100 + index,
    "Lead article",
    1,
    "Example Wire",
    "article",
  ),
  source_count: 4,
});

const getLaneLabel = (
  lens: BlindspotLens["id"] | undefined,
  credibilityLabel: string,
  biasLabel: string,
): string => {
  if (lens === "credibility") {
    return credibilityLabel;
  }
  return biasLabel;
};

const createBlindspotLanes = (lens: BlindspotLens["id"] | undefined): BlindspotLane[] => [
  {
    cluster_count: 1,
    description: "Lane A",
    id: "pole_a",
    label: getLaneLabel(lens, "For High Credibility", "For the Left"),
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
    label: getLaneLabel(lens, "For Low Credibility", "For the Right"),
  },
];

const createSelectedLens = (lens: BlindspotLens["id"] | undefined): BlindspotLens => {
  if (lens === "credibility") {
    return {
      available: true,
      description: "Credibility lens",
      id: "credibility",
      label: "Credible vs Uncredible",
      unavailable_reason: null,
    };
  }
  return {
    available: true,
    description: "Bias lens",
    id: "bias",
    label: "Left vs Right",
    unavailable_reason: null,
  };
};

const AVAILABLE_BLINDSPOT_LENSES: BlindspotLens[] = [
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
];

const BLINDSPOT_SUMMARY: BlindspotViewerResponse["summary"] = {
  category: "all",
  eligible_clusters: 6,
  generated_at: "2026-03-21T12:00:00Z",
  source_filters: [],
  window: "1w",
};

const createBlindspotResponse = (
  params?: BlindspotViewerParams,
): Promise<BlindspotViewerResponse> => {
  const lens = params?.lens;
  return Promise.resolve({
    available_lenses: AVAILABLE_BLINDSPOT_LENSES,
    cards: Array.from({ length: 12 }, (_item, index) => createBlindspotCard(index, lens)),
    lanes: createBlindspotLanes(lens),
    selected_lens: createSelectedLens(lens),
    status: "ok",
    summary: BLINDSPOT_SUMMARY,
  });
};

const renderBlindspot = () => {
  const user = userEvent.setup();
  renderWithQueryClient(<BlindspotView category="all" services={blindspotServices} />);
  return user;
};

const expectTextVisible = async (text: string): Promise<void> => {
  const element = await screen.findByText(text);
  expect(element).toBeInTheDocument();
};

const expectTextCount = async (text: string): Promise<void> => {
  const elements = await screen.findAllByText(text);
  expect(elements.length).toBeGreaterThan(0);
};

const rendersCardsAndSwitchesLenses = async (): Promise<void> => {
  const user = renderBlindspot();
  await expectTextVisible("Media Blindspots");
  await expectTextCount("Campaign rally");
  const lensSelect = screen.getByDisplayValue("Left vs Right");
  await user.selectOptions(lensSelect, "credibility");
  await waitFor(() => {
    expect(fetchBlindspotViewer).toHaveBeenLastCalledWith(
      expect.objectContaining({ lens: "credibility" }),
    );
  });
  await expectTextCount("Verification push");
  expect(screen.getAllByText(/For High Credibility/iu).length).toBeGreaterThan(0);
};

const revealsAdditionalLaneCards = async (): Promise<void> => {
  const user = renderBlindspot();
  await expectTextCount("Campaign rally");
  expect(screen.queryByText("Blindspot 11")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /show 2 more blindspots/iu }));
  await expectTextCount("Blindspot 11");
  expect(screen.getAllByText(/2 sampled articles/iu).length).toBeGreaterThan(0);
};

describe("blindspotView", () => {
  beforeEach(() => {
    fetchBlindspotViewer.mockReset();
    fetchBlindspotViewer.mockImplementation(createBlindspotResponse);
  });

  it("renders cards and switches lenses", async () => {
    await rendersCardsAndSwitchesLenses();
    expect(fetchBlindspotViewer).toHaveBeenCalledWith(expect.objectContaining({ category: "all" }));
  });

  it("reveals additional lane cards on demand", async () => {
    await revealsAdditionalLaneCards();
    expect(fetchBlindspotViewer).toHaveBeenCalledWith(expect.objectContaining({ category: "all" }));
  });
});
