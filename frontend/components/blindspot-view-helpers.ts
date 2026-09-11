import type { BlindspotCard, BlindspotLens, TrendingCluster } from "@/lib/api";
import { hasText } from "@/lib/utils";
import type { DeepReadonly } from "@/lib/deep-readonly";
import type {
  BlindspotLaneId,
  BlindspotPoleLabels,
  LeadStoryMeta,
  ReadonlyBlindspotCard,
  ReadonlyBlindspotLane,
  SortMode,
} from "@/components/blindspot-view-types";

const CARDS_PER_LANE = 18;
const DEFAULT_LENS: BlindspotLens["id"] = "bias";
const DEFAULT_VISIBLE_PER_LANE = 10;
const DEFAULT_WINDOW = "1w";
const EMPTY_BLINDSPOT_CARDS: readonly ReadonlyBlindspotCard[] = [];
const MOTION_VERTICAL_KEY = "y" as const;
const LANE_INITIAL = { opacity: 0, [MOTION_VERTICAL_KEY]: 20 } as const;
const LANE_ANIMATE = { opacity: 1, [MOTION_VERTICAL_KEY]: 0 } as const;
const LANE_TRANSITION = { duration: 0.5, ease: "easeOut" } as const;
const SORT_OPTIONS: readonly { readonly value: SortMode; readonly label: string }[] = [
  { label: "Most asymmetric", value: "asymmetry" },
  { label: "Largest story", value: "largest" },
  { label: "Most recent", value: "recent" },
];

const getPublishedTime = (publishedAt?: string | null): number => {
  if (hasText(publishedAt)) {
    return new Date(publishedAt).getTime();
  }
  return 0;
};

const sortCards = (
  cards: readonly ReadonlyBlindspotCard[],
  sortMode: SortMode,
): ReadonlyBlindspotCard[] => {
  if (sortMode === "largest") {
    return cards.toSorted((left, right) => right.article_count - left.article_count);
  }
  if (sortMode === "recent") {
    return cards.toSorted(
      (left, right) => getPublishedTime(right.published_at) - getPublishedTime(left.published_at),
    );
  }
  return cards.toSorted((left, right) => right.blindspot_score - left.blindspot_score);
};

const cardToClusterArticle = (article: DeepReadonly<BlindspotCard["articles"][number]>) => ({
  id: article.id,
  image_url: article.image_url ?? null,
  published_at: article.published_at ?? undefined,
  source: article.source,
  summary: article.summary ?? undefined,
  title: article.title,
  url: article.url,
});

const cardToCluster = (card: ReadonlyBlindspotCard): TrendingCluster => {
  const representativeArticle = card.representative_article;
  let representativeClusterArticle: ReturnType<typeof cardToClusterArticle> | null = null;
  if (representativeArticle !== null && representativeArticle !== undefined) {
    representativeClusterArticle = cardToClusterArticle(representativeArticle);
  }
  return {
    article_count: card.article_count,
    articles: card.articles.map(cardToClusterArticle),
    cluster_id: card.cluster_id,
    keywords: card.keywords,
    label: card.cluster_label,
    representative_article: representativeClusterArticle,
    source_diversity: card.source_count,
    trending_score: card.blindspot_score,
    velocity: card.balance_score,
    window_count: card.article_count,
  };
};

const articleSourceSummary = (card: ReadonlyBlindspotCard): string | null => {
  const uniqueSources = [...new Set(card.articles.map((article) => article.source))];
  if (uniqueSources.length === 0) {
    return null;
  }
  const remaining = uniqueSources.length - Math.min(uniqueSources.length, 3);
  const visibleSources = uniqueSources.slice(0, 3).join(" · ");
  if (remaining > 0) {
    return `${visibleSources} +${remaining} more`;
  }
  return visibleSources;
};

const paywallLabel = (card: ReadonlyBlindspotCard): string | null => {
  const paywall = card.paywall_concentration;
  if (paywall.total_articles === 0 || paywall.status === "low") {
    return null;
  }
  return `${Math.round(paywall.paywall_share * 100)}% paywalled`;
};

const displayPoleLabel = (label: string): string =>
  label.replace(/^For the\s+/iu, "the ").replace(/^For\s+/iu, "");

const getLeadStoryMeta = (
  card: ReadonlyBlindspotCard,
  laneId: ReadonlyBlindspotLane["id"],
  poleLabels: BlindspotPoleLabels,
): LeadStoryMeta => {
  const isLackingPoleA = laneId === "pole_b";
  const isLackingPoleB = laneId === "pole_a";
  let blindspotLabel = "Asymmetric";
  let blindspotValue = Math.round(card.coverage_shares.pole_b * 100);
  if (isLackingPoleA) {
    blindspotLabel = `Missed by ${poleLabels.pole_a}`;
    blindspotValue = Math.round(card.coverage_shares.pole_a * 100);
  } else if (isLackingPoleB) {
    blindspotLabel = `Missed by ${poleLabels.pole_b}`;
  }
  return {
    blindspotLabel,
    blindspotValue,
    imageUrl: card.representative_article?.image_url,
    isLackingPoleA,
    isLackingPoleB,
    paywallText: paywallLabel(card),
    sourceSummary: articleSourceSummary(card),
  };
};

const createLaneMap = (
  lanes: readonly ReadonlyBlindspotLane[],
  cards: readonly ReadonlyBlindspotCard[],
): ReadonlyMap<BlindspotLaneId, readonly ReadonlyBlindspotCard[]> => {
  const grouped = new Map<BlindspotLaneId, ReadonlyBlindspotCard[]>();
  for (const lane of lanes) {
    grouped.set(lane.id, []);
  }
  for (const card of cards) {
    const laneCards = grouped.get(card.lane);
    if (laneCards !== undefined) {
      laneCards.push(card);
    }
  }
  return grouped;
};

const getPoleLabels = (
  lanes: readonly ReadonlyBlindspotLane[] | undefined,
): BlindspotPoleLabels => {
  if (lanes === undefined) {
    return { pole_a: "Pole A", pole_b: "Pole B" };
  }
  const laneA = lanes.find((lane) => lane.id === "pole_a");
  const laneB = lanes.find((lane) => lane.id === "pole_b");
  return {
    pole_a: laneA?.label ?? "Pole A",
    pole_b: laneB?.label ?? "Pole B",
  };
};

export {
  CARDS_PER_LANE,
  DEFAULT_LENS,
  DEFAULT_VISIBLE_PER_LANE,
  DEFAULT_WINDOW,
  EMPTY_BLINDSPOT_CARDS,
  LANE_ANIMATE,
  LANE_INITIAL,
  LANE_TRANSITION,
  SORT_OPTIONS,
  articleSourceSummary,
  cardToCluster,
  createLaneMap,
  displayPoleLabel,
  getLeadStoryMeta,
  getPoleLabels,
  paywallLabel,
  sortCards,
};
