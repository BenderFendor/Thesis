/**
 * Frontend Performance Logger
 *
 * Captures timing, errors, and events from the frontend for debugging.
 * Designed to provide data that correlates with backend debug logs.
 */

import { sendFrontendDebugReport } from './api';
import type { FrontendDebugReportPayload } from './api';

// Configuration
const FLUSH_INTERVAL_MS = 30_000,
 MAX_EVENTS = 500, // 30 seconds
 SLOW_THRESHOLD_MS = 3000, // 3 seconds
 ENABLE_AGENTIC_LOGGING =
  process.env.NEXT_PUBLIC_ENABLE_AGENTIC_LOGGING === "true" ||
  process.env.NODE_ENV === "development",
 IGNORED_ERROR_MESSAGES = [
  "ResizeObserver loop completed with undelivered notifications.",
  "ResizeObserver loop limit exceeded",
];

export type EventType =
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

export interface PerformanceEvent {
  eventId: string;
  eventType: EventType;
  timestamp: string;
  component: string;
  operation: string;
  message?: string;
  durationMs?: number;
  details?: Record<string, unknown>;
  error?: string;
  stackTrace?: string;
  isSlow?: boolean;
  streamId?: string;
  requestId?: string;
}

export interface StreamMetrics {
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

export interface PerformanceSummary {
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

interface LogEventOptions {
  message?: string;
  durationMs?: number;
  details?: Record<string, unknown>;
  error?: Error | string;
  streamId?: string;
  requestId?: string;
}

interface StreamEventOptions {
  articleCount?: number;
  source?: string;
  isError?: boolean;
  details?: Record<string, unknown>;
}

function applyEventError(event: PerformanceEvent, error: Error | string | undefined): void {
  if (error instanceof Error) {
    event.error = error.message;
    event.stackTrace = error.stack;
    return;
  }
  if (error) {
    event.error = String(error);
  }
}

function recordComponentTiming(
  componentTimings: Map<string, number[]>,
  component: string,
  durationMs: number | undefined,
): void {
  if (!durationMs) {return;}
  const timings = componentTimings.get(component) || [];
  timings.push(durationMs);
  if (timings.length > 100) {timings.shift();}
  componentTimings.set(component, timings);
}

function logDevelopmentEvent(event: PerformanceEvent): void {
  if (process.env.NODE_ENV !== "development") {return;}
  const logFn = event.error ? console.error : (event.isSlow ? console.warn : console.debug);
  logFn(`[PerfLog] ${event.eventType} ${event.component}/${event.operation}`, {
    duration: event.durationMs ? `${event.durationMs}ms` : undefined,
    ...event.details,
    error: event.error,
  });
}

function updateStreamMetrics(
  metrics: StreamMetrics,
  eventName: string,
  options: StreamEventOptions,
  now: number,
): void {
  if (!metrics.firstEventTime && eventName !== "start") {
    metrics.firstEventTime = now;
    metrics.timeToFirstEvent = now - metrics.startTime;
  }
  metrics.eventCount += 1;
  metrics.lastEventTime = now;
  if (options.articleCount) {metrics.articleCount += options.articleCount;}
  if (options.source) {metrics.sourceCount += 1;}
  if (options.isError) {metrics.errorCount += 1;}
  metrics.events.push({
    articleCount: options.articleCount,
    source: options.source,
    timestamp: now,
    type: eventName,
  });
  if (metrics.events.length > 50) {metrics.events.shift();}
}

function streamEventDetails(
  metrics: StreamMetrics,
  options: StreamEventOptions,
  now: number,
): Record<string, unknown> {
  const previousEvent = metrics.events.at(-2);
  return {
    ...options.details,
    articleCount: options.articleCount,
    eventGapMs: previousEvent ? now - previousEvent.timestamp : 0,
    source: options.source,
    totalArticles: metrics.articleCount,
    totalSources: metrics.sourceCount,
  };
}

function logFlushSummary(sessionId: string, eventCount: number): void {
  if (process.env.NODE_ENV !== "development" || eventCount === 0) {
    return;
  }
  console.debug(
    `[PerfLog] Session ${sessionId}: ${eventCount} events captured`,
  );
}

function canFlushFrontendDebugEvents(): boolean {
  return ENABLE_AGENTIC_LOGGING && typeof window !== "undefined";
}

function buildFrontendDebugReport(
  summary: Readonly<PerformanceSummary>,
  recentEvents:readonly PerformanceEvent[],
  slowOperations:readonly PerformanceEvent[],
  errors:readonly PerformanceEvent[],
): FrontendDebugReportPayload {
  return {
    dom_stats: {
      body_text_length: document.body?.textContent?.length ?? 0,
      node_count: document.querySelectorAll("*").length,
      title: document.title,
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
      streamMetrics: summary.streamMetrics,
      totalEvents: summary.totalEvents,
    },
    user_agent: navigator.userAgent,
  };
}

class FrontendPerformanceLogger {
  private readonly events: PerformanceEvent[] = [];
  private eventCounter = 0;
  private readonly sessionId: string;
  private readonly activeStreams = new Map<string, StreamMetrics>();
  private readonly componentTimings = new Map<string, number[]>();
  private readonly flushInterval: NodeJS.Timeout | undefined;
  private lastFlushedEventIndex = 0;

