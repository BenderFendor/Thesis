import type { LlmLogEntry, SourceStats } from "@/lib/api";
import { hasText } from "@/lib/utils";
import type { NormalizedErrorEvent } from "./source-intelligence-operations-types";
import { formatAverageLatency, SURFACE_CLASS } from "./source-intelligence-operations-helpers";
import { DataRow, PanelTitle, StatCard } from "./source-intelligence-operations-common";

const ActivityTab = ({
  entries,
  successCount,
  failureCount,
}: Readonly<{
  entries: readonly LlmLogEntry[];
  successCount: number;
  failureCount: number;
}>) => (
  <div className="grid gap-4 md:grid-cols-[0.7fr_1.3fr]">
    <ActivitySummary
      callCount={entries.length}
      successCount={successCount}
      failureCount={failureCount}
      entries={entries}
    />
    <LlmEntries entries={entries} />
  </div>
);

const ActivitySummary = ({
  callCount,
  successCount,
  failureCount,
  entries,
}: Readonly<{
  callCount: number;
  successCount: number;
  failureCount: number;
  entries: readonly LlmLogEntry[];
}>) => (
  <div className={SURFACE_CLASS}>
    <PanelTitle>Model Activity</PanelTitle>
    <div className="grid grid-cols-2 gap-3">
      <StatCard label="Calls" value={callCount} />
      <StatCard label="Success" value={successCount} />
      <StatCard label="Failed" value={failureCount} />
      <StatCard
        label="Avg latency"
        value={formatAverageLatency(entries.map((entry) => entry.duration_ms))}
      />
    </div>
  </div>
);

const LlmEntries = ({ entries }: Readonly<{ entries: readonly LlmLogEntry[] }>) => (
  <div className="space-y-3">
    {entries.map((entry) => (
      <LlmEntryCard
        key={
          entry.request_id ??
          `${entry.timestamp ?? "llm"}-${entry.service ?? "unknown"}-${entry.model ?? "unknown"}-${entry.duration_ms ?? "none"}`
        }
        entry={entry}
      />
    ))}
  </div>
);

const LlmEntryCard = ({ entry }: Readonly<{ entry: LlmLogEntry }>) => (
  <div className={SURFACE_CLASS}>
    <LlmEntryHeader entry={entry} />
    <LlmEntryMetadata entry={entry} />
    {hasText(entry.error_message) && (
      <div className="mt-2 text-sm text-red-300">{entry.error_message}</div>
    )}
  </div>
);

const LlmEntryHeader = ({ entry }: Readonly<{ entry: LlmLogEntry }>) => (
  <div className="flex items-center justify-between gap-3">
    <LlmEntryIdentity entry={entry} />
    <LlmEntryStatus success={entry.success === true} />
  </div>
);

const LlmEntryIdentity = ({ entry }: Readonly<{ entry: LlmLogEntry }>) => (
  <div>
    <div className="text-foreground">
      {entry.service ?? "unknown"} · {entry.model ?? "unknown"}
    </div>
    <div className="text-xs text-muted-foreground">{entry.timestamp ?? "—"}</div>
  </div>
);

const LlmEntryStatus = ({ success }: Readonly<{ success: boolean }>) => {
  if (success) {
    return <div className="text-emerald-300">success</div>;
  }
  return <div className="text-red-300">failed</div>;
};

const LlmEntryMetadata = ({ entry }: Readonly<{ entry: LlmLogEntry }>) => (
  <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
    <span>{latencyLabel(entry.duration_ms)}</span>
    <span>{entry.finish_reason ?? "No finish reason"}</span>
  </div>
);

const latencyLabel = (value: number | undefined): string => {
  if (value !== undefined && value !== null && value !== 0) {
    return `${value}ms`;
  }
  return "No latency recorded";
};

const ErrorsTab = ({
  problematicSources,
  recentErrorEvents,
}: Readonly<{
  problematicSources: readonly SourceStats[];
  recentErrorEvents: readonly NormalizedErrorEvent[];
}>) => (
  <div className="grid gap-4 md:grid-cols-[0.7fr_1.3fr]">
    <IssueSummaryCard
      issueCount={problematicSources.length}
      errorCount={recentErrorEvents.length}
      problematicSources={problematicSources}
    />
    <ErrorEventList entries={recentErrorEvents} />
  </div>
);

const IssueSummaryCard = ({
  issueCount,
  errorCount,
  problematicSources,
}: Readonly<{
  issueCount: number;
  errorCount: number;
  problematicSources: readonly SourceStats[];
}>) => (
  <div className={SURFACE_CLASS}>
    <PanelTitle>Current Issues</PanelTitle>
    <div className="grid grid-cols-2 gap-3">
      <StatCard label="Open issues" value={issueCount} />
      <StatCard label="Recent errors" value={errorCount} />
    </div>
    <IssueRows sources={problematicSources} />
  </div>
);

const IssueRows = ({ sources }: Readonly<{ sources: readonly SourceStats[] }>) => (
  <div className="mt-4 space-y-2">
    {sources.length === 0 && <NoIssues />}
    {sources.length > 0 &&
      sources.map((source) => (
        <DataRow
          key={source.name}
          label={source.name}
          value={source.error_message ?? source.status}
        />
      ))}
  </div>
);

const NoIssues = () => (
  <div className="text-sm text-muted-foreground">No non-healthy sources in the latest sample.</div>
);

const ErrorEventList = ({ entries }: Readonly<{ entries: readonly NormalizedErrorEvent[] }>) => (
  <div className="space-y-3">
    {entries.map((entry) => (
      <ErrorEventCard key={entry.key} entry={entry} />
    ))}
  </div>
);

const ErrorEventCard = ({ entry }: Readonly<{ entry: NormalizedErrorEvent }>) => (
  <div className={SURFACE_CLASS}>
    <ErrorEventHeader entry={entry} />
    <div className="mt-2 text-sm text-muted-foreground">{entry.message}</div>
  </div>
);

const ErrorEventHeader = ({ entry }: Readonly<{ entry: NormalizedErrorEvent }>) => (
  <div className="flex items-center justify-between gap-3">
    <div className="text-foreground">{entry.service}</div>
    <div className="text-red-300">{entry.errorType}</div>
  </div>
);

const PerformanceTab = ({
  averageArticles,
  recentErrorEvents,
  latencyValues,
}: Readonly<{
  averageArticles: number;
  recentErrorEvents: readonly NormalizedErrorEvent[];
  latencyValues: readonly (number | undefined)[];
}>) => (
  <div className="grid gap-4 md:grid-cols-3">
    <PerformanceMetricCard
      label="Feed Throughput"
      value={averageArticles || "—"}
      detail="Avg articles per source"
    />
    <PerformanceMetricCard
      label="Model Latency"
      value={formatAverageLatency(latencyValues)}
      detail="Average call time"
    />
    <PerformanceMetricCard
      label="Stability"
      value={recentErrorEvents.length}
      detail="Recent error count"
    />
  </div>
);

const PerformanceMetricCard = ({
  label,
  value,
  detail,
}: Readonly<{ label: string; value: string | number; detail: string }>) => (
  <div className={SURFACE_CLASS}>
    <PanelTitle>{label}</PanelTitle>
    <StatCard label={detail} value={value} />
  </div>
);

export { ActivityTab, ErrorsTab, PerformanceTab };
