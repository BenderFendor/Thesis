"use client"

import { API_BASE_URL } from "@/lib/api"
import { useEffect } from "react"

interface BrowserEvidence {
  timestamp: string
  type: string
  message: string
  durationMs?: number
  source?: string
  line?: number
  column?: number
  stack?: string
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
}const 

const DECIMAL_TENTHS = 10,
  ERROR_EVENT_TYPES = ["resource_error", "unhandled_rejection", "window_error"],
  FLUSH_INTERVAL_MS = 5000,
  MAX_BUFFERED_EVENTS = 50,
  SESSION_STORAGE_KEY = "thesis_observability_session",
  SLOW_TASK_MS = 200,
  ZERO = 0,
getSessionId = (): string => {
  const sessionStorageKey = SESSION_STORAGE_KEY,
    sessionValue = globalThis.sessionStorage.getItem(sessionStorageKey) ?? ""
  if (sessionValue.length > 0) {
    return sessionValue
  }

  const sessionToken = `browser_${crypto.randomUUID()}`
  globalThis.sessionStorage.setItem(sessionStorageKey, sessionToken)
  return sessionToken
},
buildPayload = (
  batch: readonly Readonly<BrowserEvidence>[],
  sessionId: string,
): TelemetryPayload => {
  const errors = batch.filter((event) => ERROR_EVENT_TYPES.includes(event.type)),
    slowOperations = batch.filter((event) => event.type === "long_task")
  return {
    dom_stats: {
      body_child_count: document.body.children.length,
      element_count: document.querySelectorAll("*").length,
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
    user_agent: navigator.userAgent,
  }
},
sendBatch = async (
  batch: readonly Readonly<BrowserEvidence>[],
  sessionId: string,
  preferBeacon: boolean,
): Promise<void> => {
  const payload = buildPayload(batch, sessionId),
    body = JSON.stringify(payload),
    endpoint = `${API_BASE_URL}/debug/logs/frontend`
  try {
    if (preferBeacon && navigator.sendBeacon(endpoint, new Blob([body], { type: "application/json" }))) {
      return
    }
    await fetch(endpoint, {
      body,
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      method: "POST",
    })
  } catch {
    // Debug telemetry must never create a user-visible failure loop.
  }
},
collectBrowserTimings = (enqueue: (event: Readonly<BrowserEvidence>) => void): (() => void) => {
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

  const [navigationEntry] = performance.getEntriesByType("navigation")
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
export const BrowserTelemetry = (): undefined => {
  useEffect(() => {
    const sessionId = getSessionId()
    let bufferedEvents: BrowserEvidence[] = [],
      flushing = false,
      enqueue = (event: Readonly<BrowserEvidence>): void => {
        bufferedEvents.push(event)
        if (bufferedEvents.length > MAX_BUFFERED_EVENTS) {
          bufferedEvents.splice(0, bufferedEvents.length - MAX_BUFFERED_EVENTS)
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
      onError = (event: Readonly<ErrorEvent>): void => {
        let errorMessage = event.message,
          errorStack: string | undefined = undefined
        if (event.error instanceof Error) {
          errorMessage = event.error.message
          errorStack = event.error.stack
        }
        enqueue({
          column: event.colno || undefined,
          line: event.lineno || undefined,
          message: errorMessage,
          source: event.filename || undefined,
          stack: errorStack,
          timestamp: new Date().toISOString(),
          type: "window_error",
        })
      },
      onUnhandledRejection = (event: Readonly<PromiseRejectionEvent>): void => {
        let rejectionMessage = String(event.reason),
          rejectionStack: string | undefined = undefined
        if (event.reason instanceof Error) {
          rejectionMessage = event.reason.message
          rejectionStack = event.reason.stack
        }
        enqueue({
          message: rejectionMessage,
          stack: rejectionStack,
          timestamp: new Date().toISOString(),
          type: "unhandled_rejection",
        })
      },
      onResourceError = (event: Readonly<Event>): void => {
        const { target } = event
        if (!(target instanceof HTMLElement)) {
          return
        }
        const tagName = target.tagName.toLowerCase(),
          [sourcePath] = (
            target.getAttribute("src") ??
            target.getAttribute("href") ??
            tagName
          ).split("?")
        let source = tagName
        if (sourcePath !== undefined && sourcePath.length > 0) {
          source = sourcePath
        }
        enqueue({
          message: `Failed to load ${tagName}`,
          source,
          timestamp: new Date().toISOString(),
          type: "resource_error",
        })
      }

    globalThis.addEventListener("error", onError)
    globalThis.addEventListener("unhandledrejection", onUnhandledRejection)
    globalThis.addEventListener("error", onResourceError, true)

    const disconnectTimings = collectBrowserTimings(enqueue),
      interval = globalThis.setInterval(() => {
        void flush()
      }, FLUSH_INTERVAL_MS),
      onPageHide = (): void => {
        void flush(true)
      }
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
  }, [])

  return undefined
};
