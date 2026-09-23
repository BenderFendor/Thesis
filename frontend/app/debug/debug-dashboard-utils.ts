import type { SourceStats, StartupEventMetric } from "@/lib/api";
import { formatArticleDateTime } from "@/lib/date-formatters";
import type { DeepReadonly } from "@/lib/deep-readonly";
import { z } from "zod";

const debugArticleRowKey = (articleId: number | string, fallback: string): string =>
  `${articleId}-${fallback}`;

const debugEventClassName = (eventType: string | undefined): string => {
  if (eventType === "error") {
    return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
  }
  if (eventType === "stream_event") {
    return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400";
  }
  if (eventType === "request_start") {
    return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400";
  }
  return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
};

const formatDatabaseSnapshotDate = (value?: string | null): string => {
  if (value === undefined || value === null || value === "") {
    return "?";
  }
  return formatArticleDateTime(value);
};

const formatDuration = (value?: number | null, fallback = "—"): string => {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (value > 1000) {
    return `${Math.round(value).toLocaleString()}s`;
  }
  return `${value.toFixed(2)}s`;
};

const formatMilliseconds = (value?: number | null): string => {
  if (value === undefined || value === null) {
    return "—";
  }
  return `${Math.round(value)}ms`;
};

const formatMetadataValue = (
  value: DeepReadonly<NonNullable<StartupEventMetric["metadata"]>[string]> | undefined,
): string | undefined => {
  const primitive = z.union([z.boolean(), z.number(), z.string()]).safeParse(value);
  if (primitive.success) {
    return String(primitive.data);
  }
  try {
    return JSON.stringify(value) ?? undefined;
  } catch {
    return Object.prototype.toString.call(value);
  }
};

const formatTimestamp = (value?: string | null): string => {
  if (value === undefined || value === null || value === "") {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return formatArticleDateTime(value);
};

const healthLabel = (
  healthy: boolean | undefined,
  healthyLabel: string,
  unhealthyLabel: string,
) => {
  if (healthy === true) {
    return healthyLabel;
  }
  return unhealthyLabel;
};

type DebugInputChangeEvent = Readonly<{
  target: Readonly<Pick<HTMLInputElement, "checked" | "value">>;
}>;

const checkedValueChange = (setter: (value: boolean) => void) => (event: DebugInputChangeEvent) => {
  setter(event.target.checked);
};

const inputValueChange = (setter: (value: string) => void) => (event: DebugInputChangeEvent) => {
  setter(event.target.value);
};

const numberValueChange = (setter: (value: number) => void) => (event: DebugInputChangeEvent) => {
  setter(Number(event.target.value));
};

const selectedNumberValueChange = (setter: (value: number) => void) => (value: string) => {
  setter(Number(value));
};

const sourceStatsRowKey = (source: SourceStats): string =>
  `${source.name}-${source.category}-${source.country}-${source.url}`;

const sourceStatusTone = (status: SourceStats["status"]): string => {
  switch (status) {
    case "success": {
      return "text-emerald-600 dark:text-emerald-400";
    }
    case "warning": {
      return "text-amber-600 dark:text-amber-400";
    }
    case "error": {
      return "text-red-600 dark:text-red-400";
    }
    default: {
      return "text-red-600 dark:text-red-400";
    }
  }
};

const textOr = (value: string | null | undefined, fallback: string): string => {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  return value;
};

export {
  checkedValueChange,
  debugArticleRowKey,
  debugEventClassName,
  formatDatabaseSnapshotDate,
  formatDuration,
  formatMetadataValue,
  formatMilliseconds,
  formatTimestamp,
  healthLabel,
  inputValueChange,
  numberValueChange,
  selectedNumberValueChange,
  sourceStatsRowKey,
  sourceStatusTone,
  textOr,
};
