"use client";

import type { CredibilityDimension, SourceCredibilityProfile } from "@/lib/api";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

import { Badge } from "@/components/ui/badge";
import { BarChart3 } from "lucide-react";
import type { DeepReadonly } from "@/lib/deep-readonly";
import { useCallback, useState } from "react";

const DEFAULT_DIMENSION_COUNT = 6,
  MODERATE_SCORE_THRESHOLD = 40,
  SCORE_PERCENT_MAX = 100,
  SCORE_PERCENT_MIN = 0,
  STRONG_SCORE_THRESHOLD = 70;
type BadgeSize = "lg" | "md" | "sm";
type ReadonlyCredibilityDimension = DeepReadonly<CredibilityDimension>;
type ReadonlySourceCredibilityProfile = DeepReadonly<SourceCredibilityProfile>;

const ICON_SIZE_CLASSES = {
    lg: "h-4 w-4",
    md: "h-3.5 w-3.5",
    sm: "h-3 w-3",
  } as const satisfies Record<BadgeSize, string>,
  SKELETON_IDS = [
    "ownership",
    "transparency",
    "corrections",
    "funding",
    "reporting",
    "history",
  ] as const,
  TEXT_SIZE_CLASSES = {
    lg: "text-xs",
    md: "text-[11px]",
    sm: "text-[10px]",
  } as const satisfies Record<BadgeSize, string>;

interface CredibilityBadgeProps {
  readonly className?: string;
  readonly domain: string;
  readonly size?: BadgeSize;
}

interface CredibilityPanelProps {
  readonly available: number;
  readonly dimensions: readonly (readonly [string, ReadonlyCredibilityDimension])[];
  readonly domain: string;
  readonly error?: string;
  readonly loading: boolean;
  readonly onClose: () => void;
  readonly profile?: ReadonlySourceCredibilityProfile;
  readonly total: number;
}

interface DimensionRowProps {
  readonly dimension: ReadonlyCredibilityDimension;
  readonly name: string;
}

const hasScore = (score: CredibilityDimension["score"]): score is number =>
    typeof score === "number";
const scoreToColor = (score: CredibilityDimension["score"]): string => {
    if (!hasScore(score)) {
      return "bg-muted";
    }
    if (score >= STRONG_SCORE_THRESHOLD) {
      return "bg-emerald-500";
    }
    if (score >= MODERATE_SCORE_THRESHOLD) {
      return "bg-amber-500";
    }
    return "bg-red-500";
  };
const scoreToLabel = (score: CredibilityDimension["score"]): string => {
    if (!hasScore(score)) {
      return "No data";
    }
    if (score >= STRONG_SCORE_THRESHOLD) {
      return "Strong";
    }
    if (score >= MODERATE_SCORE_THRESHOLD) {
      return "Moderate";
    }
    return "Weak";
  };
const scoreToWidth = (score: CredibilityDimension["score"]): string => {
    if (!hasScore(score)) {
      return "0%";
    }
    const bounded = Math.max(SCORE_PERCENT_MIN, Math.min(SCORE_PERCENT_MAX, score));
    return `${bounded}%`;
  };
const getProvenanceKey = (provenance: Readonly<CredibilityDimension["provenance"][number]>): string =>
    `${provenance.source}:${provenance.url}`;
const scoreStyle = (score: CredibilityDimension["score"]) =>
    ({ width: scoreToWidth(score) }) satisfies Readonly<{ width: string }>;

const DimensionProvenanceSource = ({
    provenance,
  }: Readonly<{ provenance: Readonly<CredibilityDimension["provenance"][number]> }>) => {
    if (provenance.url.length > SCORE_PERCENT_MIN) {
      return (
        <a
          href={provenance.url}
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-foreground"
        >
          {provenance.source}
        </a>
      );
    }
    return <span>{provenance.source}</span>;
  };

const DimensionProvenance = ({
    dimension,
  }: Readonly<{ dimension: ReadonlyCredibilityDimension }>) => (
    <div className="space-y-1">
      <span className="text-[9px] font-mono uppercase text-muted-foreground/50">Data Sources</span>
      {dimension.provenance.map((provenance) => (
        <div key={getProvenanceKey(provenance)} className="text-[10px] text-muted-foreground">
          <DimensionProvenanceSource provenance={provenance} />
        </div>
      ))}
    </div>
  );

const formatDimensionScore = (score: CredibilityDimension["score"]): number | string => {
  if (hasScore(score)) {
    return Math.round(score);
  }
  return "-";
};

const DimensionScore = ({ score }: Readonly<{ score: CredibilityDimension["score"] }>) => (
  <div className="flex items-center gap-2">
    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted/30">
      <div
        className={`h-full rounded-full transition-all duration-300 ${scoreToColor(score)}`}
        style={scoreStyle(score)}
      />
    </div>
    <span className="min-w-[3ch] text-[10px] font-mono text-muted-foreground">
      {formatDimensionScore(score)}
    </span>
  </div>
);

