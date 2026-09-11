"use client";

import { Shield, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  formatConfidence,
  getConfidenceBgColor,
  getConfidenceColor,
  getConfidenceLabel,
} from "@/lib/verification";
import { Badge } from "@/components/ui/badge";
import type { ConfidenceLevel } from "@/lib/verification";
import { useMemo } from "react";
import type { ReactNode } from "react";

interface ConfidenceBadgeProps {
  readonly confidence: number;
  readonly level: ConfidenceLevel;
  readonly claimCount?: number;
  readonly sourceCount?: number;
  readonly className?: string;
  readonly showLabel?: boolean;
  readonly size?: "sm" | "md" | "lg";
}

type ConfidenceIcon = (props: Readonly<{ className?: string }>) => ReactNode;

const confidenceIcons = {
  high: ShieldCheck,
  low: ShieldAlert,
  medium: Shield,
  very_low: ShieldQuestion,
} satisfies Record<ConfidenceLevel, ConfidenceIcon>;

const ICON_SIZES = {
  lg: "w-5 h-5",
  md: "w-4 h-4",
  sm: "w-3 h-3",
} as const;

const TEXT_SIZES = {
  lg: "text-sm",
  md: "text-xs",
  sm: "text-[10px]",
} as const;

const getCountLabel = (count: number, singular: string): string => {
  let suffix = "";
  if (count !== 1) {
    suffix = "s";
  }
  return `${count} ${singular}${suffix}`;
};

interface ConfidenceTooltipContentProps {
  readonly claimCount?: number;
  readonly percentage: string;
  readonly sourceCount?: number;
}

const ConfidenceTooltipContent = ({
  claimCount,
  percentage,
  sourceCount,
}: Readonly<ConfidenceTooltipContentProps>) => (
  <div className="text-xs space-y-1">
    <div className="font-medium">Verification Confidence: {percentage}</div>
    {claimCount !== undefined && (
      <div className="text-muted-foreground">{getCountLabel(claimCount, "claim")} verified</div>
    )}
    {sourceCount !== undefined && (
      <div className="text-muted-foreground">{getCountLabel(sourceCount, "source")} checked</div>
    )}
  </div>
);

interface ConfidenceBadgeTriggerProps {
  readonly bgClass: string;
  readonly className: string;
  readonly colorClass: string;
  readonly Icon: ConfidenceIcon;
  readonly iconSize: string;
  readonly label: string;
  readonly textSize: string;
}

const ConfidenceBadgeTrigger = ({
  bgClass,
  className,
  colorClass,
  Icon,
  iconSize,
  label,
  textSize,
}: Readonly<ConfidenceBadgeTriggerProps>) => (
  <Badge variant="outline" className={`${bgClass} ${colorClass} ${className} cursor-help`}>
    <Icon className={`${iconSize} mr-1`} />
    <span className={textSize}>{label}</span>
  </Badge>
);

interface ConfidenceBadgeDetailsOptions {
  readonly confidence: number;
  readonly level: ConfidenceLevel;
  readonly size: NonNullable<ConfidenceBadgeProps["size"]>;
}

const getConfidenceBadgeDetails = ({
  confidence,
  level,
  size,
}: Readonly<ConfidenceBadgeDetailsOptions>) => ({
  Icon: confidenceIcons[level],
  bgClass: getConfidenceBgColor(level),
  colorClass: getConfidenceColor(level),
  iconSize: ICON_SIZES[size],
  label: getConfidenceLabel(level),
  percentage: formatConfidence(confidence),
  textSize: TEXT_SIZES[size],
});

const getBadgeLabel = (label: string, percentage: string, showLabel: boolean): string => {
  if (showLabel) {
    return `${label} (${percentage})`;
  }
  return percentage;
};

type ConfidenceBadgeTooltipProps = Readonly<
  ConfidenceBadgeTriggerProps & ConfidenceTooltipContentProps
>;

const ConfidenceBadgeTooltip = ({
  bgClass,
  claimCount,
  className,
  colorClass,
  Icon,
  iconSize,
  label,
  percentage,
  sourceCount,
  textSize,
}: ConfidenceBadgeTooltipProps) => {
  const trigger = (
    <ConfidenceBadgeTrigger
      bgClass={bgClass}
      className={className}
      colorClass={colorClass}
      Icon={Icon}
      iconSize={iconSize}
      label={label}
      textSize={textSize}
    />
  );
  const content = (
    <ConfidenceTooltipContent
      claimCount={claimCount}
      percentage={percentage}
      sourceCount={sourceCount}
    />
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>{trigger}</TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs">
        {content}
      </TooltipContent>
    </Tooltip>
  );
};

const ConfidenceBadge = ({
  confidence,
  level,
  claimCount,
  sourceCount,
  className = "",
  showLabel = true,
  size = "md",
}: ConfidenceBadgeProps) => {
  const details = getConfidenceBadgeDetails({ confidence, level, size });
  const badgeLabel = getBadgeLabel(details.label, details.percentage, showLabel);

  return (
    <TooltipProvider>
      <ConfidenceBadgeTooltip
        bgClass={details.bgClass}
        claimCount={claimCount}
        className={className}
        colorClass={details.colorClass}
        Icon={details.Icon}
        iconSize={details.iconSize}
        label={badgeLabel}
        percentage={details.percentage}
        sourceCount={sourceCount}
        textSize={details.textSize}
      />
    </TooltipProvider>
  );
};

interface ConfidenceBarProps {
  readonly confidence: number;
  readonly level: ConfidenceLevel;
  readonly className?: string;
  readonly showPercentage?: boolean;
}

const ConfidenceBar = ({
  confidence,
  level,
  className = "",
  showPercentage = true,
}: ConfidenceBarProps) => {
  const barColor =
      {
        high: "bg-green-500",
        low: "bg-orange-500",
        medium: "bg-yellow-500",
        very_low: "bg-red-500",
      }[level] || "bg-gray-500",
    colorClass = getConfidenceColor(level),
    percentage = Math.round(confidence * 100),
    progressStyle = useMemo(() => ({ width: `${percentage}%` }), [percentage]);

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${barColor} transition-all duration-300`} style={progressStyle} />
      </div>
      {showPercentage && (
        <span className={`text-xs font-medium ${colorClass} min-w-[3ch]`}>{percentage}%</span>
      )}
    </div>
  );
};
export { ConfidenceBadge, ConfidenceBar };
