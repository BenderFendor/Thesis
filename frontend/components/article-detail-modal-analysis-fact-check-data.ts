import type {
  FactCheckResult,
  FactCheckStatus,
  FactCheckStatusFilter,
} from "../lib/article-detail-modal-data";

const STATUS_FILTERS: FactCheckStatusFilter[] = [
  "all",
  "verified",
  "partially-verified",
  "unverified",
  "false",
];

const VERIFICATION_LABEL_MAP = {
  false: "false",
  "partially-verified": "partially verified",
  unverified: "unverified",
  verified: "verified",
} satisfies Record<FactCheckStatus, string>;

const VERIFICATION_STYLE_MAP = {
  false: "bg-rose-500/15 text-rose-200 border border-rose-500/40",
  "partially-verified": "bg-amber-500/15 text-amber-200 border border-amber-500/40",
  unverified: "bg-slate-600/20 text-slate-200 border border-slate-500/40",
  verified: "bg-primary/15 text-primary border border-primary/40",
} satisfies Record<FactCheckStatus, string>;

const getConfidenceColor = (confidence: FactCheckResult["confidence"]) => {
  switch (confidence) {
    case "high": {
      return "bg-primary/15 text-primary border border-primary/40";
    }
    case "medium": {
      return "bg-amber-500/15 text-amber-200 border border-amber-500/40";
    }
    case "low": {
      return "bg-rose-500/15 text-rose-200 border border-rose-500/40";
    }
    default: {
      return "bg-slate-600/20 text-slate-200 border border-slate-500/40";
    }
  }
};

export { STATUS_FILTERS, VERIFICATION_LABEL_MAP, VERIFICATION_STYLE_MAP, getConfidenceColor };
