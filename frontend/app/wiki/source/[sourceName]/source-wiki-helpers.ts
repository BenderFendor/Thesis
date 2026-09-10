import { useSyncExternalStore } from "react";
import { triggerWikiIndex } from "@/lib/api";
import type { DeepReadonly } from "@/lib/deep-readonly";
import { hasText as textValueIsPresent } from "@/lib/utils";
import {
  parseFundingAndBias,
  parseOwnershipChain,
} from "@/features/intelligence-atlas/lib/atlas-schema";
import type { AtlasEntityRecord } from "@/features/intelligence-atlas/lib/atlas-schema";
import type {
  ReadonlyAnalysisAxis,
  ReadonlyFundingAndBias,
  ReadonlyOwnershipChain,
} from "./source-wiki-types";

type AtlasEntityDetails = Pick<AtlasEntityRecord, "details">;
type AnalysisMeta = Readonly<{ label: string; description: string }>;
const hasText = textValueIsPresent;

const ANALYSIS_META = {
  credibility: { description: "Correction and reliability track record.", label: "Credibility" },
  framing_omission: { description: "Loaded framing and omissions.", label: "Framing / Omission" },
  funding: { description: "Funding and structural dependency.", label: "Funding" },
  political_bias: { description: "Observed ideological tilt.", label: "Political Bias" },
  source_network: { description: "Who the outlet relies on.", label: "Source Network" },
} as const satisfies Readonly<Record<string, AnalysisMeta>>;

const ANALYSIS_ORDER = [
  "funding",
  "source_network",
  "political_bias",
  "credibility",
  "framing_omission",
] as const;

const isAnalysisMetaKey = (value: string): value is keyof typeof ANALYSIS_META =>
  Object.hasOwn(ANALYSIS_META, value);

const getAnalysisMeta = (axisName: string): AnalysisMeta => {
  if (isAnalysisMetaKey(axisName)) {
    return ANALYSIS_META[axisName];
  }
  return { description: "Stored score data.", label: axisName };
};

const getEmbeddedSnapshot = (): boolean =>
  globalThis.window !== undefined &&
  new URLSearchParams(globalThis.location.search).get("embedded") === "1";

const getServerEmbeddedSnapshot = (): boolean => false;
const subscribeToLocation = (): (() => void) => () => {};

const useEmbeddedFlag = (): boolean =>
  useSyncExternalStore(subscribeToLocation, getEmbeddedSnapshot, getServerEmbeddedSnapshot);

const getAverageScore = (axes: readonly ReadonlyAnalysisAxis[] | undefined): number | null => {
  if (axes === undefined || axes.length === 0) {
    return null;
  }
  return axes.reduce((sum, axis) => sum + axis.score, 0) / axes.length;
};

const getFundingAndBias = (entity: AtlasEntityDetails | undefined): ReadonlyFundingAndBias => {
  if (entity === undefined) {
    return null;
  }
  return parseFundingAndBias(entity.details);
};

const getOwnershipChain = (entity: AtlasEntityDetails | undefined): ReadonlyOwnershipChain => {
  if (entity === undefined) {
    return [];
  }
  return parseOwnershipChain(entity.details);
};

const runWikiIndex = async ({
  sourceName,
  setIndexing,
  refetch,
}: DeepReadonly<{
  sourceName: string;
  setIndexing: (value: boolean) => void;
  refetch: () => Promise<void>;
}>): Promise<void> => {
  setIndexing(true);
  try {
    await triggerWikiIndex(sourceName);
    await refetch();
  } finally {
    setIndexing(false);
  }
};

const formatLedgerValue = (value: number, unit: string): string => {
  if (unit === "share") {
    return `${Math.round(value * 100)}%`;
  }
  return `${value} ${unit}`;
};

const scoreColor = (score: number): string => `hsl(${(5 - score) * 24}, 70%, 55%)`;

const scoreStyleFor = (score: number) =>
  ({ color: scoreColor(score) }) satisfies Readonly<{ color: string }>;

export {
  ANALYSIS_META,
  ANALYSIS_ORDER,
  formatLedgerValue,
  getAverageScore,
  getAnalysisMeta,
  getFundingAndBias,
  getOwnershipChain,
  hasText,
  isAnalysisMetaKey,
  runWikiIndex,
  scoreStyleFor,
  useEmbeddedFlag,
};
