"use client";

import { Clock } from "lucide-react";

interface ReadTimeBadgeProps {
  estimatedMinutes?: number | null;
  wordCount?: number | null;
  compact?: boolean;
}

export function ReadTimeBadge({
  estimatedMinutes,
  wordCount,
  compact = false,
}: ReadTimeBadgeProps) {
  if (!estimatedMinutes && !wordCount) {
    return null;
  }

  if (compact) {
    return (
      <div className="flex items-center gap-1 text-xs bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 px-2 py-1 rounded-full">
        <Clock className="h-3 w-3" />
        <span>{estimatedMinutes || "?"} min</span>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {estimatedMinutes && (
        <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
          <Clock className="h-4 w-4" />
          <span>{estimatedMinutes} minute read</span>
        </div>
      )}
      {wordCount && (
        <div className="text-xs text-gray-500 dark:text-gray-500">
          {wordCount.toLocaleString()} words
        </div>
      )}
    </div>
  );
}
