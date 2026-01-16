"use client";

import { Shield, ShieldCheck, ShieldAlert, ShieldQuestion } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ConfidenceLevel,
  formatConfidence,
  getConfidenceBgColor,
  getConfidenceColor,
  getConfidenceLabel,
} from "@/lib/verification";

interface ConfidenceBadgeProps {
  confidence: number;
  level: ConfidenceLevel;
  claimCount?: number;
  sourceCount?: number;
  className?: string;
  showLabel?: boolean;
  size?: "sm" | "md" | "lg";
}

export function ConfidenceBadge({
  confidence,
  level,
  claimCount,
  sourceCount,
  className = "",
  showLabel = true,
  size = "md",
}: ConfidenceBadgeProps) {
  const colorClass = getConfidenceColor(level);
  const bgClass = getConfidenceBgColor(level);
  const label = getConfidenceLabel(level);
  const percentage = formatConfidence(confidence);

  const iconSizes = {
    sm: "w-3 h-3",
    md: "w-4 h-4",
    lg: "w-5 h-5",
  };

  const textSizes = {
    sm: "text-[10px]",
    md: "text-xs",
    lg: "text-sm",
  };

  const Icon = getConfidenceIcon(level);
  const iconSize = iconSizes[size];
  const textSize = textSizes[size];

  const tooltipContent = (
    <div className="text-xs space-y-1">
      <div className="font-medium">
        Verification Confidence: {percentage}
      </div>
      {claimCount !== undefined && (
        <div className="text-muted-foreground">
          {claimCount} claim{claimCount !== 1 ? "s" : ""} verified
        </div>
      )}
      {sourceCount !== undefined && (
        <div className="text-muted-foreground">
          {sourceCount} source{sourceCount !== 1 ? "s" : ""} checked
        </div>
      )}
    </div>
  );

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className={`${bgClass} ${colorClass} ${className} cursor-help`}
          >
            <Icon className={`${iconSize} mr-1`} />
            <span className={textSize}>
              {showLabel ? `${label} (${percentage})` : percentage}
            </span>
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          {tooltipContent}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function getConfidenceIcon(level: ConfidenceLevel) {
  switch (level) {
    case "high":
      return ShieldCheck;
    case "medium":
      return Shield;
    case "low":
      return ShieldAlert;
    case "very_low":
      return ShieldQuestion;
    default:
      return Shield;
  }
}

interface ConfidenceBarProps {
  confidence: number;
  level: ConfidenceLevel;
  className?: string;
  showPercentage?: boolean;
}

export function ConfidenceBar({
  confidence,
  level,
  className = "",
  showPercentage = true,
}: ConfidenceBarProps) {
  const colorClass = getConfidenceColor(level);
  const percentage = Math.round(confidence * 100);

  const barColor = {
    high: "bg-green-500",
    medium: "bg-yellow-500",
    low: "bg-orange-500",
    very_low: "bg-red-500",
  }[level] || "bg-gray-500";

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full ${barColor} transition-all duration-300`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      {showPercentage && (
        <span className={`text-xs font-medium ${colorClass} min-w-[3ch]`}>
          {percentage}%
        </span>
      )}
    </div>
  );
}