const DimensionRow = ({ dimension, name }: Readonly<DimensionRowProps>) => {
    const { score } = dimension;
    return (
      <details className="group rounded-lg border border-white/5 p-3">
        <summary className="flex cursor-pointer items-center justify-between gap-2">
          <span className="text-xs font-mono capitalize text-foreground/80">
            {name.replaceAll("_", " ")}
          </span>
          <span className="text-[10px] font-mono text-muted-foreground">{scoreToLabel(score)}</span>
        </summary>
        <div className="mt-3 space-y-2">
          <DimensionScore score={score} />
          <p className="text-[11px] text-muted-foreground/70">{dimension.explanation}</p>
          {dimension.provenance.length > SCORE_PERCENT_MIN && (
            <DimensionProvenance dimension={dimension} />
          )}
        </div>
      </details>
    );
  };
const CredibilitySkeleton = () => (
    <div className="space-y-3 py-4">
      {SKELETON_IDS.map((skeletonId) => (
        <div key={skeletonId} className="space-y-1">
          <div className="h-3 w-32 animate-pulse rounded bg-muted/30" />
          <div className="h-2 w-full animate-pulse rounded bg-muted/20" />
        </div>
      ))}
    </div>
  );
const CredibilitySummary = ({
    available,
    domain,
    profile,
    total,
  }: Readonly<{
    available: number;
    domain: string;
    profile?: ReadonlySourceCredibilityProfile;
    total: number;
  }>) => (
    <div className="mb-2 grid grid-cols-3 gap-2">
      <div className="rounded border border-white/5 bg-muted/10 p-2 text-center">
        <span className="block text-[10px] font-mono uppercase text-muted-foreground/60">
          Domain
        </span>
        <span className="block truncate text-xs font-medium text-foreground">
          {profile?.domain ?? domain}
        </span>
      </div>
      <div className="rounded border border-white/5 bg-muted/10 p-2 text-center">
        <span className="block text-[10px] font-mono uppercase text-muted-foreground/60">
          Available
        </span>
        <span className="text-xs font-medium text-foreground">
          {available}/{total}
        </span>
      </div>
      <div className="rounded border border-white/5 bg-muted/10 p-2 text-center">
        <span className="block text-[10px] font-mono uppercase text-muted-foreground/60">
          Status
        </span>
        <span className="text-xs font-medium text-foreground">{profile?.status ?? "Unknown"}</span>
      </div>
    </div>
  );
const CredibilityPanelBody = ({
    available,
    dimensions,
    domain,
    error,
    loading,
    profile,
    total,
  }: Readonly<Omit<CredibilityPanelProps, "onClose">>) => {
    if (loading) {
      return <CredibilitySkeleton />;
    }
    if (error !== undefined) {
      return <div className="py-4 text-center text-sm text-muted-foreground">{error}</div>;
    }
    if (dimensions.length === SCORE_PERCENT_MIN) {
      return (
        <div className="py-4 text-center text-sm text-muted-foreground">
          No credibility data available for this source.
        </div>
      );
    }
    return (
      <div className="space-y-4">
        <CredibilitySummary available={available} domain={domain} profile={profile} total={total} />
        {dimensions.map(([name, dimension]) => (
          <DimensionRow key={name} dimension={dimension} name={name} />
        ))}
      </div>
    );
  };

const CredibilityPanelHeader = ({ onClose }: Readonly<{ onClose: () => void }>) => (
  <div className="mb-4 flex items-center justify-between">
    <h3 id="credibility-panel-title" className="font-serif text-base font-semibold text-foreground">
      Source Credibility
    </h3>
    <button
      type="button"
      onClick={onClose}
      className="text-sm text-muted-foreground hover:text-foreground"
    >
      Close
    </button>
  </div>
);

const CredibilityPanel = ({
    available,
    dimensions,
    domain,
    error,
    loading,
    onClose,
    profile,
    total,
  }: Readonly<CredibilityPanelProps>) => (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <button
        type="button"
        aria-label="Close credibility panel"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <dialog
        open
        aria-modal="true"
        aria-labelledby="credibility-panel-title"
        className="relative z-10 max-h-[80vh] w-full max-w-md overflow-y-auto rounded-xl border border-white/10 bg-[var(--news-bg-secondary)] p-5 shadow-2xl"
      >
        <CredibilityPanelHeader onClose={onClose} />
        <CredibilityPanelBody
          available={available}
          dimensions={dimensions}
          domain={domain}
          error={error}
          loading={loading}
          profile={profile}
          total={total}
        />
      </dialog>
    </div>
  );
const loadCredibilityProfile = async (domain: string): Promise<SourceCredibilityProfile> => {
    const { fetchSourceCredibility } = await import("@/lib/api");
    return fetchSourceCredibility(domain);
  };

