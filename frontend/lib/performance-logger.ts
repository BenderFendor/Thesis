/**
 * Frontend Performance Logger
 *
 * Captures timing, errors, and events from the frontend for debugging.
 * Designed to provide data that correlates with backend debug logs.
 */

import { sendFrontendDebugReport } from "./api";

// Configuration
const MAX_EVENTS = 500;
const FLUSH_INTERVAL_MS = 30000; // 30 seconds
const SLOW_THRESHOLD_MS = 3000; // 3 seconds
const ENABLE_AGENTIC_LOGGING =
  process.env.NEXT_PUBLIC_ENABLE_AGENTIC_LOGGING === "true" ||
  process.env.NODE_ENV === "development";
const IGNORED_ERROR_MESSAGES = [
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
  events: Array<{
    type: string;
    timestamp: number;
    articleCount?: number;
    source?: string;
  }>;
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

class FrontendPerformanceLogger {
  private events: PerformanceEvent[] = [];
  private eventCounter = 0;
  private sessionId: string;
  private activeStreams: Map<string, StreamMetrics> = new Map();
  private componentTimings: Map<string, number[]> = new Map();
  private flushInterval: NodeJS.Timeout | null = null;
  private lastFlushedEventIndex = 0;

  constructor() {
    this.sessionId = `fe_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Set up periodic flush
    if (typeof window !== "undefined") {
      this.flushInterval = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);

      // Log page load
      if (document.readyState === "complete") {
        this.logPageLoad();
      } else {
        window.addEventListener("load", () => this.logPageLoad());
      }

      // Capture unhandled errors
      window.addEventListener("error", (event) => {
        this.logError("window", "unhandled_error", event.error || event.message);
      });

      window.addEventListener("unhandledrejection", (event) => {
        this.logError("promise", "unhandled_rejection", event.reason);
      });
    }
  }

  private generateEventId(): string {
    this.eventCounter += 1;
    return `fe_evt_${this.sessionId}_${this.eventCounter.toString().padStart(6, "0")}`;
  }

  private logPageLoad(): void {
    if (typeof window === "undefined" || !window.performance) return;

    const timing = performance.timing;
    if (!timing) return;

    const navigationStart = timing.navigationStart ?? 0;
    const loadEventEnd = timing.loadEventEnd ?? 0;
    const domContentLoadedEventEnd = timing.domContentLoadedEventEnd ?? 0;
    const responseStart = timing.responseStart ?? 0;
    const domComplete = timing.domComplete ?? 0;

    if (!navigationStart || !loadEventEnd || loadEventEnd < navigationStart) return;

    const loadTime = loadEventEnd - navigationStart;
    const domReady = domContentLoadedEventEnd ? domContentLoadedEventEnd - navigationStart : null;
    const ttfb = responseStart ? responseStart - navigationStart : null;

    this.logEvent("page_load", "page", "load", {
      message: `Page loaded in ${loadTime}ms`,
      durationMs: loadTime,
      details: {
        domReady,
        ttfb,
        domComplete: domComplete ? domComplete - navigationStart : null,
        resourceLoadTime: domContentLoadedEventEnd ? loadEventEnd - domContentLoadedEventEnd : null,
        url: window.location.pathname,
      },
    });
  }

  logEvent(
    eventType: EventType,
    component: string,
    operation: string,
    options: {
      message?: string;
      durationMs?: number;
      details?: Record<string, unknown>;
      error?: Error | string;
      streamId?: string;
      requestId?: string;
    } = {}
  ): PerformanceEvent {
    const event: PerformanceEvent = {
      eventId: this.generateEventId(),
      eventType,
      timestamp: new Date().toISOString(),
      component,
      operation,
      message: options.message,
      durationMs: options.durationMs,
      details: options.details,
      streamId: options.streamId,
      requestId: options.requestId,
    };

    if (options.error) {
      if (options.error instanceof Error) {
        event.error = options.error.message;
        event.stackTrace = options.error.stack;
      } else {
        event.error = String(options.error);
      }
    }

    // Check for slow operations
    if (options.durationMs && options.durationMs > SLOW_THRESHOLD_MS) {
      event.isSlow = true;
    }

    // Track component timing
    if (options.durationMs) {
      const timings = this.componentTimings.get(component) || [];
      timings.push(options.durationMs);
      if (timings.length > 100) timings.shift();
      this.componentTimings.set(component, timings);
    }

    // Store event
    this.events.push(event);
    if (this.events.length > MAX_EVENTS) {
      this.events.shift();
    }

    // Log to console in development
    if (process.env.NODE_ENV === "development") {
      const logFn = event.error ? console.error : event.isSlow ? console.warn : console.debug;
      logFn(`[PerfLog] ${event.eventType} ${component}/${operation}`, {
        duration: event.durationMs ? `${event.durationMs}ms` : undefined,
        ...event.details,
        error: event.error,
      });
    }

    return event;
  }

  logError(component: string, operation: string, error: Error | string): PerformanceEvent {
    const message = error instanceof Error ? error.message : String(error);
    if (this.shouldIgnoreError(message)) {
      return this.logEvent("performance_warning", component, operation, {
        message: "Ignored noisy browser error",
        details: { error: message },
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
      streamId,
      startTime: Date.now(),
      eventCount: 0,
      articleCount: 0,
      sourceCount: 0,
      errorCount: 0,
      lastEventTime: Date.now(),
      events: [],
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
    options: {
      articleCount?: number;
      source?: string;
      isError?: boolean;
      details?: Record<string, unknown>;
    } = {}
  ): void {
    const metrics = this.activeStreams.get(streamId);
    if (!metrics) return;

    const now = Date.now();

    // Track time to first event
    if (!metrics.firstEventTime && eventName !== "start") {
      metrics.firstEventTime = now;
      metrics.timeToFirstEvent = now - metrics.startTime;
    }

    metrics.eventCount += 1;
    metrics.lastEventTime = now;

    if (options.articleCount) {
      metrics.articleCount += options.articleCount;
    }

    if (options.source) {
      metrics.sourceCount += 1;
    }

    if (options.isError) {
      metrics.errorCount += 1;
    }

    metrics.events.push({
      type: eventName,
      timestamp: now,
      articleCount: options.articleCount,
      source: options.source,
    });

    // Keep only last 50 events per stream
    if (metrics.events.length > 50) {
      metrics.events.shift();
    }

    const eventType: EventType = options.isError ? "stream_error" : "stream_event";

    this.logEvent(eventType, "stream", eventName, {
      streamId,
      details: {
        ...options.details,
        articleCount: options.articleCount,
        source: options.source,
        eventGapMs: metrics.events.length > 1 ? now - (metrics.events[metrics.events.length - 2]?.timestamp || now) : 0,
        totalArticles: metrics.articleCount,
        totalSources: metrics.sourceCount,
      },
    });
  }

  endStream(
    streamId: string,
    reason: "complete" | "error" | "timeout" | "cancelled" = "complete"
  ): StreamMetrics | undefined {
    const metrics = this.activeStreams.get(streamId);
    if (!metrics) return undefined;

    const now = Date.now();
    metrics.endTime = now;
    metrics.totalDurationMs = now - metrics.startTime;

    this.activeStreams.delete(streamId);

    const eventType: EventType =
      reason === "error" ? "stream_error" : reason === "timeout" ? "stream_timeout" : "stream_end";

    this.logEvent(eventType, "stream", "end", {
      message: `Stream ${streamId} ended: ${reason}`,
      streamId,
      durationMs: metrics.totalDurationMs,
      details: {
        reason,
        timeToFirstEvent: metrics.timeToFirstEvent,
        totalEvents: metrics.eventCount,
        totalArticles: metrics.articleCount,
        totalSources: metrics.sourceCount,
        errorCount: metrics.errorCount,
      },
    });

    return metrics;
  }

  // --- API Request Tracking ---

  trackApiRequest<T>(
    operation: string,
    url: string,
    requestFn: () => Promise<T>
  ): Promise<T> {
    const startTime = Date.now();
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

    this.logEvent("api_request_start", "api", operation, {
      requestId,
      details: { url },
    });

    return requestFn()
      .then((result) => {
        const durationMs = Date.now() - startTime;
        this.logEvent("api_request_end", "api", operation, {
          requestId,
          durationMs,
          details: { url, success: true },
        });
        return result;
      })
      .catch((error) => {
        const durationMs = Date.now() - startTime;
        this.logEvent("api_request_error", "api", operation, {
          requestId,
          durationMs,
          error,
          details: { url, success: false },
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
      const result = renderFn();
      const durationMs = Date.now() - startTime;
      this.logEvent("render_end", "render", componentName, {
        durationMs,
        details: { success: true },
      });
      return result;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      this.logEvent("render_end", "render", componentName, {
        durationMs,
        error: error as Error,
        details: { success: false },
      });
      throw error;
    }
  }

  // --- User Action Tracking ---

  logUserAction(action: string, details?: Record<string, unknown>): void {
    this.logEvent("user_action", "user", action, {
      message: `User action: ${action}`,
      details,
    });
  }

  // --- Summary and Export ---

  getSummary(): PerformanceSummary {
    const componentStats: PerformanceSummary["componentStats"] = {};

    for (const [component, timings] of this.componentTimings.entries()) {
      if (timings.length === 0) continue;
      const avg = timings.reduce((a, b) => a + b, 0) / timings.length;
      const max = Math.max(...timings);
      const errors = this.events.filter(
        (e) => e.component === component && e.error
      ).length;

      componentStats[component] = {
        count: timings.length,
        avgDurationMs: Math.round(avg),
        maxDurationMs: max,
        errorCount: errors,
      };
    }

    return {
      sessionId: this.sessionId,
      startTime: this.events[0]?.timestamp || new Date().toISOString(),
      totalEvents: this.events.length,
      slowOperationsCount: this.events.filter((e) => e.isSlow).length,
      errorCount: this.events.filter((e) => e.error).length,
      streamMetrics: Array.from(this.activeStreams.values()),
      componentStats,
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
      summary: this.getSummary(),
      recentEvents: this.getRecentEvents(100),
      slowOperations: this.getSlowOperations(),
      errors: this.getErrors(),
      activeStreams: Array.from(this.activeStreams.values()),
    };
  }

  // Flush events (could send to backend in the future)
  private flush(): void {
    if (process.env.NODE_ENV === "development" && this.events.length > 0) {
      console.debug(
        `[PerfLog] Session ${this.sessionId}: ${this.events.length} events captured`
      );
    }

    if (!ENABLE_AGENTIC_LOGGING || typeof window === "undefined") {
      return;
    }

    const startIndex = Math.min(
      this.lastFlushedEventIndex,
      this.events.length
    );
    const recentEvents = this.events.slice(startIndex);
    this.lastFlushedEventIndex = this.events.length;

    if (recentEvents.length === 0) {
      return;
    }

    const report = {
      session_id: this.sessionId,
      summary: this.getSummary(),
      recent_events: recentEvents,
      slow_operations: this.getSlowOperations(),
      errors: this.getErrors(),
      dom_stats: {
        node_count: document.querySelectorAll("*").length,
        body_text_length: document.body?.innerText?.length ?? 0,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
        },
        title: document.title,
      },
      location: window.location?.pathname,
      user_agent: navigator.userAgent,
      generated_at: new Date().toISOString(),
    };

    sendFrontendDebugReport(report);
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

// Make available globally for debugging in console
if (typeof window !== "undefined") {
  (window as any).perfLogger = perfLogger;
  (window as any).exportDebugData = exportDebugData;
}
