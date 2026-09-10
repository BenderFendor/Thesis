import { hasText } from "@/lib/utils";
/**
 * Frontend Performance Logger
 *
 * Captures timing, errors, and events from the frontend for debugging.
 * Designed to provide data that correlates with backend debug logs.
 */

import type { ApiOpaqueObject } from "./api";
import { sendFrontendDebugReport } from "./api";
import {
  buildFrontendDebugReport,
  streamEventDetails,
  updateStreamMetrics,
} from "./performance-logger-model";
import type {
  EventType,
  PerformanceEvent,
  PerformanceSummary,
  StreamEventOptions,
  StreamMetrics,
} from "./performance-logger-model";

// Configuration
const FLUSH_INTERVAL_MS = 30_000;
const MAX_EVENTS = 500;
const SLOW_THRESHOLD_MS = 3000;
  const ENABLE_AGENTIC_LOGGING =
    process.env.NEXT_PUBLIC_ENABLE_AGENTIC_LOGGING === "true" ||
    process.env.NODE_ENV === "development";
  const IGNORED_ERROR_MESSAGES = [
    "ResizeObserver loop completed with undelivered notifications.",
    "ResizeObserver loop limit exceeded",
  ];

interface LogEventOptions {
  message?: string;
  durationMs?: number;
  details?: ApiOpaqueObject;
  error?: Error | string;
  streamId?: string;
  requestId?: string;
}

interface NavigationTimingEntry extends PerformanceEntry {
  readonly domComplete: number;
  readonly domContentLoadedEventEnd: number;
  readonly loadEventEnd: number;
  readonly responseStart: number;
}

const isNavigationTimingEntry = (
  entry: Readonly<PerformanceEntry>,
): entry is NavigationTimingEntry =>
  "domComplete" in entry &&
  "domContentLoadedEventEnd" in entry &&
  "loadEventEnd" in entry &&
  "responseStart" in entry;

const getEventErrorFields = (
  error: Error | string | undefined,
): Pick<PerformanceEvent, "error" | "stackTrace"> => {
  if (error instanceof Error) {
    return { error: error.message, stackTrace: error.stack };
  }
  if (hasText(error)) {
    return { error };
  }
  return {};
};

const getSlowEventFields = (
  durationMs: number | undefined,
): Pick<PerformanceEvent, "isSlow"> => {
  if (durationMs !== undefined && durationMs !== 0 && durationMs > SLOW_THRESHOLD_MS) {
    return { isSlow: true };
  }
  return {};
};

const recordComponentTiming = (
  timingsByComponent: Map<string, number[]>,
  component: string,
  durationMs: number | undefined,
): void => {
  if (durationMs === undefined || durationMs === 0) {
    return;
  }
  const timings = [...(timingsByComponent.get(component) ?? []), durationMs].slice(-100);
  timingsByComponent.set(component, timings);
};

const logDevelopmentEvent = (event: Readonly<PerformanceEvent>): void => {
  if (process.env.NODE_ENV !== "development") {
    return;
  }
  const logFn = (() => {
  if (hasText(event.error)) {
    return console.error;
  }
  return (() => {
    if (event.isSlow === true) {
      return console.warn;
    }
    return console.debug;
  })();
})();
  logFn(`[PerfLog] ${event.eventType} ${event.component}/${event.operation}`, {
    duration: (() => {
  if (event.durationMs !== undefined && event.durationMs !== 0) {
    return `${event.durationMs}ms`;
  }
  return void 0;
})(),
    ...event.details,
    error: event.error,
  });
};

const logFlushSummary = (sessionId: string, eventCount: number): void => {
  if (process.env.NODE_ENV !== "development" || eventCount === 0) {
    return;
  }
  console.debug(`[PerfLog] Session ${sessionId}: ${eventCount} events captured`);
};

const canFlushFrontendDebugEvents = (): boolean =>
  ENABLE_AGENTIC_LOGGING && globalThis.window !== undefined;

class FrontendPerformanceLogger {
  private readonly events: PerformanceEvent[] = [];
  private eventCounter = 0;
  private readonly sessionId: string;
  private readonly activeStreams = new Map<string, StreamMetrics>();
  private readonly componentTimings = new Map<string, number[]>();
  private readonly flushInterval: NodeJS.Timeout | undefined;
  private lastFlushedEventIndex = 0;

