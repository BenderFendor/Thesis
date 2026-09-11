"use client";

import { Clock } from "lucide-react";

interface ReadTimeBadgeProps {
  readonly estimatedMinutes?: number | null;
  readonly wordCount?: number | null;
  readonly compact?: boolean;
}

const NO_MEASUREMENT = 0,
 ReadTimeBadge = ({
  estimatedMinutes,
  wordCount,
  compact = false,
}: Readonly<ReadTimeBadgeProps>) => {
  if (!isPositiveMeasurement(estimatedMinutes) && !isPositiveMeasurement(wordCount)) {
    return false;
  }

  if (compact) {
    return (
      <div className="flex items-center gap-1 text-xs bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 px-2 py-1 rounded-full">
        <Clock className="h-3 w-3" />
        <span>{formatReadTime(estimatedMinutes)} min</span>
      </div>
    );
  }

  return <ReadTimeDetails estimatedMinutes={estimatedMinutes} wordCount={wordCount} />;
},
 ReadTimeDetails = ({ estimatedMinutes, wordCount }: Readonly<ReadTimeBadgeProps>) => (
  <div className="space-y-1">
    {isPositiveMeasurement(estimatedMinutes) && (
      <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
        <Clock className="h-4 w-4" />
        <span>{estimatedMinutes} minute read</span>
      </div>
    )}
    {isPositiveMeasurement(wordCount) && (
      <div className="text-xs text-gray-500 dark:text-gray-500">
        {wordCount.toLocaleString()} words
      </div>
    )}
  </div>
),
 UNKNOWN_READ_TIME = "?",
 formatReadTime = (value: number | null | undefined) => {
  if (isPositiveMeasurement(value)) {
    return value;
  }

  return UNKNOWN_READ_TIME;
},
 isPositiveMeasurement = (value: number | null | undefined): value is number => (
  value !== null && value !== undefined && value > NO_MEASUREMENT
);

export { ReadTimeBadge };
