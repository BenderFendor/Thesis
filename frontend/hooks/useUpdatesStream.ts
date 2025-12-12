"use client";

import { useEffect, useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface UpdateEvent {
    id: number;
    type: string;
    timestamp: string;
    reason?: string;
    total_articles?: number;
    sources_processed?: number;
}

interface UseUpdatesStreamOptions {
    enabled?: boolean;
    onUpdate?: (event: UpdateEvent) => void;
}

/**
 * Hook that connects to the lightweight SSE updates stream.
 * 
 * This stream only sends "invalidate" signals when new content is available,
 * rather than streaming all article data. When an update is received,
 * it automatically invalidates React Query's news cache.
 */
export function useUpdatesStream(options: UseUpdatesStreamOptions = {}) {
    const { enabled = true, onUpdate } = options;
    const queryClient = useQueryClient();
    const eventSourceRef = useRef<EventSource | null>(null);
    const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    const connect = useCallback(() => {
        if (!enabled) return;

        // Close existing connection
        if (eventSourceRef.current) {
            eventSourceRef.current.close();
        }

        const eventSource = new EventSource(`${API_BASE}/api/updates/stream`);
        eventSourceRef.current = eventSource;

        eventSource.onmessage = (event) => {
            try {
                const data: UpdateEvent = JSON.parse(event.data);

                // Handle different event types
                if (data.type === "invalidate") {
                    // Invalidate all news queries to refetch with fresh data
                    queryClient.invalidateQueries({ queryKey: ["news"] });
                }

                // Call custom handler if provided
                onUpdate?.(data);
            } catch (error) {
                console.error("[UpdatesStream] Failed to parse event:", error);
            }
        };

        eventSource.onerror = (error) => {
            console.warn("[UpdatesStream] Connection error, will reconnect...", error);
            eventSource.close();
            eventSourceRef.current = null;

            // Reconnect after delay
            reconnectTimeoutRef.current = setTimeout(() => {
                connect();
            }, 5000);
        };

        eventSource.onopen = () => {
            console.info("[UpdatesStream] Connected to updates stream");
        };
    }, [enabled, queryClient, onUpdate]);

    // Connect on mount
    useEffect(() => {
        connect();

        return () => {
            if (eventSourceRef.current) {
                eventSourceRef.current.close();
                eventSourceRef.current = null;
            }
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
                reconnectTimeoutRef.current = null;
            }
        };
    }, [connect]);

    // Reconnect when enabled changes
    useEffect(() => {
        if (enabled) {
            connect();
        } else if (eventSourceRef.current) {
            eventSourceRef.current.close();
            eventSourceRef.current = null;
        }
    }, [enabled, connect]);

    return {
        isConnected: eventSourceRef.current?.readyState === EventSource.OPEN,
    };
}