  constructor() {
    this.sessionId = `fe_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

    // Set up periodic flush
    if (globalThis.window !== undefined) {
      this.flushInterval = setInterval(() => {
        this.flush();
      }, FLUSH_INTERVAL_MS);

      // Log page load
      if (globalThis.document.readyState === "complete") {
        this.logPageLoad();
      } else {
        globalThis.addEventListener("load", () => {
          this.logPageLoad();
        });
      }

      // Capture unhandled errors
      globalThis.addEventListener("error", (event) => {
        const error = (() => {
          if (event.error instanceof Error) {
            return event.error;
          }
          return event.message;
        })();
        this.logError("window", "unhandled_error", error);
      });

      globalThis.addEventListener("unhandledrejection", (event) => {
        const error = (() => {
          if (event.reason instanceof Error) {
            return event.reason;
          }
          return String(event.reason);
        })();
        this.logError("promise", "unhandled_rejection", error);
      });
    }
  }

  private generateEventId(): string {
    this.eventCounter += 1;
    return `fe_evt_${this.sessionId}_${this.eventCounter.toString().padStart(6, "0")}`;
  }

  private logPageLoad(): void {
    if (globalThis.window === undefined) {
      return;
    }

    const navigationEntry = globalThis.performance.getEntriesByType?.("navigation")?.find((entry) =>
      isNavigationTimingEntry(entry),
    );
    if (navigationEntry === undefined) {
      return;
    }

    const domReady = Math.round(navigationEntry.domContentLoadedEventEnd),
      loadTime = Math.round(navigationEntry.loadEventEnd);
    this.logEvent("page_load", "page", "load", {
      details: {
        domComplete: Math.round(navigationEntry.domComplete),
        domReady,
        resourceLoadTime: Math.max(0, loadTime - domReady),
        ttfb: Math.round(navigationEntry.responseStart),
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
    options: Readonly<LogEventOptions> = {},
  ): PerformanceEvent {
    const event: PerformanceEvent = {
      ...getEventErrorFields(options.error),
      ...getSlowEventFields(options.durationMs),
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

    recordComponentTiming(this.componentTimings, component, options.durationMs);
    this.events.push(event);
    if (this.events.length > MAX_EVENTS) {
      this.events.shift();
    }
    logDevelopmentEvent(event);
    return event;
  }

  logError(component: string, operation: string, error: Error | string): PerformanceEvent {
    const message = (() => {
  if (error instanceof Error) {
    return error.message;
  }
  return error;
})();
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

  logStreamEvent(streamId: string, eventName: string, options: Readonly<StreamEventOptions> = {}): void {
    const metrics = this.activeStreams.get(streamId);
    if (!metrics) {
      return;
    }

    const now = Date.now();
    const updatedMetrics = updateStreamMetrics(metrics, eventName, options, now);
    this.activeStreams.set(streamId, updatedMetrics);

    const eventType: EventType = (() => {
  if (options.isError === true) {
    return "stream_error";
  }
  return "stream_event";
})();

    this.logEvent(eventType, "stream", eventName, {
      details: {
        ...streamEventDetails(updatedMetrics, options, now),
      },
      streamId,
    });
  }

  endStream(
    streamId: string,
    reason: "complete" | "error" | "timeout" | "cancelled" = "complete",
  ): StreamMetrics | undefined {
    const metrics = this.activeStreams.get(streamId);
    if (!metrics) {
      return void 0;
    }

    const now = Date.now();
    metrics.endTime = now;
    metrics.totalDurationMs = now - metrics.startTime;

    this.activeStreams.delete(streamId);

    const eventType: EventType =
      (() => {
  if (reason === "error") {
    return "stream_error";
  }
  return (() => {
    if (reason === "timeout") {
      return "stream_timeout";
    }
    return "stream_end";
  })();
})();

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

  async trackApiRequest<Result>(
    operation: string,
    url: string,
    requestFn: () => Promise<Result>,
  ): Promise<Result> {
    const startTime = Date.now();
    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.logEvent("api_request_start", "api", operation, {
      details: { url },
      requestId,
    });

    try {
      const result = await requestFn();
      this.logEvent("api_request_end", "api", operation, {
        details: { success: true, url },
        durationMs: Date.now() - startTime,
        requestId,
      });
      return result;
    } catch (error) {
      this.logEvent("api_request_error", "api", operation, {
        details: { success: false, url },
        durationMs: Date.now() - startTime,
        error: (() => {
          if (error instanceof Error) {
            return error;
          }
          return new Error(String(error));
        })(),
        requestId,
      });
      throw error;
    }
  }

  // --- Render Tracking ---

  trackRender<Result>(componentName: string, renderFn: () => Result): Result {
    const startTime = Date.now();

    this.logEvent("render_start", "render", componentName, {});

    try {
      const result = renderFn();
      const durationMs = Date.now() - startTime;
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
        error: (() => {
  if (error instanceof Error) {
    return error;
  }
  return String(error);
})(),
      });
      throw error;
    }
  }

  // --- User Action Tracking ---

  logUserAction(action: string, details?: ApiOpaqueObject): void {
    this.logEvent("user_action", "user", action, {
      details,
      message: `User action: ${action}`,
    });
  }

  // --- Summary and Export ---

  getSummary(): PerformanceSummary {
    const componentStats: PerformanceSummary["componentStats"] = {};

    for (const [component, timings] of this.componentTimings.entries()) {
      if (timings.length > 0) {
        const averageDuration = timings.reduce((total, duration) => total + duration, 0) / timings.length;
        const max = Math.max(...timings);
        const errors = this.events.filter(
          (event) =>
            event.component === component &&
            event.error !== undefined &&
            event.error !== "",
        ).length;

        componentStats[component] = {
          avgDurationMs: Math.round(averageDuration),
          count: timings.length,
          errorCount: errors,
          maxDurationMs: max,
        };
      }
    }

    return {
      componentStats,
      errorCount: this.events.filter(
        (event) => event.error !== undefined && event.error !== "",
      ).length,
      sessionId: this.sessionId,
      slowOperationsCount: this.events.filter((event) => event.isSlow === true).length,
      startTime: this.events[0]?.timestamp ?? new Date().toISOString(),
      streamMetrics: [...this.activeStreams.values()],
      totalEvents: this.events.length,
    };
  }

  getRecentEvents(limit = 50): PerformanceEvent[] {
    return this.events.slice(-limit);
  }

  getSlowOperations(): PerformanceEvent[] {
    return this.events.filter((event) => event.isSlow === true);
  }

  getErrors(): PerformanceEvent[] {
    return this.events.filter(
      (event) => event.error !== undefined && event.error !== "",
    );
  }

  getStreamMetrics(streamId: string): StreamMetrics | undefined {
    return this.activeStreams.get(streamId);
  }

  // Export all data for debugging
  exportDebugData() {
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
      return void 0;
    }
    const recentEvents = this.getUnflushedEvents();
    if (recentEvents.length === 0) {
      return void 0;
    }
    return recentEvents;
  }

  private getUnflushedEvents(): PerformanceEvent[] {
    const startIndex = Math.min(this.lastFlushedEventIndex, this.events.length);
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
const perfLogger = new FrontendPerformanceLogger();

// Convenience functions
const startStream = perfLogger.startStream.bind(perfLogger);
const logStreamEvent = perfLogger.logStreamEvent.bind(perfLogger);
const endStream = perfLogger.endStream.bind(perfLogger);
const logUserAction = perfLogger.logUserAction.bind(perfLogger);
const exportDebugData = perfLogger.exportDebugData.bind(perfLogger);

declare global {
  interface Window {
    perfLogger?: FrontendPerformanceLogger;
    exportDebugData?: typeof exportDebugData;
  }
}

// Make available globally for debugging in console
if (globalThis.window !== undefined) {
  globalThis.window.perfLogger = perfLogger;
  globalThis.window.exportDebugData = exportDebugData;
}
export { perfLogger, startStream, logStreamEvent, endStream, logUserAction, exportDebugData };
