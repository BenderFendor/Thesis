"use client"

import { API_BASE_URL } from "@/lib/api"
import { useEffect } from "react"

interface BrowserEvidence {
  readonly timestamp: string
  readonly type: string
  readonly message: string
  readonly durationMs?: number
  readonly source?: string
  readonly line?: number
  readonly column?: number
  readonly stack?: string
}

interface BrowserErrorEvent {
  readonly colno: number
  readonly error: unknown
  readonly filename: string
  readonly lineno: number
  readonly message: string
}

interface BrowserResourceEvent {
  readonly target: Readonly<EventTarget> | null
}

interface BrowserUnhandledRejectionEvent {
  readonly reason: unknown
}

interface ResourceSource {
  readonly source: string
  readonly tagName: string
}

interface TelemetryPayload {
  dom_stats: { body_child_count: number; element_count: number }
  errors: BrowserEvidence[]
  generated_at: string
  location: string
  recent_events: readonly BrowserEvidence[]
  session_id: string
  slow_operations: BrowserEvidence[]
  summary: { error_count: number; event_count: number; slow_operation_count: number }
  user_agent: string
}

const BrowserTelemetry = (): undefined => {
  useEffect(setupBrowserTelemetry, [])
  return undefined
},
  DECIMAL_TENTHS = 10,
  ERROR_EVENT_TYPES = new Set(["resource_error", "unhandled_rejection", "window_error"]),
  FLUSH_INTERVAL_MS = 5000,
  MAX_BUFFERED_EVENTS = 50,
  SESSION_STORAGE_KEY = "thesis_observability_session",
  SLOW_TASK_MS = 200,
  ZERO = 0,
  buildPayload = (
    batch: readonly Readonly<BrowserEvidence>[],
    sessionId: string,
  ): TelemetryPayload => {
    const errors = batch.filter((event) => ERROR_EVENT_TYPES.has(event.type)),
      slowOperations = batch.filter((event) => event.type === "long_task")
    return {
      dom_stats: {
        body_child_count: globalThis.document.body.children.length,
        element_count: globalThis.document.querySelectorAll("*").length,
      },
      errors,
      generated_at: new Date().toISOString(),
      location: globalThis.location.pathname,
      recent_events: batch,
      session_id: sessionId,
      slow_operations: slowOperations,
      summary: {
        error_count: errors.length,
        event_count: batch.length,
        slow_operation_count: slowOperations.length,
      },
      user_agent: globalThis.navigator.userAgent,
    }
  },
  collectBrowserTimings = (
    enqueue: (event: Readonly<BrowserEvidence>) => void,
  ): (() => void) => {
    let observer: PerformanceObserver | undefined = undefined
    if ("PerformanceObserver" in globalThis) {
      try {
        observer = new PerformanceObserver((list: Readonly<PerformanceObserverEntryList>) => {
          for (const entry of list.getEntries()) {
            if (entry.duration >= SLOW_TASK_MS) {
              enqueue({
                durationMs: Math.round(entry.duration * DECIMAL_TENTHS) / DECIMAL_TENTHS,
                message: entry.name || "Browser main-thread long task",
                timestamp: new Date().toISOString(),
                type: "long_task",
              })
            }
          }
        })
        observer.observe({ buffered: true, type: "longtask" })
      } catch {
        observer = undefined
      }
    }

    const [navigationEntry] = globalThis.performance.getEntriesByType("navigation")
    if (navigationEntry instanceof PerformanceNavigationTiming) {
      enqueue({
        durationMs: Math.round(navigationEntry.duration * DECIMAL_TENTHS) / DECIMAL_TENTHS,
        message: globalThis.location.pathname,
        timestamp: new Date().toISOString(),
        type: "navigation_timing",
      })
    }

    return () => {
      observer?.disconnect()
    }
  },
  createResourceErrorHandler = (
    enqueue: (event: Readonly<BrowserEvidence>) => void,
  ): ((event: BrowserResourceEvent) => void) =>
    (event) => {
      const resource = getResourceSource(event.target)
      if (resource === undefined) {
        return
      }
      enqueue({
        message: `Failed to load ${resource.tagName}`,
        source: resource.source,
        timestamp: new Date().toISOString(),
        type: "resource_error",
      })
    },
  createSessionToken = (sessionStorageKey: string): string => {
    const sessionToken = `browser_${globalThis.crypto.randomUUID()}`
    globalThis.sessionStorage.setItem(sessionStorageKey, sessionToken)
    return sessionToken
  },
  createUnhandledRejectionHandler = (
    enqueue: (event: Readonly<BrowserEvidence>) => void,
  ): ((event: BrowserUnhandledRejectionEvent) => void) =>
    (event) => {
      let rejectionMessage = String(event.reason),
        rejectionStack = ""
      if (event.reason instanceof Error) {
        rejectionMessage = event.reason.message
        rejectionStack = event.reason.stack ?? ""
      }
      enqueue({
        message: rejectionMessage,
        stack: rejectionStack || undefined,
        timestamp: new Date().toISOString(),
        type: "unhandled_rejection",
      })
    },
  createWindowErrorHandler = (
    enqueue: (event: Readonly<BrowserEvidence>) => void,
  ): ((event: BrowserErrorEvent) => void) =>
    (event) => {
      let errorMessage = event.message,
        errorStack = ""
      if (event.error instanceof Error) {
        errorMessage = event.error.message
        errorStack = event.error.stack ?? ""
      }
      enqueue({
        column: event.colno || undefined,
        line: event.lineno || undefined,
        message: errorMessage,
        source: event.filename || undefined,
        stack: errorStack || undefined,
        timestamp: new Date().toISOString(),
        type: "window_error",
      })
    },
  getResourceSource = (
    target: Readonly<EventTarget> | null,
  ): ResourceSource | undefined => {
    if (!(target instanceof HTMLElement)) {
      return undefined
    }
    const tagName = target.tagName.toLowerCase()
    let source = (
      target.getAttribute("src") ??
      target.getAttribute("href") ??
      tagName
    ).split("?")[ZERO] ?? tagName
    if (source.length === ZERO) {
      source = tagName
    }
    return { source, tagName }
  },
  getSessionId = (): string => {
    const sessionStorageKey = SESSION_STORAGE_KEY,
      sessionValue = globalThis.sessionStorage.getItem(sessionStorageKey) ?? ""
    if (sessionValue.length > ZERO) {
      return sessionValue
    }

    return createSessionToken(sessionStorageKey)
  },
  noopCleanup = (): void => undefined,
  sendBatch = async (
    batch: readonly Readonly<BrowserEvidence>[],
    sessionId: string,
    preferBeacon: boolean,
  ): Promise<void> => {
    const body = JSON.stringify(buildPayload(batch, sessionId)),
      endpoint = `${API_BASE_URL}/debug/logs/frontend`
    try {
      if (
        preferBeacon &&
        globalThis.navigator.sendBeacon(
          endpoint,
          new Blob([body], { type: "application/json" }),
        )
      ) {
        return
      }
      await globalThis.fetch(endpoint, {
        body,
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        method: "POST",
      })
    } catch {
      // Debug telemetry must never create a user-visible failure loop.
    }
  },
  setupBrowserTelemetry = (): (() => void) => {
    let disconnectTimings = noopCleanup,
      flushing = false
    const bufferedEvents: BrowserEvidence[] = [],
      enqueue = (event: Readonly<BrowserEvidence>): void => {
        bufferedEvents.push(event)
        if (bufferedEvents.length > MAX_BUFFERED_EVENTS) {
          bufferedEvents.splice(ZERO, bufferedEvents.length - MAX_BUFFERED_EVENTS)
        }
      },
      flush = async (preferBeacon = false): Promise<void> => {
        if (flushing || bufferedEvents.length === ZERO) {
          return
        }
        flushing = true
        const batch = bufferedEvents.slice(ZERO, MAX_BUFFERED_EVENTS)
        bufferedEvents.splice(ZERO, batch.length)
        await sendBatch(batch, sessionId, preferBeacon)
        flushing = false
      },
      interval = globalThis.setInterval(() => {
        void flush()
      }, FLUSH_INTERVAL_MS),
      onError = createWindowErrorHandler(enqueue),
      onPageHide = (): void => {
        void flush(true)
      },
      onResourceError = createResourceErrorHandler(enqueue),
      onUnhandledRejection = createUnhandledRejectionHandler(enqueue),
      sessionId = getSessionId()

    globalThis.addEventListener("error", onError)
    globalThis.addEventListener("unhandledrejection", onUnhandledRejection)
    globalThis.addEventListener("error", onResourceError, true)
    disconnectTimings = collectBrowserTimings(enqueue)
    globalThis.addEventListener("pagehide", onPageHide)

    return () => {
      globalThis.clearInterval(interval)
      disconnectTimings()
      globalThis.removeEventListener("error", onError)
      globalThis.removeEventListener("unhandledrejection", onUnhandledRejection)
      globalThis.removeEventListener("error", onResourceError, true)
      globalThis.removeEventListener("pagehide", onPageHide)
      void flush(true)
    }
  };

export { BrowserTelemetry }