  constructor() {
    this.sessionId = `fe_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Set up periodic flush
    if (typeof window !== "undefined") {
      this.flushInterval = setInterval(() =>{  this.flush(); }, FLUSH_INTERVAL_MS);

      // Log page load
      if (document.readyState === "complete") {
        this.logPageLoad();
      } else {
        globalThis.addEventListener("load", () =>{  this.logPageLoad(); });
      }

      // Capture unhandled errors
      globalThis.addEventListener("error", (event) => {
        this.logError("window", "unhandled_error", event.error || event.message);
      });

      globalThis.addEventListener("unhandledrejection", (event) => {
        this.logError("promise", "unhandled_rejection", event.reason);
      });
    }
  }

  private generateEventId(): string {
    this.eventCounter += 1;
    return `fe_evt_${this.sessionId}_${this.eventCounter.toString().padStart(6, "0")}`;
  }

  private logPageLoad(): void {
    if (typeof window === "undefined" || !globalThis.performance) {return;}

    const performanceRuntime = globalThis.performance,
     navigationEntries =
      typeof performanceRuntime.getEntriesByType === "function"
        ? performanceRuntime.getEntriesByType("navigation")
        : [],

     navigationEntry =
      typeof PerformanceNavigationTiming === "undefined"
        ? undefined
        : navigationEntries.find(
            (entry): entry is PerformanceNavigationTiming =>
              entry instanceof PerformanceNavigationTiming,
          );

    let domComplete = 0,
     domReady = 0,
     loadTime = 0,
     resourceLoadTime = 0,
     ttfb = 0;

    if (navigationEntry) {
      loadTime = Math.round(navigationEntry.loadEventEnd);
      domReady = Math.round(navigationEntry.domContentLoadedEventEnd);
      ttfb = Math.round(navigationEntry.responseStart);
      domComplete = Math.round(navigationEntry.domComplete);
      resourceLoadTime = Math.max(0, Math.round(loadTime - domReady));
    } else {
      const {timing} = performanceRuntime;
      if (!timing) {return;}
      loadTime = Math.max(0, timing.loadEventEnd - timing.navigationStart);
      domReady = Math.max(
        0,
        timing.domContentLoadedEventEnd - timing.navigationStart,
      );
      ttfb = Math.max(0, timing.responseStart - timing.navigationStart);
      domComplete = Math.max(0, timing.domComplete - timing.navigationStart);
      resourceLoadTime = Math.max(
        0,
        timing.loadEventEnd - timing.domContentLoadedEventEnd,
      );
    }

    this.logEvent("page_load", "page", "load", {
      details: {
        domComplete,
        domReady,
        resourceLoadTime,
        ttfb,
        url: globalThis.location.pathname,
      },
      durationMs: loadTime,
      message: `Page loaded in ${loadTime}ms`,
    });
  }

  logEvent(
    eventType: EventType,
    component: string,
    operation: string,
    options: LogEventOptions = {}
  ): PerformanceEvent {
    const event: PerformanceEvent = {
      component,
      details: options.details,
      durationMs: options.durationMs,
      eventId: this.generateEventId(),
      eventType,
      message: options.message,
      operation,
      requestId: options.requestId,
      streamId: options.streamId,
      timestamp: new Date().toISOString(),
    };

    applyEventError(event, options.error)

    // Check for slow operations
    if (options.durationMs && options.durationMs > SLOW_THRESHOLD_MS) {
      event.isSlow = true;
    }

    // Track component timing
    recordComponentTiming(this.componentTimings, component, options.durationMs)

    // Store event
    this.events.push(event);
    if (this.events.length > MAX_EVENTS) {
      this.events.shift();
    }

    // Log to console in development
    logDevelopmentEvent(event)

    return event;
  }

  logError(component: string, operation: string, error: Error | string): PerformanceEvent {
    const message = error instanceof Error ? error.message : String(error);
    if (this.shouldIgnoreError(message)) {
      return this.logEvent("performance_warning", component, operation, {
        details: { error: message },
        message: "Ignored noisy browser error",
      });
    }
    return this.logEvent("error", component, operation, { error });
  }

  private shouldIgnoreError(message: string): boolean {
    return IGNORED_ERROR_MESSAGES.some((pattern) => message.includes(pattern));
  }

  // --- Stream Tracking ---

  startStream(streamId: string): void {
    const metrics: StreamMetrics = {
      articleCount: 0,
      errorCount: 0,
      eventCount: 0,
      events: [],
      lastEventTime: Date.now(),
      sourceCount: 0,
      startTime: Date.now(),
      streamId,
    };

    this.activeStreams.set(streamId, metrics);

    this.logEvent("stream_start", "stream", "start", {
      message: `Stream ${streamId} started`,
      streamId,
    });
  }

  logStreamEvent(
    streamId: string,
    eventName: string,
    options: StreamEventOptions = {}
  ): void {
    const metrics = this.activeStreams.get(streamId);
    if (!metrics) {return;}

    const now = Date.now();
    updateStreamMetrics(metrics, eventName, options, now)

    const eventType: EventType = options.isError ? "stream_error" : "stream_event";

    this.logEvent(eventType, "stream", eventName, {
      details: {
        ...streamEventDetails(metrics, options, now),
      },
      streamId,
    });
  }

  endStream(
    streamId: string,
    reason: "complete" | "error" | "timeout" | "cancelled" = "complete"
  ): StreamMetrics | undefined {
    const metrics = this.activeStreams.get(streamId);
    if (!metrics) {return undefined;}

    const now = Date.now();
    metrics.endTime = now;
    metrics.totalDurationMs = now - metrics.startTime;

    this.activeStreams.delete(streamId);

    const eventType: EventType =
      reason === "error" ? "stream_error" : (reason === "timeout" ? "stream_timeout" : "stream_end");

    this.logEvent(eventType, "stream", "end", {
      details: {
        errorCount: metrics.errorCount,
        reason,
        timeToFirstEvent: metrics.timeToFirstEvent,
        totalArticles: metrics.articleCount,
        totalEvents: metrics.eventCount,
        totalSources: metrics.sourceCount,
      },
      durationMs: metrics.totalDurationMs,
      message: `Stream ${streamId} ended: ${reason}`,
      streamId,
    });

    return metrics;
  }

  // --- API Request Tracking ---

  trackApiRequest<T>(
    operation: string,
    url: string,
    requestFn: () => Promise<T>
  ): Promise<T> {
    const startTime = Date.now(),
     requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

    this.logEvent("api_request_start", "api", operation, {
      details: { url },
      requestId,
    });

    return requestFn()
      .then((result) => {
        const durationMs = Date.now() - startTime;
        this.logEvent("api_request_end", "api", operation, {
          details: { success: true, url },
          durationMs,
          requestId,
        });
        return result;
      })
      .catch((error) => {
        const durationMs = Date.now() - startTime;
        this.logEvent("api_request_error", "api", operation, {
          details: { success: false, url },
          durationMs,
          error,
          requestId,
        });
        throw error;
      });
  }

  // --- Render Tracking ---

  trackRender<T>(
    componentName: string,
    renderFn: () => T
  ): T {
    const startTime = Date.now();

    this.logEvent("render_start", "render", componentName, {});

    try {
      const result = renderFn(),
       durationMs = Date.now() - startTime;
      this.logEvent("render_end", "render", componentName, {
        details: { success: true },
        durationMs,
      });
      return result;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      this.logEvent("render_end", "render", componentName, {
        details: { success: false },
        durationMs,
        error: error as Error,
      });
      throw error;
    }
  }

  // --- User Action Tracking ---

  logUserAction(action: string, details?: Record<string, unknown>): void {
    this.logEvent("user_action", "user", action, {
      details,
      message: `User action: ${action}`,
    });
  }

  // --- Summary and Export ---

  getSummary(): PerformanceSummary {
    const componentStats: PerformanceSummary["componentStats"] = {};

    for (const [component, timings] of this.componentTimings.entries()) {
      if (timings.length === 0) {continue;}
      const avg = timings.reduce((a, b) => a + b, 0) / timings.length,
       max = Math.max(...timings),
       errors = this.events.filter(
        (e) => e.component === component && e.error
      ).length;

      componentStats[component] = {
        avgDurationMs: Math.round(avg),
        count: timings.length,
        errorCount: errors,
        maxDurationMs: max,
      };
    }

    return {
      componentStats,
      errorCount: this.events.filter((e) => e.error).length,
      sessionId: this.sessionId,
      slowOperationsCount: this.events.filter((e) => e.isSlow).length,
      startTime: this.events[0]?.timestamp || new Date().toISOString(),
      streamMetrics: [...this.activeStreams.values()],
      totalEvents: this.events.length,
    };
  }

  getRecentEvents(limit = 50): PerformanceEvent[] {
    return this.events.slice(-limit);
  }

  getSlowOperations(): PerformanceEvent[] {
    return this.events.filter((e) => e.isSlow);
  }

  getErrors(): PerformanceEvent[] {
    return this.events.filter((e) => e.error);
  }

  getStreamMetrics(streamId: string): StreamMetrics | undefined {
    return this.activeStreams.get(streamId);
  }

  // Export all data for debugging
  exportDebugData(): {
    summary: PerformanceSummary;
    recentEvents: PerformanceEvent[];
    slowOperations: PerformanceEvent[];
    errors: PerformanceEvent[];
    activeStreams: StreamMetrics[];
  } {
    return {
      activeStreams: [...this.activeStreams.values()],
      errors: this.getErrors(),
      recentEvents: this.getRecentEvents(100),
      slowOperations: this.getSlowOperations(),
      summary: this.getSummary(),
    };
  }

  // Flush events (could send to backend in the future)
  private flush(): void {
    logFlushSummary(this.sessionId, this.events.length);
    const recentEvents = this.getFlushEvents();
    if (recentEvents === undefined) {
      return;
    }

    void sendFrontendDebugReport(
      buildFrontendDebugReport(
        this.getSummary(),
        recentEvents,
        this.getSlowOperations(),
        this.getErrors(),
      ),
    );
  }

  private getFlushEvents(): PerformanceEvent[] | undefined {
    if (!canFlushFrontendDebugEvents()) {
      return undefined;
    }
    const recentEvents = this.getUnflushedEvents();
    if (recentEvents.length === 0) {
      return undefined;
    }
    return recentEvents;
  }

  private getUnflushedEvents(): PerformanceEvent[] {
    const startIndex = Math.min(
      this.lastFlushedEventIndex,
      this.events.length,
    );
    this.lastFlushedEventIndex = this.events.length;
    return this.events.slice(startIndex);
  }

  // Cleanup
  destroy(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
  }
}

// Singleton instance
export const perfLogger = new FrontendPerformanceLogger();

// Convenience functions
export const logEvent = perfLogger.logEvent.bind(perfLogger);
export const logError = perfLogger.logError.bind(perfLogger);
export const startStream = perfLogger.startStream.bind(perfLogger);
export const logStreamEvent = perfLogger.logStreamEvent.bind(perfLogger);
export const endStream = perfLogger.endStream.bind(perfLogger);
export const trackApiRequest = perfLogger.trackApiRequest.bind(perfLogger);
export const logUserAction = perfLogger.logUserAction.bind(perfLogger);
export const getSummary = perfLogger.getSummary.bind(perfLogger);
export const exportDebugData = perfLogger.exportDebugData.bind(perfLogger);

declare global {
  interface Window {
    perfLogger?: FrontendPerformanceLogger;
    exportDebugData?: typeof exportDebugData;
  }
}

// Make available globally for debugging in console
if (typeof window !== "undefined") {
  globalThis.window.perfLogger = perfLogger;
  globalThis.window.exportDebugData = exportDebugData;
}
