import { API_BASE_URL } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TabsContent } from "@/components/ui/tabs";
import { useEffect, useState } from "react";
import type { DeepReadonly } from "@/lib/deep-readonly";
import {
  debugEventClassName,
  formatMilliseconds,
  formatTimestamp,
  textOr,
} from "./debug-dashboard-utils";
import { BackendEventsCard } from "./debug-dashboard-cards";
import type {
  BackendDebugReport,
  DebugActiveStreamRecord,
  DebugLogFileRecord,
  DebugPerformanceSnapshot,
  DebugSlowOperationRecord,
  PerformanceSectionProps,
} from "./debug-dashboard-types";

const ZERO = 0;
const EMPTY_ACTIVE_STREAMS: readonly DebugActiveStreamRecord[] = [];
const EMPTY_RECOMMENDATIONS: readonly string[] = [];

type FrontendPerformanceSummaryProps = DeepReadonly<{
  summary: DebugPerformanceSnapshot["summary"];
  activeStreamCount: number;
}>;

const FrontendPerformanceSummary = (props: FrontendPerformanceSummaryProps) => (
  <div className="grid gap-4 md:grid-cols-4">
    <div className="text-center rounded-lg bg-muted p-3">
      <p className="text-xl font-bold">{props.summary.totalEvents}</p>
      <p className="text-xs text-muted-foreground">Total Events</p>
    </div>
    <div className="text-center rounded-lg bg-muted p-3">
      <p className="text-xl font-bold text-red-600">{props.summary.errorCount}</p>
      <p className="text-xs text-muted-foreground">Errors</p>
    </div>
    <div className="text-center rounded-lg bg-muted p-3">
      <p className="text-xl font-bold">{props.activeStreamCount}</p>
      <p className="text-xs text-muted-foreground">Active Streams</p>
    </div>
    <div className="text-center rounded-lg bg-muted p-3">
      <p className="text-xl font-bold">{props.summary.slowOperationsCount}</p>
      <p className="text-xs text-muted-foreground">Slow Operations</p>
    </div>
  </div>
);

const FrontendActiveStreamRow = (
  props: DeepReadonly<{
    stream: DebugPerformanceSnapshot["activeStreams"][number];
    currentTime: number;
  }>,
) => (
  <div className="flex items-center justify-between rounded bg-muted p-2 text-sm">
    <span className="font-mono text-xs">{props.stream.streamId.slice(0, 12)}...</span>
    <span>{props.stream.eventCount} events</span>
    <span className="text-muted-foreground">
      {((props.currentTime - props.stream.startTime) / 1000).toFixed(1)}s
    </span>
  </div>
);

const FrontendActiveStreams = (
  props: DeepReadonly<{
    activeStreams: readonly DebugPerformanceSnapshot["activeStreams"][number][];
    currentTime: number;
  }>,
) => {
  if (props.activeStreams.length === ZERO) {
    return null;
  }
  return (
    <div>
      <h3 className="mb-2 text-sm font-medium">Active Frontend Streams</h3>
      <div className="space-y-1">
        {props.activeStreams.map((stream) => (
          <FrontendActiveStreamRow
            key={stream.streamId}
            currentTime={props.currentTime}
            stream={stream}
          />
        ))}
      </div>
    </div>
  );
};

const FrontendRecentEventRow = (
  props: DeepReadonly<{ event: DebugPerformanceSnapshot["recentEvents"][number] }>,
) => (
  <div className="flex items-start gap-2 rounded p-1 font-mono text-xs hover:bg-muted">
    <span className="w-20 flex-shrink-0 text-muted-foreground">
      {new Date(props.event.timestamp).toLocaleTimeString()}
    </span>
    <span className={`rounded px-1 ${debugEventClassName(props.event.eventType)}`}>
      {props.event.eventType}
    </span>
    <span className="flex-1 truncate">{props.event.message ?? ""}</span>
  </div>
);

const FrontendRecentEvents = (
  props: DeepReadonly<{
    recentEvents: readonly DebugPerformanceSnapshot["recentEvents"][number][];
  }>,
) => (
  <div>
    <h3 className="mb-2 text-sm font-medium">Recent Frontend Events</h3>
    <div className="max-h-40 space-y-1 overflow-y-auto">
      {props.recentEvents
        .slice(-20)
        .toReversed()
        .map((event) => (
          <FrontendRecentEventRow
            key={`${event.timestamp}-${event.eventType}-${event.message ?? ""}`}
            event={event}
          />
        ))}
    </div>
  </div>
);

