"use client";

import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";

interface FundingBiasFieldView {
  readonly asserted_by?: string | null | undefined;
  readonly claim_ids: readonly string[];
  readonly evidence: readonly FundingBiasEvidenceView[];
  readonly evidence_count: number;
  readonly origin?: "claim" | "legacy" | null | undefined;
  readonly source?: string | null | undefined;
  readonly value?: string | null | undefined;
}

interface FundingBiasEvidenceView {
  readonly source_url?: string | null | undefined;
}

interface FundingBiasAndBiasView {
  readonly bias_rating: FundingBiasFieldView;
  readonly factual_reporting: FundingBiasFieldView;
  readonly funding_type: FundingBiasFieldView;
}

interface FundingBiasFieldProps {
  readonly field: FundingBiasFieldView;
  readonly fieldKey: "funding_type" | "bias_rating" | "factual_reporting";
}

interface FundingBiasFieldHeaderProps {
  readonly field: FundingBiasFieldView;
  readonly label: string;
}

interface FundingBiasFieldValueProps {
  readonly field: FundingBiasFieldView;
  readonly label: string;
}

interface FundingBiasPanelProps {
  readonly block: FundingBiasAndBiasView;
}

const CorrelationCaption = () => (
    <p className="rounded-xl border border-white/5 bg-black/10 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
      Correlation shown, not proven causation — values are attributed to their sources.
    </p>
  ),
  EMPTY_COUNT = 0,
  EvidenceText = (props: Readonly<FundingBiasFieldValueProps>): ReactNode => {
    if (props.field.origin !== "claim" || props.field.claim_ids.length === EMPTY_COUNT) {
      return false;
    }

    const evidenceLink = getEvidenceLink(props.field),
      evidenceText = `${props.field.evidence_count} evidence`;
    if (evidenceLink === "") {
      return <span className="font-mono text-[10px] tracking-widest text-muted-foreground">{evidenceText}</span>;
    }

    return (
      <a
        href={evidenceLink}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-1 text-muted-foreground transition-colors hover:text-white"
        aria-label={`${props.label} evidence`}
      >
        <ExternalLink className="h-3 w-3" />
        <span className="font-mono text-[10px] tracking-widest">{evidenceText}</span>
      </a>
    );
  },
  FIELD_LABELS = {
    bias_rating: "Bias rating",
    factual_reporting: "Factual reporting",
    funding_type: "Funding type",
  } satisfies Record<"funding_type" | "bias_rating" | "factual_reporting", string>,
  FundingBiasField = (props: Readonly<FundingBiasFieldProps>) => {
    const label = FIELD_LABELS[props.fieldKey];
    return (
      <div className="rounded-xl border border-white/5 bg-black/20 px-3 py-2.5">
        <FundingBiasFieldHeader field={props.field} label={label} />
        <FundingBiasFieldValue field={props.field} label={label} />
        <MbfcNote field={props.field} />
      </div>
    );
  },
  FundingBiasFieldHeader = (props: Readonly<FundingBiasFieldHeaderProps>) => (
    <div className="flex items-center justify-between gap-2">
      <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{props.label}</span>
      <OriginBadge field={props.field} />
    </div>
  ),
  FundingBiasFieldValue = (props: Readonly<FundingBiasFieldValueProps>) => (
    <div className="mt-1.5 flex items-center gap-2">
      <span className="font-serif text-base">{formatFieldValue(props.field.value)}</span>
      <EvidenceText field={props.field} label={props.label} />
    </div>
  ),
  FundingBiasPanel = (props: Readonly<FundingBiasPanelProps>) => (
    <div className="space-y-3">
      <FundingBiasPanelGrid block={props.block} />
      <CorrelationCaption />
    </div>
  ),
  FundingBiasPanelGrid = (props: Readonly<FundingBiasPanelProps>) => (
    <div className="grid gap-2 sm:grid-cols-3">
      <FundingBiasField fieldKey="funding_type" field={props.block.funding_type} />
      <FundingBiasField fieldKey="bias_rating" field={props.block.bias_rating} />
      <FundingBiasField fieldKey="factual_reporting" field={props.block.factual_reporting} />
    </div>
  ),
  MbfcBadge = (props: Readonly<{ readonly mbfc: boolean }>) => {
    let label = "cited";
    if (props.mbfc) {
      label = "MBFC";
    }

    return (
      <span className="rounded-full border border-white/10 bg-black/30 px-2 py-0.5 font-mono text-[9px] uppercase tracking-widest text-[#b8d7ff]">
        {label}
      </span>
    );
  },
  MbfcNote = (props: Readonly<{ readonly field: FundingBiasFieldView }>): ReactNode => {
    const hasValue = props.field.value ?? "";
    if (!isMbfc(props.field) || hasValue === "") {
      return false;
    }

    return <p className="mt-1 text-xs text-muted-foreground">Rated by Media Bias/Fact Check (MBFC).</p>;
  },
  OriginBadge = (props: Readonly<{ readonly field: FundingBiasFieldView }>): ReactNode => {
    if (props.field.origin === "claim") {
      return <MbfcBadge mbfc={isMbfc(props.field)} />;
    }

    if (props.field.origin === "legacy") {
      return (
        <span className="rounded-full border border-white/10 bg-black/30 px-2 py-0.5 font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
          uncited
        </span>
      );
    }

    return false;
  },
  formatFieldValue = (value: string | null | undefined): string => {
    if (value?.length === EMPTY_COUNT) {
      return "Not recorded";
    }

    return value ?? "Not recorded";
  },
  getEvidenceLink = (field: Readonly<FundingBiasFieldView>): string => {
    const evidence = field.evidence.find((item) => (item.source_url ?? "") !== "");
    if (evidence === undefined) {
      return "";
    }

    return evidence.source_url ?? "";
  },
  isMbfc = (field: Readonly<FundingBiasFieldView>): boolean =>
    field.asserted_by === "mbfc" || field.source === "mbfc";

/**
 * Renders the per-entity funding and bias evidence panel.
 *
 * @param props The parsed funding and bias record for one entity.
 * @returns The funding and bias evidence panel.
 */
export { FundingBiasPanel };
