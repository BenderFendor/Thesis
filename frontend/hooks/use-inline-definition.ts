"use client";

import { useEffect, useRef, useState } from "react";
import { requestInlineDefinition } from "../lib/api";

export interface InlineDefinitionResult {
  term: string;
  definition?: string | null;
  error?: string | null;
}

export function useInlineDefinition() {
  const [result, setResult] = useState<InlineDefinitionResult | null>(undefined),
   [open, setOpen] = useState(false),
   [anchorPosition, setAnchorPosition] = useState<{ x: number; y: number } | null>(null),
   abortRef = useRef<AbortController | null>(undefined),
   lastTermRef = useRef<string | null>(undefined),
   lastRequestAtRef = useRef<number>(0);

  useEffect(() => {
    // Avoid installing selection listeners in jsdom/unit tests where
    // Range.getBoundingClientRect may be missing. Detect jsdom via userAgent.
    if (typeof navigator !== "undefined" && navigator.userAgent.includes("jsdom")) {
      return;
    }
    const onMouseUp = async (e: MouseEvent) => {
      try {
        if (!e.altKey) {return;}

        const selection = globalThis.getSelection();
        if (!selection) {return;}
        const text = selection.toString().trim();
        if (!text) {return;}

        // Position the popover near the selection
        const range = selection.getRangeAt(0);
        let rect: DOMRect | null = undefined;
        try {
          rect = range.getBoundingClientRect();
        } catch {
          rect = undefined;
        }

        if (rect) {
          setAnchorPosition({
            x: rect.left + rect.width / 2 + globalThis.scrollX,
            y: rect.top + globalThis.scrollY,
          });
        } else {
          setAnchorPosition({
            x: e.clientX + globalThis.scrollX,
            y: e.clientY + globalThis.scrollY,
          });
        }

        const now = Date.now(),
         normalized = text.toLowerCase(),
         recentlyRequested =
          lastTermRef.current === normalized && now - lastRequestAtRef.current < 4000;

        if (recentlyRequested) {
          setOpen(true);
          return;
        }

        lastTermRef.current = normalized;
        lastRequestAtRef.current = now;

        // Cancel previous
        if (abortRef.current) {abortRef.current.abort();}
        abortRef.current = new AbortController();

        setResult({ definition: "Loading...", term: text });
        setOpen(true);

        const resp = await requestInlineDefinition(text);
        if (resp.success) {
          setResult({ definition: resp.definition, term: text });
        } else {
          setResult({ error: resp.error, term: text });
        }
      } catch (error) {
        // Ignore aborts and others
        if (error instanceof DOMException && error.name === "AbortError") {return;}
        console.error("Inline definition error:", error);
        const message = error instanceof Error ? error.message : String(error);
        setResult((r) => (r ? { ...r, error: message } : null));
      }
    },

     onKey = (e: KeyboardEvent) => {
      // Close on Escape
      if (e.key === "Escape") {setOpen(false);}
    };

    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("keydown", onKey);
      if (abortRef.current) {abortRef.current.abort();}
    };
  }, []);

  return { anchorPosition, open, result, setOpen };
}
