import type { CSSProperties } from "react";
import { CredibilityBadge } from "@/components/credibility-badge";
import type { NewsArticle } from "@/lib/api";
import { cn, hasText } from "@/lib/utils";
import type { ViewMode } from "@/components/global-navigation";
import { getLeadDetails } from "@/app/news-page-model";

const HALFTONE_STYLE = { filter: "url(#halftone-pattern)" } satisfies CSSProperties;

const HalftoneFilter = () => (
  <filter id="halftone-pattern">
    <feTurbulence type="fractalNoise" baseFrequency="3.0" numOctaves="2" result="noise" />
    <feColorMatrix in="noise" type="saturate" values="0" result="mono" />
    <feComponentTransfer in="mono" result="dots">
      <feFuncR type="discrete" tableValues="0 1" />
      <feFuncG type="discrete" tableValues="0 1" />
      <feFuncB type="discrete" tableValues="0 1" />
    </feComponentTransfer>
    <feComposite operator="in" in="SourceGraphic" in2="dots" />
  </filter>
);

const HalftoneOverlay = () => (
  <svg className="hidden" aria-hidden="true">
    <HalftoneFilter />
  </svg>
);

const StatCell = (props: Readonly<{ label: string; value: string; valueClassName: string }>) => (
  <div className="bg-[var(--news-bg-secondary)] p-2 space-y-0.5 sm:p-2.5 sm:space-y-1">
    <span className="block text-[7px] font-mono uppercase tracking-widest text-muted-foreground/50 sm:text-[8px]">
      {props.label}
    </span>
    <span className={`block ${props.valueClassName}`}>{props.value}</span>
  </div>
);

const LeadStory = (
  props: Readonly<{
    leadArticle: NewsArticle | null;
    leadDateLabel: string;
    leadSummary: string;
  }>,
) => (
  <div className="flex-1 min-w-0">
    <div className="mb-2 flex items-center gap-2 sm:mb-3 sm:gap-3">
      <span className="border bg-primary/10 px-2 py-0.5 font-mono text-[8px] uppercase tracking-[0.28em] text-primary border-primary/30 sm:text-[9px] sm:tracking-[0.4em]">
        Lead
      </span>
      <span className="font-mono text-[9px] text-muted-foreground/60 tracking-wider sm:text-[10px]">
        {props.leadDateLabel}
      </span>
    </div>

    <h2 className="mb-2 line-clamp-3 font-serif text-2xl font-semibold leading-tight tracking-tight sm:mb-4 sm:text-5xl">
      {props.leadArticle?.title ?? "Loading coverage..."}
    </h2>

    <p className="max-w-3xl text-sm leading-snug text-foreground/65 font-serif italic line-clamp-2 sm:text-lg sm:leading-relaxed">
      {props.leadSummary}
    </p>
  </div>
);

const LeadMetadata = (
  props: Readonly<{
    leadArticle: NewsArticle | null;
    articleCount: number;
    sourceCount: number;
    leadBias: string;
    leadCredibility: string;
  }>,
) => (
  <div className="shrink-0 flex flex-col gap-1 w-full sm:w-64 lg:w-72">
    <div className="grid grid-cols-2 gap-px bg-white/5 border border-white/10 overflow-hidden">
      <StatCell
        label="Live articles"
        value={String(props.articleCount)}
        valueClassName="text-sm font-semibold tabular-nums"
      />
      <StatCell
        label="Live sources"
        value={String(props.sourceCount)}
        valueClassName="text-sm font-semibold tabular-nums"
      />
      <StatCell
        label="Bias"
        value={props.leadBias}
        valueClassName="text-xs font-semibold text-primary/80 uppercase tracking-tighter"
      />
      <StatCell
        label="Signal"
        value={props.leadCredibility}
        valueClassName="text-xs font-semibold text-foreground/90 uppercase tracking-tighter"
      />
    </div>
    <div className="px-1 py-1 text-[9px] text-muted-foreground/50 italic leading-tight">
      {getLeadMetadataLabel(props.leadArticle)}
    </div>
    {props.leadArticle && (
      <CredibilityBadge domain={props.leadArticle.sourceId || props.leadArticle.source} size="sm" />
    )}
  </div>
);

const getLeadMetadataLabel = (article: NewsArticle | null): string => {
  if (hasText(article?.summary)) {
    return "Source metadata available for this story.";
  }
  return "Lead coverage loading...";
};

interface LeadSectionProps {
  readonly leadArticle: NewsArticle | null;
  readonly articleCount: number;
  readonly sourceCount: number;
  readonly isBlindspotView: boolean;
  readonly isGlobeView: boolean;
  readonly currentView: ViewMode;
}

const LeadDetailsRow = (
  props: Readonly<
    LeadSectionProps & { dateLabel: string; summary: string; bias: string; credibility: string }
  >,
) => (
  <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start sm:gap-4">
    <LeadStory
      leadArticle={props.leadArticle}
      leadDateLabel={props.dateLabel}
      leadSummary={props.summary}
    />
    <LeadMetadata
      articleCount={props.articleCount}
      leadArticle={props.leadArticle}
      leadBias={props.bias}
      leadCredibility={props.credibility}
      sourceCount={props.sourceCount}
    />
  </div>
);

const LeadSection = (props: Readonly<LeadSectionProps>) => {
  if (props.isGlobeView || props.currentView === "scroll") {
    return null;
  }
  const { dateLabel, summary, credibility, bias } = getLeadDetails(props.leadArticle);
  return (
    <div className={cn("relative p-3 sm:p-6", props.isBlindspotView && "hidden lg:block")}>
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.04] bg-primary"
        style={HALFTONE_STYLE}
      />
      <div className="flex flex-col gap-3 sm:gap-6">
        <LeadDetailsRow
          articleCount={props.articleCount}
          bias={bias}
          credibility={credibility}
          currentView={props.currentView}
          dateLabel={dateLabel}
          isBlindspotView={props.isBlindspotView}
          isGlobeView={props.isGlobeView}
          leadArticle={props.leadArticle}
          sourceCount={props.sourceCount}
          summary={summary}
        />
      </div>
    </div>
  );
};

export { HalftoneOverlay, LeadSection, type LeadSectionProps };
