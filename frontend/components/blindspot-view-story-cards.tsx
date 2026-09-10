import type { CSSProperties, ReactElement } from "react";
import { useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { SafeImage } from "@/components/safe-image";
import { cn } from "@/lib/utils";
import { formatArticleDateTime } from "@/lib/date-formatters";
import { isUsableImage } from "@/lib/article-image";
import type { DeepReadonly } from "@/lib/deep-readonly";
import type { BlindspotCard } from "@/lib/api/types";
import {
  articleSourceSummary,
  getLeadStoryMeta,
  paywallLabel,
} from "@/components/blindspot-view-helpers";
import type {
  BlindspotPoleLabels,
  CoverageBarProps,
  GeographySignalBadgesProps,
  LeadStoryMeta,
  LeadStoryProps,
  MobileBlindspotTileDetailsProps,
  MobileBlindspotTileMediaProps,
  MobileBlindspotTileProps,
  ReadonlyBlindspotCard,
  StoryRowProps,
} from "@/components/blindspot-view-types";

const COVERAGE_SEGMENTS: readonly {
  readonly color: string;
  readonly key: keyof BlindspotCard["coverage_shares"];
}[] = [
  { color: "bg-cyan-400/80", key: "pole_a" },
  { color: "bg-zinc-300/70", key: "shared" },
  { color: "bg-red-500/80", key: "pole_b" },
];

const getCoverageWidthStyle = (value: number): CSSProperties => ({
  width: `${Math.max(value * 100, 0)}%`,
});

const CoverageSegments = (props: CoverageBarProps): ReactElement => (
  <div className="flex h-1.5 w-full">
    {COVERAGE_SEGMENTS.map((segment) => (
      <div
        key={segment.key}
        className={segment.color}
        style={getCoverageWidthStyle(props.card.coverage_shares[segment.key])}
      />
    ))}
  </div>
);

const CoverageBar = (props: CoverageBarProps): ReactElement => (
  <div className="overflow-hidden rounded-full border border-white/5 bg-white/[0.04]">
    <CoverageSegments card={props.card} />
  </div>
);

const GeographySignalBadges = (props: GeographySignalBadgesProps): ReactElement | null => {
  const { card } = props;
  if (card.geography_signals.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {card.geography_signals.map((signal) => (
        <Badge
          key={signal.id}
          variant="outline"
          className="rounded-full border-white/10 bg-white/[0.04] px-2.5 py-1 text-[9px] uppercase tracking-[0.18em] text-muted-foreground"
        >
          {signal.label} · {signal.count}
        </Badge>
      ))}
    </div>
  );
};

const LeadStoryImage = (
  props: Readonly<{ card: ReadonlyBlindspotCard; imageUrl?: string | null }>,
): ReactElement => {
  if (isUsableImage(props.imageUrl)) {
    return (
      <SafeImage
        src={props.imageUrl}
        alt={props.card.cluster_label}
        fill
        className="h-full w-full object-cover opacity-75 grayscale transition duration-700 group-hover:scale-105 group-hover:opacity-100 group-hover:grayscale-0"
      />
    );
  }
  return (
    <div className="h-full w-full bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.08),transparent_70%)]" />
  );
};

const MediaGradient = (): ReactElement => (
  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
);

const getLeadStoryLabelClass = (meta: LeadStoryMeta): string => {
  if (meta.isLackingPoleA) {
    return "bg-red-500/80";
  }
  if (meta.isLackingPoleB) {
    return "bg-cyan-500/80";
  }
  return "bg-primary/80";
};

const LeadStoryLabel = (props: Readonly<{ meta: LeadStoryMeta }>): ReactElement => (
  <span
    className={cn(
      "truncate px-1.5 py-1 text-[8px] font-bold uppercase tracking-wide text-white shadow-lg lg:px-2.5 lg:font-mono lg:text-[10px] lg:tracking-widest",
      getLeadStoryLabelClass(props.meta),
    )}
  >
    {props.meta.blindspotLabel}: {props.meta.blindspotValue}%
  </span>
);

const LeadStoryPaywall = (props: Readonly<{ text: string }>): ReactElement => (
  <span className="hidden shrink-0 bg-black/70 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-white shadow-lg lg:inline">
    {props.text}
  </span>
);

const LeadStoryBadges = (props: Readonly<{ meta: LeadStoryMeta }>): ReactElement => (
  <div className="absolute left-2 top-2 flex max-w-[calc(100%-1rem)] items-center gap-2 lg:left-4 lg:top-4 lg:max-w-[calc(100%-2rem)]">
    <LeadStoryLabel meta={props.meta} />
    {props.meta.paywallText !== null && <LeadStoryPaywall text={props.meta.paywallText} />}
  </div>
);

const LeadStoryFooter = (props: Readonly<{ card: ReadonlyBlindspotCard }>): ReactElement => (
  <div className="absolute bottom-2 left-2 right-2 lg:bottom-4 lg:left-4 lg:right-4">
    <div className="flex flex-wrap items-center gap-1.5 text-[9px] font-medium text-white/70 lg:gap-3 lg:font-mono lg:text-[10px] lg:uppercase lg:tracking-[0.2em] lg:text-white/60">
      <span>{props.card.source_count} sources</span>
      <span className="h-1 w-1 rounded-full bg-white/40" />
      <span>{formatArticleDateTime(props.card.published_at) || "No timestamp"}</span>
    </div>
  </div>
);

const LeadStoryMedia = (
  props: Readonly<{ card: ReadonlyBlindspotCard; meta: LeadStoryMeta }>,
): ReactElement => (
  <div className="relative aspect-square w-full overflow-hidden bg-white/5 lg:aspect-video">
    <LeadStoryImage card={props.card} imageUrl={props.meta.imageUrl} />
    <MediaGradient />
    <LeadStoryBadges meta={props.meta} />
    <LeadStoryFooter card={props.card} />
  </div>
);

const CoverageLegendItem = (props: Readonly<{ color: string; label: string }>): ReactElement => (
  <div className="flex items-center gap-2">
    <div className={`h-2 w-2 rounded-full ${props.color}`} />
    <span className="truncate">{props.label}</span>
  </div>
);

const CoverageLegend = (
  props: Readonly<{ card: ReadonlyBlindspotCard; poleLabels: BlindspotPoleLabels }>,
): ReactElement => (
  <div className="hidden grid-cols-3 gap-2 text-[8px] font-mono uppercase tracking-[0.12em] text-muted-foreground/40 lg:flex lg:items-center lg:justify-between lg:text-[9px] lg:tracking-[0.2em]">
    <CoverageLegendItem
      color="bg-cyan-400"
      label={`${props.poleLabels.pole_a} ${Math.round(props.card.coverage_shares.pole_a * 100)}%`}
    />
    <CoverageLegendItem
      color="bg-zinc-400"
      label={`Balanced ${Math.round(props.card.coverage_shares.shared * 100)}%`}
    />
    <CoverageLegendItem
      color="bg-red-500"
      label={`${props.poleLabels.pole_b} ${Math.round(props.card.coverage_shares.pole_b * 100)}%`}
    />
  </div>
);

const LeadStoryText = (props: Readonly<{ card: ReadonlyBlindspotCard }>): ReactElement => (
  <div className="space-y-1.5 lg:space-y-3">
    <h3 className="line-clamp-3 font-serif text-base leading-tight text-foreground/90 transition-colors group-hover:text-white lg:text-3xl lg:leading-[1.15]">
      {props.card.cluster_label}
    </h3>
    <p className="hidden text-sm italic leading-relaxed text-muted-foreground/60 lg:line-clamp-2">
      {props.card.explanation}
    </p>
  </div>
);

const LeadStorySummary = (props: Readonly<{ text: string }>): ReactElement => (
  <p className="line-clamp-2 text-[10px] font-medium leading-snug text-muted-foreground/55 lg:font-mono lg:uppercase lg:tracking-[0.16em] lg:text-muted-foreground/45">
    Comparing {props.text}
  </p>
);

const LeadStoryPaywallNote = (
  props: Readonly<{ card: ReadonlyBlindspotCard; text: string }>,
): ReactElement => (
  <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-amber-200/70">
    {props.text}; free alternatives from{" "}
    {props.card.paywall_concentration.best_free_sources.slice(0, 2).join(" · ") || "none detected"}
  </p>
);

const LeadStoryMetrics = (
  props: Readonly<{
    card: ReadonlyBlindspotCard;
    poleLabels: BlindspotPoleLabels;
    paywallText: string | null;
    sourceSummary: string | null;
  }>,
): ReactElement => (
  <div className="space-y-2 lg:space-y-4">
    <div className="hidden lg:block">
      <GeographySignalBadges card={props.card} />
    </div>
    {props.sourceSummary !== null && (
      <LeadStorySummary
        text={`${props.card.articles.length} sampled articles from ${props.sourceSummary}`}
      />
    )}
    {props.paywallText !== null && (
      <LeadStoryPaywallNote card={props.card} text={props.paywallText} />
    )}
    <CoverageLegend card={props.card} poleLabels={props.poleLabels} />
    <CoverageBar card={props.card} />
  </div>
);

const LeadStoryDetails = (
  props: Readonly<{
    card: ReadonlyBlindspotCard;
    poleLabels: BlindspotPoleLabels;
    paywallText: string | null;
    sourceSummary: string | null;
  }>,
): ReactElement => (
  <div className="flex flex-1 flex-col justify-between space-y-3 p-2.5 lg:space-y-6 lg:p-6">
    <LeadStoryText card={props.card} />
    <LeadStoryMetrics
      card={props.card}
      poleLabels={props.poleLabels}
      paywallText={props.paywallText}
      sourceSummary={props.sourceSummary}
    />
  </div>
);

const LeadStory = (props: Readonly<LeadStoryProps>): ReactElement => {
  const { card, laneId, onOpen, poleLabels } = props;
  const meta = getLeadStoryMeta(card, laneId, poleLabels);
  const handleOpen = useCallback(() => {
    onOpen(card);
  }, [card, onOpen]);
  return (
    <button
      type="button"
      onClick={handleOpen}
      className="group relative flex w-full flex-col overflow-hidden rounded-xl border border-white/10 bg-white/[0.025] text-left transition-all duration-500 ease-out hover:bg-white/[0.05] lg:rounded-2xl lg:border-0 lg:bg-black/20 lg:shadow-2xl lg:hover:bg-white/[0.03]"
    >
      <LeadStoryMedia card={card} meta={meta} />
      <LeadStoryDetails
        card={card}
        poleLabels={poleLabels}
        paywallText={meta.paywallText}
        sourceSummary={meta.sourceSummary}
      />
    </button>
  );
};

const StoryRowMeta = (
  props: Readonly<{ card: ReadonlyBlindspotCard; paywallText: string | null }>,
): ReactElement => (
  <div className="flex items-center gap-1.5 text-[9px] font-medium text-muted-foreground/50 lg:gap-2 lg:font-mono lg:uppercase lg:tracking-[0.15em] lg:text-muted-foreground/40">
    <span>{props.card.source_count} sources</span>
    <span className="h-0.5 w-0.5 rounded-full bg-white/10" />
    <span className="hidden lg:inline">
      {formatArticleDateTime(props.card.published_at) || "No timestamp"}
    </span>
    {props.paywallText !== null && <span className="text-amber-200/60">· {props.paywallText}</span>}
  </div>
);

const StoryRowScore = (props: Readonly<{ score: number }>): ReactElement => (
  <div className="mt-1 hidden shrink-0 flex-col items-end gap-1 lg:flex">
    <span className="font-mono text-[10px] tracking-wider text-primary/60">GAP SCORE</span>
    <span className="font-mono text-lg font-bold text-foreground/70">
      {Math.round(props.score * 10) / 10}
    </span>
  </div>
);

const StoryRowHeader = (
  props: Readonly<{ card: ReadonlyBlindspotCard; paywallText: string | null }>,
): ReactElement => (
  <div className="flex items-start justify-between gap-2 lg:gap-4">
    <div className="min-w-0 flex-1">
      <StoryRowMeta card={props.card} paywallText={props.paywallText} />
      <h4 className="mt-1 line-clamp-3 font-serif text-sm leading-tight text-foreground/85 transition-colors group-hover:text-white lg:mt-1.5 lg:line-clamp-2 lg:text-lg lg:leading-snug lg:text-foreground/80">
        {props.card.cluster_label}
      </h4>
    </div>
    <StoryRowScore score={props.card.blindspot_score} />
  </div>
);

const StoryRowSummary = (
  props: Readonly<{ card: ReadonlyBlindspotCard; sourceSummary: string | null }>,
): ReactElement | null => {
  if (props.sourceSummary === null) {
    return null;
  }
  return (
    <p className="line-clamp-2 text-[10px] leading-snug text-muted-foreground/45 lg:text-[9px] lg:font-mono lg:uppercase lg:tracking-[0.14em] lg:text-muted-foreground/35">
      {props.card.articles.length} sampled articles · {props.sourceSummary}
    </p>
  );
};

const StoryRowBody = (
  props: Readonly<{
    card: ReadonlyBlindspotCard;
    poleLabels: BlindspotPoleLabels;
    sourceSummary: string | null;
  }>,
): ReactElement => (
  <div className="space-y-2">
    <StoryRowSummary card={props.card} sourceSummary={props.sourceSummary} />
    <div className="hidden lg:block">
      <GeographySignalBadges card={props.card} />
    </div>
    <CoverageLegend card={props.card} poleLabels={props.poleLabels} />
    <CoverageBar card={props.card} />
  </div>
);

const StoryRow = (props: Readonly<StoryRowProps>): ReactElement => {
  const { card, onOpen, poleLabels } = props;
  const paywallText = paywallLabel(card);
  const sourceSummary = articleSourceSummary(card);
  const handleOpen = useCallback(() => {
    onOpen(card);
  }, [card, onOpen]);
  return (
    <button
      type="button"
      onClick={handleOpen}
      className="group flex w-full flex-col gap-2 rounded-lg border border-white/10 bg-white/[0.025] p-2.5 text-left transition-all duration-300 hover:bg-white/[0.05] lg:gap-3 lg:rounded-xl lg:border-0 lg:bg-white/[0.02] lg:p-4"
    >
      <StoryRowHeader card={card} paywallText={paywallText} />
      <StoryRowBody card={card} poleLabels={poleLabels} sourceSummary={sourceSummary} />
    </button>
  );
};

const MobileTileImage = (
  props: DeepReadonly<{ card: MobileBlindspotTileMediaProps["card"] }>,
): ReactElement => {
  const imageUrl = props.card.representative_article?.image_url;
  if (isUsableImage(imageUrl)) {
    return (
      <SafeImage
        src={imageUrl}
        alt={props.card.cluster_label}
        fill
        className="h-full w-full object-cover opacity-75 grayscale transition duration-500 group-hover:opacity-95"
      />
    );
  }
  return (
    <div className="h-full w-full bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.1),transparent_72%)]" />
  );
};

const MobileTilePaywall = (props: Readonly<{ text: string }>): ReactElement => (
  <div className="absolute right-2 top-7 max-w-[calc(100%-1rem)] truncate bg-black/70 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide text-white">
    {props.text}
  </div>
);

const MobileTileFooter = (
  props: DeepReadonly<{ card: MobileBlindspotTileMediaProps["card"] }>,
): ReactElement => (
  <div className="absolute bottom-2 left-2 right-2 flex items-center gap-1.5 text-[9px] font-medium text-white/75">
    <span>{props.card.source_count} sources</span>
    <span className="h-1 w-1 rounded-full bg-white/40" />
    <span>{formatArticleDateTime(props.card.published_at) || "No timestamp"}</span>
  </div>
);

const MobileTileMedia = (props: DeepReadonly<MobileBlindspotTileMediaProps>): ReactElement => (
  <div className="relative aspect-square overflow-hidden bg-white/[0.04]">
    <MobileTileImage card={props.card} />
    <MediaGradient />
    <div className="absolute left-2 top-2 max-w-[calc(100%-1rem)] truncate bg-primary px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide text-black">
      {props.blindspotLabel}: {props.blindspotValue}%
    </div>
    {props.paywallText !== null && <MobileTilePaywall text={props.paywallText} />}
    <MobileTileFooter card={props.card} />
  </div>
);

const MobileCoverageLegend = (
  props: DeepReadonly<MobileBlindspotTileDetailsProps>,
): ReactElement => (
  <div className="flex items-center justify-between text-[8px] font-medium uppercase tracking-wide text-muted-foreground/45">
    <span>
      {props.poleLabels.pole_a.charAt(0)} {Math.round(props.card.coverage_shares.pole_a * 100)}%
    </span>
    <span>B {Math.round(props.card.coverage_shares.shared * 100)}%</span>
    <span>
      {props.poleLabels.pole_b.charAt(0)} {Math.round(props.card.coverage_shares.pole_b * 100)}%
    </span>
  </div>
);

const MobileTileDetails = (props: DeepReadonly<MobileBlindspotTileDetailsProps>): ReactElement => (
  <div className="space-y-2 p-2.5">
    <h4 className="line-clamp-3 font-serif text-sm leading-tight text-foreground/90">
      {props.card.cluster_label}
    </h4>
    <MobileCoverageLegend card={props.card} poleLabels={props.poleLabels} />
    <CoverageBar card={props.card} />
  </div>
);

const MobileBlindspotTile = (props: MobileBlindspotTileProps): ReactElement => {
  const { card, laneId, onOpen, poleLabels } = props;
  const meta = getLeadStoryMeta(card, laneId, poleLabels);
  const handleOpen = useCallback(() => {
    onOpen(card);
  }, [card, onOpen]);
  return (
    <button
      type="button"
      onClick={handleOpen}
      className="group overflow-hidden rounded-lg border border-white/10 bg-white/[0.025] text-left transition duration-300 active:scale-[0.98]"
    >
      <MobileTileMedia
        blindspotLabel={meta.blindspotLabel}
        blindspotValue={meta.blindspotValue}
        card={card}
        paywallText={meta.paywallText}
      />
      <MobileTileDetails card={card} poleLabels={poleLabels} />
    </button>
  );
};

export { CoverageBar, GeographySignalBadges, LeadStory, MobileBlindspotTile, StoryRow };
