"use client";

import { useEffect, useRef, useState } from "react";
import { requestInlineDefinition } from "../lib/api";

export interface InlineDefinitionResult {
  term: string;
  definition?: string | null;
  error?: string | null;
}

export function useInlineDefinition() {
  const [result, setResult] = useState<InlineDefinitionResult | null>(null);
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<{ x: number; y: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastTermRef = useRef<string | null>(null);
  const lastRequestAtRef = useRef<number>(0);

  useEffect(() => {
    // Avoid installing selection listeners in jsdom/unit tests where
    // Range.getBoundingClientRect may be missing. Detect jsdom via userAgent.
    if (typeof navigator !== "undefined" && navigator.userAgent.includes("jsdom")) {
      return;
    }
    const onMouseUp = async (e: MouseEvent) => {
      try {
        if (!e.altKey) return;

        const selection = window.getSelection();
        if (!selection) return;
        const text = selection.toString().trim();
        if (!text) return;

        // Position the popover near the selection
        const range = selection.getRangeAt(0);
        let rect: DOMRect | null = null;
        try {
          rect = (range as any).getBoundingClientRect?.() ?? null;
        } catch (err) {
          rect = null;
        }

        if (rect) {
          anchorRef.current = { x: rect.left + rect.width / 2 + window.scrollX, y: rect.top + window.scrollY };
        } else {
          // Fallback to mouse coordinates if range rect is unavailable
          anchorRef.current = { x: e.clientX + window.scrollX, y: e.clientY + window.scrollY };
        }

        const now = Date.now();
        const normalized = text.toLowerCase();
        const recentlyRequested =
          lastTermRef.current === normalized && now - lastRequestAtRef.current < 4000;

        if (recentlyRequested) {
          setOpen(true);
          return;
        }

        lastTermRef.current = normalized;
        lastRequestAtRef.current = now;

        // Cancel previous
        if (abortRef.current) abortRef.current.abort();
        abortRef.current = new AbortController();

        setResult({ term: text, definition: "Loading..." });
        setOpen(true);

        const resp = await requestInlineDefinition(text);
        if (resp.success) {
          setResult({ term: text, definition: resp.definition });
        } else {
          setResult({ term: text, error: resp.error });
        }
      } catch (err) {
        // ignore aborts and others
        if ((err as any)?.name === "AbortError") return;
        console.error("Inline definition error:", err);
        setResult((r) => (r ? { ...r, error: (err as any)?.message ?? String(err) } : null));
      }
    };

    const onKey = (e: KeyboardEvent) => {
      // Close on Escape
      if (e.key === "Escape") setOpen(false);
    };

    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("keydown", onKey);
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  return { result, open, setOpen, anchorRef };
}