const FrontendPerfCard = (
  props: DeepReadonly<{ frontendPerfData: DebugPerformanceSnapshot | undefined }>,
) => {
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, []);
  if (props.frontendPerfData === undefined) {
    return null;
  }
  return (
    <Card className="border-white/5 bg-black/20 transition-all hover:-translate-y-px hover:bg-white/[0.03] hover:shadow-lg">
      <CardHeader>
        <CardTitle className="font-serif">Frontend Performance</CardTitle>
        <CardDescription className="font-mono text-[10px] uppercase tracking-widest">
          Browser-side metrics and stream tracking
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <FrontendPerformanceSummary
          activeStreamCount={props.frontendPerfData.activeStreams.length}
          summary={props.frontendPerfData.summary}
        />
        <FrontendActiveStreams
          activeStreams={props.frontendPerfData.activeStreams}
          currentTime={currentTime}
        />
        <FrontendRecentEvents recentEvents={props.frontendPerfData.recentEvents} />
      </CardContent>
    </Card>
  );
};

const PerformanceReportSummary = (props: DeepReadonly<Pick<BackendDebugReport, "summary">>) => (
  <div className="grid gap-4 md:grid-cols-3">
    <PerformanceMetric label="Total Events" value={props.summary?.total_events ?? 0} />
    <PerformanceMetric
      label="Slow Operations"
      value={props.summary?.slow_operations ?? 0}
      tone="slow"
    />
    <PerformanceMetric label="Errors" value={props.summary?.errors ?? 0} tone="error" />
  </div>
);

const PerformanceMetric = (
  props: Readonly<{ label: string; value: number; tone?: "error" | "slow" }>,
) => {
  const valueClass = getPerformanceMetricClass(props.tone);
  return (
    <div className="rounded-lg bg-muted p-4 text-center">
      <p className={valueClass}>{props.value}</p>
      <p className="text-sm text-muted-foreground">{props.label}</p>
    </div>
  );
};

const getPerformanceMetricClass = (tone: "error" | "slow" | undefined): string => {
  if (tone === "error") {
    return "text-2xl font-bold text-red-600";
  }
  if (tone === "slow") {
    return "text-2xl font-bold text-yellow-600";
  }
  return "text-2xl font-bold";
};

const ActiveBackendStreamRow = (props: DeepReadonly<{ stream: DebugActiveStreamRecord }>) => (
  <div className="flex items-center justify-between rounded bg-muted p-2 text-sm">
    <span className="font-mono">{(props.stream.stream_id ?? "").slice(0, 8)}...</span>
    <span>{props.stream.request_path ?? ""}</span>
    <span className="text-muted-foreground">{(props.stream.duration_so_far ?? 0).toFixed(1)}s</span>
  </div>
);

const ActiveBackendStreams = (
  props: DeepReadonly<{ streams: readonly DebugActiveStreamRecord[] }>,
) => {
  if (props.streams.length === ZERO) {
    return null;
  }
  return (
    <div>
      <h3 className="mb-2 font-medium">Active Streams</h3>
      <div className="space-y-2">
        {props.streams.map((stream) => (
          <ActiveBackendStreamRow
            key={`${stream.stream_id ?? "stream"}-${stream.request_path ?? "path"}-${stream.duration_so_far ?? "duration"}`}
            stream={stream}
          />
        ))}
      </div>
    </div>
  );
};

const DebugRecommendations = (props: DeepReadonly<{ recommendations: readonly string[] }>) => {
  if (props.recommendations.length === ZERO) {
    return null;
  }
  return (
    <div>
      <h3 className="mb-2 font-medium">Recommendations</h3>
      <ul className="space-y-1 text-sm text-muted-foreground">
        {props.recommendations.map((recommendation) => (
          <RecommendationItem key={recommendation} recommendation={recommendation} />
        ))}
      </ul>
    </div>
  );
};

const RecommendationItem = (props: Readonly<{ recommendation: string }>) => (
  <li className="flex items-start gap-2">
    <span className="text-yellow-500">!</span>
    {props.recommendation}
  </li>
);

const reportGeneratedAt = (value: string | undefined): string => {
  if (value === undefined || value === "") {
    return "unknown";
  }
  return formatTimestamp(value);
};

const PerformanceReportCard = (
  props: Readonly<{ backendDebugReport: BackendDebugReport | undefined }>,
) => {
  const report = props.backendDebugReport;
  if (report === undefined) {
    return null;
  }
  const activeStreams = report.active_streams ?? EMPTY_ACTIVE_STREAMS;
  const recommendations = report.recommendations ?? EMPTY_RECOMMENDATIONS;
  return (
    <Card className="border-white/5 bg-black/20 transition-all hover:-translate-y-px hover:bg-white/[0.03] hover:shadow-lg">
      <CardHeader>
        <CardTitle className="font-serif">Backend Debug Report</CardTitle>
        <CardDescription className="font-mono text-[10px] uppercase tracking-widest">
          Generated at {reportGeneratedAt(report.generated_at)}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <PerformanceReportSummary summary={report.summary} />
        <ActiveBackendStreams streams={activeStreams} />
        <DebugRecommendations recommendations={recommendations} />
      </CardContent>
    </Card>
  );
};

