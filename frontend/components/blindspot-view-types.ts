import type { fetchBlindspotViewer } from "@/lib/api";
import type {
  BlindspotCard,
  BlindspotLane,
  BlindspotLens,
  TrendingCluster,
} from "@/lib/api/types";
import type { DeepReadonly } from "@/lib/deep-readonly";

interface BlindspotViewProps {
  readonly category?: string;
  readonly sources?: readonly string[];
}

interface BlindspotViewServices {
  readonly fetchBlindspotViewer: typeof fetchBlindspotViewer;
}

type SortMode = "asymmetry" | "largest" | "recent";
type ReadonlyBlindspotCard = DeepReadonly<BlindspotCard>;
type ReadonlyBlindspotLens = DeepReadonly<BlindspotLens>;
type ReadonlyBlindspotLane = DeepReadonly<BlindspotLane>;
type ReadonlyBlindspotServices = DeepReadonly<BlindspotViewServices>;
type ReadonlyBlindspotViewProps = DeepReadonly<
  BlindspotViewProps & { services?: BlindspotViewServices }
>;
type BlindspotLaneId = ReadonlyBlindspotLane["id"];
type BlindspotPoleLabels = Readonly<{ pole_a: string; pole_b: string }>;

interface LeadStoryMeta {
  readonly imageUrl?: string | null;
  readonly isLackingPoleA: boolean;
  readonly isLackingPoleB: boolean;
  readonly blindspotLabel: string;
  readonly blindspotValue: number;
  readonly sourceSummary: string | null;
  readonly paywallText: string | null;
}

interface BlindspotControlsProps {
  readonly availableLenses: readonly ReadonlyBlindspotLens[];
  readonly selectedLens: ReadonlyBlindspotLens["id"];
  readonly sortMode: SortMode;
  readonly onLensChange: (lens: ReadonlyBlindspotLens["id"]) => void;
  readonly onSortChange: (mode: SortMode) => void;
}

interface LeadStoryProps {
  readonly card: ReadonlyBlindspotCard;
  readonly laneId: BlindspotLaneId;
  readonly poleLabels: BlindspotPoleLabels;
  readonly onOpen: (card: ReadonlyBlindspotCard) => void;
}

interface StoryRowProps {
  readonly card: ReadonlyBlindspotCard;
  readonly poleLabels: BlindspotPoleLabels;
  readonly onOpen: (card: ReadonlyBlindspotCard) => void;
}

type MobileBlindspotTileProps = LeadStoryProps;

interface BlindspotLaneCardsProps {
  readonly cards: readonly ReadonlyBlindspotCard[];
  readonly emptyLabel: string;
  readonly expanded: boolean;
  readonly onExpand: () => void;
  readonly onOpen: (card: ReadonlyBlindspotCard) => void;
  readonly poleLabels: BlindspotPoleLabels;
}

interface BlindspotLaneSectionProps {
  readonly accentClass: string;
  readonly emptyLabel: string;
  readonly expandedLanes: Readonly<Record<BlindspotLaneId, boolean>>;
  readonly laneId: BlindspotLaneId;
  readonly laneMap: ReadonlyMap<BlindspotLaneId, readonly ReadonlyBlindspotCard[]>;
  readonly onExpandLane: (laneId: BlindspotLaneId) => void;
  readonly onOpenCard: (card: ReadonlyBlindspotCard) => void;
  readonly poleLabels: BlindspotPoleLabels;
  readonly subtitle: string;
  readonly subtitleMobile?: string;
  readonly title: string;
  readonly titleMobile?: string;
}

interface BlindspotLaneSectionsProps {
  readonly expandedLanes: Readonly<Record<BlindspotLaneId, boolean>>;
  readonly laneMap: ReadonlyMap<BlindspotLaneId, readonly ReadonlyBlindspotCard[]>;
  readonly onExpandLane: (laneId: BlindspotLaneId) => void;
  readonly onOpenCard: (card: ReadonlyBlindspotCard) => void;
  readonly poleLabels: BlindspotPoleLabels;
}

interface BlindspotClusterModalProps {
  readonly cluster: TrendingCluster | null;
  readonly onClose: () => void;
}

interface MobileBlindspotTileMediaProps {
  readonly blindspotLabel: string;
  readonly blindspotValue: number;
  readonly card: Readonly<
    Pick<
      BlindspotCard,
      "cluster_label" | "published_at" | "representative_article" | "source_count"
    >
  >;
  readonly paywallText: string | null;
}

interface MobileBlindspotTileDetailsProps {
  readonly card: Readonly<Pick<BlindspotCard, "cluster_label" | "coverage_shares">>;
  readonly poleLabels: BlindspotPoleLabels;
}

interface CoverageBarProps {
  readonly card: DeepReadonly<Pick<BlindspotCard, "coverage_shares">>;
}

interface GeographySignalBadgesProps {
  readonly card: ReadonlyBlindspotCard;
}

interface BlindspotResultsProps {
  readonly data: Readonly<{
    available_lenses: readonly BlindspotLens[];
    selected_lens: BlindspotLens;
  }>;
  readonly expandedLanes: Readonly<Record<BlindspotLaneId, boolean>>;
  readonly laneMap: ReadonlyMap<BlindspotLaneId, readonly ReadonlyBlindspotCard[]>;
  readonly onExpandLane: (laneId: BlindspotLaneId) => void;
  readonly onOpenCard: (card: ReadonlyBlindspotCard) => void;
  readonly poleLabels: BlindspotPoleLabels;
  readonly selectedLens: ReadonlyBlindspotLens["id"];
  readonly sortMode: SortMode;
  readonly onLensChange: (lens: ReadonlyBlindspotLens["id"]) => void;
  readonly onSortChange: (mode: SortMode) => void;
}

export type {
  BlindspotClusterModalProps,
  BlindspotControlsProps,
  BlindspotLaneCardsProps,
  BlindspotLaneId,
  BlindspotLaneSectionProps,
  BlindspotLaneSectionsProps,
  BlindspotPoleLabels,
  BlindspotResultsProps,
  BlindspotViewProps,
  BlindspotViewServices,
  CoverageBarProps,
  GeographySignalBadgesProps,
  LeadStoryMeta,
  LeadStoryProps,
  MobileBlindspotTileDetailsProps,
  MobileBlindspotTileMediaProps,
  MobileBlindspotTileProps,
  ReadonlyBlindspotCard,
  ReadonlyBlindspotLane,
  ReadonlyBlindspotLens,
  ReadonlyBlindspotServices,
  ReadonlyBlindspotViewProps,
  SortMode,
  StoryRowProps,
};
