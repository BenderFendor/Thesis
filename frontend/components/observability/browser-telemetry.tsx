"use client"

import { useEffect } from "react"
import { API_BASE_URL } from "@/lib/api"

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

const FLUSH_INTERVAL_MS = 5_000
const MAX_BUFFERED_EVENTS = 50
const SLOW_TASK_MS = 200

function getSessionId(): string {
  const key = "thesis_observability_session"
  const existing = window.sessionStorage.getItem(key)
  if (existing) return existing

  const value = `browser_${crypto.randomUUID()}`
  window.sessionStorage.setItem(key, value)
  return value
}

function errorDetails(value: unknown): Pick<BrowserEvidence, "message" | "stack"> {
  if (value instanceof Error) {
    return { message: value.message, stack: value.stack }
  }
  if (typeof value === "string") {
    return { message: value }
  }
  try {
    return { message: JSON.stringify(value) }
  } catch {
    return { message: String(value) }
  }
}

export function BrowserTelemetry() {
  useEffect(() => {
    const sessionId = getSessionId()
    let events: BrowserEvidence[] = []
    let flushing = false

    const enqueue = (event: BrowserEvidence) => {
      events.push(event)
      if (events.length > MAX_BUFFERED_EVENTS) {
        events = events.slice(-MAX_BUFFERED_EVENTS)
      }
    }

    const flush = async (preferBeacon = false) => {
      if (flushing || events.length === 0) return
      flushing = true
      const batch = events
      events = []

      const errors = batch.filter((event) =>
        ["window_error", "unhandled_rejection", "resource_error"].includes(event.type),
      )
      const slowOperations = batch.filter((event) => event.type === "long_task")
      const payload = {
        session_id: sessionId,
        summary: {
          event_count: batch.length,
          error_count: errors.length,
          slow_operation_count: slowOperations.length,
        },
        recent_events: batch,
        slow_operations: slowOperations,
        errors,
        dom_stats: {
          element_count: document.getElementsByTagName("*").length,
          body_child_count: document.body?.children.length ?? 0,
        },
        location: window.location.pathname,
        user_agent: navigator.userAgent,
        generated_at: new Date().toISOString(),
      }
      const body = JSON.stringify(payload)
      const endpoint = `${API_BASE_URL}/debug/logs/frontend`

      try {
        if (
          preferBeacon &&
          navigator.sendBeacon(
            endpoint,
            new Blob([body], { type: "application/json" }),
          )
        ) {
          return
        }
        await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          keepalive: true,
        })
      } catch {
        // Debug telemetry must never create a user-visible failure loop.
      } finally {
        flushing = false
      }
    }

    const onError = (event: ErrorEvent) => {
      const details = errorDetails(event.error ?? event.message)
      enqueue({
        timestamp: new Date().toISOString(),
        type: "window_error",
        message: details.message,
        stack: details.stack,
        source: event.filename || undefined,
        line: event.lineno || undefined,
        column: event.colno || undefined,
      })
    }

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const details = errorDetails(event.reason)
      enqueue({
        timestamp: new Date().toISOString(),
        type: "unhandled_rejection",
        message: details.message,
        stack: details.stack,
      })
    }

    const onResourceError = (event: Event) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      const source =
        target.getAttribute("src") ??
        target.getAttribute("href") ??
        target.tagName.toLowerCase()
      enqueue({
        timestamp: new Date().toISOString(),
        type: "resource_error",
        message: `Failed to load ${target.tagName.toLowerCase()}`,
        source: source.split("?")[0],
      })
    }

    window.addEventListener("error", onError)
    window.addEventListener("unhandledrejection", onUnhandledRejection)
    window.addEventListener("error", onResourceError, true)

    let observer: PerformanceObserver | null = null
    if ("PerformanceObserver" in window) {
      try {
        observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.duration < SLOW_TASK_MS) continue
            enqueue({
              timestamp: new Date().toISOString(),
              type: "long_task",
              message: entry.name || "Browser main-thread long task",
              durationMs: Math.round(entry.duration * 10) / 10,
            })
          }
        })
        observer.observe({ type: "longtask", buffered: true })
      } catch {
        observer = null
      }
    }

    const navigation = performance.getEntriesByType("navigation")[0]
    if (navigation instanceof PerformanceNavigationTiming) {
      enqueue({
        timestamp: new Date().toISOString(),
        type: "navigation_timing",
        message: window.location.pathname,
        durationMs: Math.round(navigation.duration * 10) / 10,
      })
    }

    const interval = window.setInterval(() => void flush(), FLUSH_INTERVAL_MS)
    const onPageHide = () => void flush(true)
    window.addEventListener("pagehide", onPageHide)

    return () => {
      window.clearInterval(interval)
      window.removeEventListener("error", onError)
      window.removeEventListener("unhandledrejection", onUnhandledRejection)
      window.removeEventListener("error", onResourceError, true)
      window.removeEventListener("pagehide", onPageHide)
      observer?.disconnect()
      void flush(true)
    }
  }, [])

  return null
}
