/** Pure data transformations used by the frontend performance logger. */

import { hasText } from "@/lib/utils";
import type { ApiOpaqueObject, FrontendDebugReportPayload } from "./api";
import type { DeepReadonly } from "./deep-readonly";

type EventType =
  | "page_load"
  | "stream_start"
  | "stream_event"
  | "stream_end"
  | "stream_error"
  | "stream_timeout"
  | "api_request_start"
  | "api_request_end"
  | "api_request_error"
  | "render_start"
  | "render_end"
  | "user_action"
  | "performance_warning"
  | "error";

interface PerformanceEvent {
  eventId: string;
  eventType: EventType;
  timestamp: string;
  component: string;
  operation: string;
  message?: string;
  durationMs?: number;
  details?: ApiOpaqueObject;
  error?: string;
  stackTrace?: string;
  isSlow?: boolean;
  streamId?: string;
  requestId?: string;
}

interface StreamMetrics {
  streamId: string;
  startTime: number;
  firstEventTime?: number;
  timeToFirstEvent?: number;
  eventCount: number;
  articleCount: number;
  sourceCount: number;
  errorCount: number;
  lastEventTime: number;
  endTime?: number;
  totalDurationMs?: number;
  events: {
    type: string;
    timestamp: number;
    articleCount?: number;
    source?: string;
  }[];
}

interface PerformanceSummary {
  sessionId: string;
  startTime: string;
  totalEvents: number;
  slowOperationsCount: number;
  errorCount: number;
  streamMetrics: StreamMetrics[];
  componentStats: Record<
    string,
    {
      count: number;
      avgDurationMs: number;
      maxDurationMs: number;
      errorCount: number;
    }
  >;
}

interface StreamEventOptions {
  articleCount?: number;
  source?: string;
  isError?: boolean;
  details?: ApiOpaqueObject;
}

const getFirstEventTime = (
  metrics: DeepReadonly<StreamMetrics>,
  eventName: string,
  now: number,
): number | undefined => {
  if (
    (metrics.firstEventTime === undefined || metrics.firstEventTime === 0) &&
    eventName !== "start"
  ) {
    return now;
  }
  return metrics.firstEventTime;
};

const getTimeToFirstEvent = (
  firstEventTime: number | undefined,
  metrics: DeepReadonly<StreamMetrics>,
  now: number,
): number | undefined => {
  if (firstEventTime === now && metrics.firstEventTime === undefined) {
    return now - metrics.startTime;
  }
  return metrics.timeToFirstEvent;
};

const updateStreamMetrics = (
  metrics: DeepReadonly<StreamMetrics>,
  eventName: string,
  options: DeepReadonly<StreamEventOptions>,
  now: number,
): StreamMetrics => {
  const firstEventTime = getFirstEventTime(metrics, eventName, now),
    timeToFirstEvent = getTimeToFirstEvent(firstEventTime, metrics, now);
  return {
    ...metrics,
    articleCount: metrics.articleCount + (options.articleCount ?? 0),
    errorCount: metrics.errorCount + Number(options.isError === true),
    eventCount: metrics.eventCount + 1,
    events: [
      ...metrics.events,
      {
        articleCount: options.articleCount,
        source: options.source,
        timestamp: now,
        type: eventName,
      },
    ].slice(-50),
    firstEventTime,
    lastEventTime: now,
    sourceCount: metrics.sourceCount + Number(hasText(options.source)),
    timeToFirstEvent,
  };
};

const streamEventDetails = (
  metrics: DeepReadonly<StreamMetrics>,
  options: DeepReadonly<StreamEventOptions>,
  now: number,
): ApiOpaqueObject => {
  const previousEvent = metrics.events.at(-2);
  return {
    ...options.details,
    articleCount: options.articleCount,
    eventGapMs: (() => {
      if (previousEvent) {
        return now - previousEvent.timestamp;
      }
      return 0;
    })(),
    source: options.source,
    totalArticles: metrics.articleCount,
    totalSources: metrics.sourceCount,
  };
};

interface DebugReportSummaryInput {
  readonly componentStats: Readonly<
    Record<
      string,
      Readonly<{
        readonly avgDurationMs: number;
        readonly count: number;
        readonly errorCount: number;
        readonly maxDurationMs: number;
      }>
    >
  >;
  readonly errorCount: number;
  readonly sessionId: string;
  readonly slowOperationsCount: number;
  readonly startTime: string;
  readonly streamMetrics: readonly Readonly<Pick<StreamMetrics, "eventCount" | "startTime" | "streamId">>[];
  readonly totalEvents: number;
}

const buildFrontendDebugReport = (
  summary: DebugReportSummaryInput,
  recentEvents: readonly Readonly<PerformanceEvent>[],
  slowOperations: readonly Readonly<PerformanceEvent>[],
  errors: readonly Readonly<PerformanceEvent>[],
): FrontendDebugReportPayload => ({
  dom_stats: {
    body_text_length: globalThis.document.body?.textContent?.length ?? 0,
    node_count: globalThis.document.querySelectorAll("*").length,
    title: globalThis.document.title,
    viewport: {
      height: globalThis.innerHeight,
      width: globalThis.innerWidth,
    },
  },
  errors,
  generated_at: new Date().toISOString(),
  location: globalThis.location?.pathname,
  recent_events: recentEvents,
  session_id: summary.sessionId,
  slow_operations: slowOperations,
  summary: {
    componentStats: summary.componentStats,
    errorCount: summary.errorCount,
    sessionId: summary.sessionId,
    slowOperationsCount: summary.slowOperationsCount,
    startTime: summary.startTime,
    streamMetrics: summary.streamMetrics.map(({ eventCount, startTime, streamId }) => ({
      eventCount,
      startTime,
      streamId,
    })),
    totalEvents: summary.totalEvents,
  },
  user_agent: globalThis.navigator.userAgent,
});


export {
  buildFrontendDebugReport,
  streamEventDetails,
  updateStreamMetrics,
  type DebugReportSummaryInput,
  type EventType,
  type PerformanceEvent,
  type PerformanceSummary,
  type StreamEventOptions,
  type StreamMetrics,
};
