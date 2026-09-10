import type {
  SourceLedger,
  SourceLedgerMetric,
  WikiAnalysisAxis,
  WikiSourceProfile,
} from "@/lib/api";
import type { DeepReadonly as DeepReadonlyType } from "@/lib/deep-readonly";
import type {
  parseFundingAndBias,
  parseOwnershipChain,
} from "@/features/intelligence-atlas/lib/atlas-schema";

type DeepReadonly<Value> = DeepReadonlyType<Value>;
type ReadonlyAnalysisAxis = DeepReadonly<WikiAnalysisAxis>;
type ReadonlyFundingAndBias = DeepReadonly<ReturnType<typeof parseFundingAndBias>>;
type ReadonlyOwnershipChain = DeepReadonly<ReturnType<typeof parseOwnershipChain>>;
type ReadonlySourceLedger = DeepReadonly<SourceLedger>;
type ReadonlySourceLedgerMetric = DeepReadonly<SourceLedgerMetric>;
type ReadonlySourceProfile = DeepReadonly<WikiSourceProfile>;
type SourceWikiViewProps = Readonly<{ sourceName: string }>;

export type {
  DeepReadonly,
  ReadonlyAnalysisAxis,
  ReadonlyFundingAndBias,
  ReadonlyOwnershipChain,
  ReadonlySourceLedger,
  ReadonlySourceLedgerMetric,
  ReadonlySourceProfile,
  SourceWikiViewProps,
};