const SlowOperationDetails = (props: DeepReadonly<{ operation: DebugSlowOperationRecord }>) => {
  const requestId = textOr(props.operation.request_id, "");
  const streamId = textOr(props.operation.stream_id, "");
  if (requestId === "" && streamId === "") {
    return null;
  }
  return (
    <div className="text-muted-foreground">
      {requestId !== "" && <p>Request: {requestId}</p>}
      {streamId !== "" && <p>Stream: {streamId}</p>}
    </div>
  );
};

const SlowOperationRow = (props: DeepReadonly<{ operation: DebugSlowOperationRecord }>) => (
  <div
    className="rounded border border-border bg-muted/30 p-2"
    key={`${props.operation.request_id ?? "request"}-${props.operation.stream_id ?? "stream"}-${props.operation.event_type ?? "operation"}-${props.operation.duration_ms ?? "duration"}`}
  >
    <div className="flex items-center justify-between gap-2">
      <span>{props.operation.event_type ?? "operation"}</span>
      <span className="text-yellow-600 dark:text-yellow-400">
        {formatMilliseconds(props.operation.duration_ms)}
      </span>
    </div>
    <SlowOperationDetails operation={props.operation} />
  </div>
);

const SlowOperationItems = (
  props: DeepReadonly<{ operations: readonly DebugSlowOperationRecord[] }>,
) => {
  if (props.operations.length === ZERO) {
    return <p className="text-sm text-muted-foreground">No slow operations detected</p>;
  }
  return (
    <div className="space-y-2 font-mono text-xs">
      {props.operations.map((operation) => (
        <SlowOperationRow
          key={`${operation.request_id ?? "request"}-${operation.stream_id ?? "stream"}-${operation.event_type ?? "operation"}-${operation.duration_ms ?? "duration"}`}
          operation={operation}
        />
      ))}
    </div>
  );
};

const SlowOperationsCard = (
  props: Readonly<{ backendSlowOps: readonly DebugSlowOperationRecord[] }>,
) => (
  <Card className="border-white/5 bg-black/20 transition-all hover:-translate-y-px hover:bg-white/[0.03] hover:shadow-lg">
    <CardHeader>
      <CardTitle className="font-serif">Slow Operations</CardTitle>
      <CardDescription className="font-mono text-[10px] uppercase tracking-widest">
        Backend operations above the slow-operation threshold
      </CardDescription>
    </CardHeader>
    <CardContent>
      <SlowOperationItems operations={props.backendSlowOps} />
    </CardContent>
  </Card>
);

const formatLogFileSize = (sizeBytes: number | undefined): string => {
  if (sizeBytes === undefined) {
    return "";
  }
  return `${(sizeBytes / 1024).toFixed(1)} KB`;
};

const LogFileRow = (props: DeepReadonly<{ file: DebugLogFileRecord }>) => {
  const filename = textOr(props.file.filename, "debug-log");
  return (
    <div className="flex items-center justify-between rounded border p-2 text-sm">
      <div>
        <span className="font-mono">{filename}</span>
        <span className="ml-2 text-xs text-muted-foreground">
          {formatLogFileSize(props.file.size_bytes)}
        </span>
      </div>
      <a
        href={`${API_BASE_URL}/debug/logs/file/${filename}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-blue-600 hover:underline"
      >
        Download
      </a>
    </div>
  );
};

const LogFileItems = (props: DeepReadonly<{ files: readonly DebugLogFileRecord[] }>) => {
  if (props.files.length === ZERO) {
    return <p className="text-sm text-muted-foreground">No log files available</p>;
  }
  return (
    <div className="space-y-2">
      {props.files.map((file) => (
        <LogFileRow
          key={`${file.filename ?? "file"}-${file.modified ?? "modified"}-${file.size_bytes ?? "size"}`}
          file={file}
        />
      ))}
    </div>
  );
};

const LogFilesCard = (props: Readonly<{ backendLogFiles: readonly DebugLogFileRecord[] }>) => (
  <Card className="border-white/5 bg-black/20 transition-all hover:-translate-y-px hover:bg-white/[0.03] hover:shadow-lg">
    <CardHeader>
      <CardTitle className="font-serif">Debug Log Files</CardTitle>
      <CardDescription className="font-mono text-[10px] uppercase tracking-widest">
        JSON Lines log files saved on the backend
      </CardDescription>
    </CardHeader>
    <CardContent>
      <LogFileItems files={props.backendLogFiles} />
    </CardContent>
  </Card>
);

const PerformanceSection = (props: Readonly<PerformanceSectionProps>) => (
  <TabsContent value="performance" className="space-y-4">
    <PerformanceReportCard backendDebugReport={props.backendDebugReport} />
    <SlowOperationsCard backendSlowOps={props.backendSlowOps} />
    <BackendEventsCard backendLogEvents={props.backendLogEvents} />
    <FrontendPerfCard frontendPerfData={props.frontendPerfData} />
    <LogFilesCard backendLogFiles={props.backendLogFiles} />
  </TabsContent>
);

export { PerformanceSection };
