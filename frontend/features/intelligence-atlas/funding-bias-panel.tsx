"use client";

import { ExternalLink } from "lucide-react";

import type { AtlasFundingAndBias, AtlasFundingBiasField } from "./lib/atlas-schema";

const FIELD_LABELS: Record<"funding_type" | "bias_rating" | "factual_reporting", string> = {
  bias_rating: "Bias rating",
  factual_reporting: "Factual reporting",
  funding_type: "Funding type",
};

function isMbfc(field: AtlasFundingBiasField): boolean {
  return field.asserted_by === "mbfc" || field.source === "mbfc";
}

function FundingBiasField({
  fieldKey,
  field,
}:Readonly< {
  fieldKey: "funding_type" | "bias_rating" | "factual_reporting";
  field: AtlasFundingBiasField;
}>) {
  const label = FIELD_LABELS[fieldKey],
   hasValue = Boolean(field.value),
   evidenceLink = field.evidence.find((item) => item.source_url)?.source_url;

  return (
    <div className="rounded-xl border border-white/5 bg-black/20 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{label}</span>
        {field.origin === "claim" ? (
          <span className="rounded-full border border-white/10 bg-black/30 px-2 py-0.5 font-mono text-[9px] uppercase tracking-widest text-[#b8d7ff]">
            {isMbfc(field) ? "MBFC" : "cited"}
          </span>
        ) : (field.origin === "legacy" ? (
          <span className="rounded-full border border-white/10 bg-black/30 px-2 py-0.5 font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
            uncited
          </span>
        ) : null)}
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <span className="font-serif text-base">{hasValue ? field.value : "Not recorded"}</span>
        {field.origin === "claim" && field.claim_ids.length > 0 ? (
          evidenceLink ? (
            <a
              href={evidenceLink}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-muted-foreground transition-colors hover:text-white"
              aria-label={`${label} evidence`}
            >
              <ExternalLink className="h-3 w-3" />
              <span className="font-mono text-[10px] tracking-widest">{field.evidence_count} evidence</span>
            </a>
          ) : (
            <span className="font-mono text-[10px] tracking-widest text-muted-foreground">
              {field.evidence_count} evidence
            </span>
          )
        ) : null}
      </div>
      {isMbfc(field) && hasValue ? (
        <p className="mt-1 text-xs text-muted-foreground">Rated by Media Bias/Fact Check (MBFC).</p>
      ) : null}
    </div>
  );
}

/**
 * Phase 5's per-entity "Funding & Bias" panel: funding type beside MBFC
 * bias/factuality ratings, each claim-backed value linking to its citing
 * evidence, with a persistent, non-dismissible correlation-not-causation
 * caption. Used on both the outlet (source) and organization detail pages.
 */
export function FundingBiasPanel({ block }:Readonly< { block: AtlasFundingAndBias }>) {
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-3">
        <FundingBiasField fieldKey="funding_type" field={block.funding_type} />
        <FundingBiasField fieldKey="bias_rating" field={block.bias_rating} />
        <FundingBiasField fieldKey="factual_reporting" field={block.factual_reporting} />
      </div>
      <p className="rounded-xl border border-white/5 bg-black/10 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
        Correlation shown, not proven causation — values are attributed to their sources.
      </p>
    </div>
  );
}