interface CredibilityPanelState {
  readonly closePanel: () => void;
  readonly error: string | undefined;
  readonly loading: boolean;
  readonly profile: SourceCredibilityProfile | undefined;
  readonly requestOpenPanel: () => void;
  readonly showPanel: boolean;
}

const useCredibilityPanel = (domain: string): CredibilityPanelState => {
  const [showPanel, setShowPanel] = useState(false),
    [profile, setProfile] = useState<SourceCredibilityProfile>();
  const [loading, setLoading] = useState(false),
    [error, setError] = useState<string>();
  const closePanel = useCallback(() => { setShowPanel(false); }, []);
  const fetchProfile = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const nextProfile = await loadCredibilityProfile(domain);
      setProfile(nextProfile);
    } catch {
      setError("Failed to load credibility data");
    } finally {
      setLoading(false);
      setShowPanel(true);
    }
  }, [domain]);
  const openPanel = useCallback(() => {
    if (showPanel) {
      closePanel();
    } else if (profile !== undefined && error === undefined) {
      setShowPanel(true);
    } else {
      void fetchProfile();
    }
  }, [closePanel, error, fetchProfile, profile, showPanel]);
  const requestOpenPanel = useCallback(() => { openPanel(); }, [openPanel]);
  return { closePanel, error, loading, profile, requestOpenPanel, showPanel };
};

interface CredibilityTooltipProps {
  readonly available: number;
  readonly className: string;
  readonly iconSize: string;
  readonly onClick: () => void;
  readonly textSize: string;
  readonly total: number;
}

const CredibilityBadgeTrigger = ({
  available,
  className,
  iconSize,
  onClick,
  textSize,
  total,
}: Readonly<CredibilityTooltipProps>) => (
  <TooltipTrigger asChild>
    <Badge
      variant="outline"
      className={`cursor-pointer border-white/10 bg-muted/20 hover:bg-muted/30 ${className}`}
      onClick={onClick}
    >
      <BarChart3 className={`${iconSize} mr-1 text-muted-foreground`} />
      <span className={`${textSize} text-muted-foreground`}>
        {available}/{total}
      </span>
    </Badge>
  </TooltipTrigger>
);

const CredibilityTooltipCopy = ({
  available,
  total,
}: Readonly<Pick<CredibilityTooltipProps, "available" | "total">>) => (
  <div className="space-y-1 text-xs">
    <div className="font-medium">Credibility Data</div>
    <div>
      {available} of {total} dimensions have data
    </div>
    <div className="text-muted-foreground">Click to expand</div>
  </div>
);

const CredibilityBadgeTooltip = (props: Readonly<CredibilityTooltipProps>) => (
  <Tooltip>
    <CredibilityBadgeTrigger
      available={props.available}
      className={props.className}
      iconSize={props.iconSize}
      onClick={props.onClick}
      textSize={props.textSize}
      total={props.total}
    />
    <TooltipContent side="bottom" className="max-w-xs">
      <CredibilityTooltipCopy available={props.available} total={props.total} />
    </TooltipContent>
  </Tooltip>
);

interface CredibilityBadgePanelProps {
  readonly available: number;
  readonly closePanel: () => void;
  readonly dimensions: readonly (readonly [string, ReadonlyCredibilityDimension])[];
  readonly domain: string;
  readonly error: string | undefined;
  readonly loading: boolean;
  readonly profile: ReadonlySourceCredibilityProfile | undefined;
  readonly showPanel: boolean;
  readonly total: number;
}

const CredibilityBadgePanel = ({
  available,
  closePanel,
  dimensions,
  domain,
  error,
  loading,
  profile,
  showPanel,
  total,
}: Readonly<CredibilityBadgePanelProps>) => {
  if (!showPanel) {
    return null;
  }
  return (
    <CredibilityPanel
      available={available}
      dimensions={dimensions}
      domain={domain}
      error={error}
      loading={loading}
      onClose={closePanel}
      profile={profile}
      total={total}
    />
  );
};

export const CredibilityBadge = ({
  className = "",
  domain,
  size = "md",
}: Readonly<CredibilityBadgeProps>) => {
  const { closePanel, error, loading, profile, requestOpenPanel, showPanel } = useCredibilityPanel(domain);
  const available = profile?.data_quality?.dimensions_available ?? SCORE_PERCENT_MIN,
    total = profile?.data_quality?.dimensions_total ?? DEFAULT_DIMENSION_COUNT;

  return (
    <>
      <TooltipProvider>
        <CredibilityBadgeTooltip
          available={available}
          className={className}
          iconSize={ICON_SIZE_CLASSES[size]}
          onClick={requestOpenPanel}
          textSize={TEXT_SIZE_CLASSES[size]}
          total={total}
        />
      </TooltipProvider>
      <CredibilityBadgePanel
        available={available}
        closePanel={closePanel}
        dimensions={Object.entries(profile?.dimensions ?? {})}
        domain={domain}
        error={error}
        loading={loading}
        profile={profile}
        showPanel={showPanel}
        total={total}
      />
    </>
  );
};
