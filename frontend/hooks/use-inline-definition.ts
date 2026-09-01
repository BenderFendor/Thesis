"use client";

import { useEffect, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { requestInlineDefinition } from "../lib/api";

export interface InlineDefinitionResult {
  term: string;
  definition?: string | null;
  error?: string | null;
}

interface AnchorPosition {
  x: number;
  y: number;
}

function getSelectionAnchorPosition(selection: Selection, event: MouseEvent): AnchorPosition {
  try {
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2 + globalThis.scrollX,
      y: rect.top + globalThis.scrollY,
    };
  } catch {
    return {
      x: event.clientX + globalThis.scrollX,
      y: event.clientY + globalThis.scrollY,
    };
  }
}

interface InlineDefinitionRequestState {
  abortRef: MutableRefObject<AbortController | null>
  lastRequestAtRef: MutableRefObject<number>
  lastTermRef: MutableRefObject<string | null>
  setAnchorPosition: (position: AnchorPosition) => void
  setOpen: (open: boolean) => void
  setResult: Dispatch<SetStateAction<InlineDefinitionResult | null>>
}

function selectedDefinitionTerm(event: MouseEvent): string | undefined {
  if (!event.altKey) {return undefined;}
  const selection = globalThis.getSelection();
  if (!selection) {return undefined;}
  const text = selection.toString().trim();
  return text || undefined;
}

async function requestInlineDefinitionForTerm(
  text: string,
  event: MouseEvent,
  state: InlineDefinitionRequestState,
): Promise<void> {
  const selection = globalThis.getSelection();
  if (!selection) {return;}
  state.setAnchorPosition(getSelectionAnchorPosition(selection, event));

  const now = Date.now(),
   normalized = text.toLowerCase(),
   recentlyRequested =
    state.lastTermRef.current === normalized && now - state.lastRequestAtRef.current < 4000;
  if (recentlyRequested) {
    state.setOpen(true);
    return;
  }

  state.lastTermRef.current = normalized;
  state.lastRequestAtRef.current = now;
  state.abortRef.current?.abort();
  state.abortRef.current = new AbortController();
  state.setResult({ definition: "Loading...", term: text });
  state.setOpen(true);

  try {
    const response = await requestInlineDefinition(text);
    state.setResult(
      response.success
        ? { definition: response.definition, term: text }
        : { error: response.error, term: text },
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {return;}
    console.error("Inline definition error:", error);
    const message = error instanceof Error ? error.message : String(error);
    state.setResult((result) => (result ? { ...result, error: message } : null));
  }
}

export function useInlineDefinition() {
  const [result, setResult] = useState<InlineDefinitionResult | null>(null),
   [open, setOpen] = useState(false),
   [anchorPosition, setAnchorPosition] = useState<{ x: number; y: number } | null>(null),
   abortRef = useRef<AbortController | null>(null),
   lastTermRef = useRef<string | null>(null),
   lastRequestAtRef = useRef<number>(0);

  useEffect(() => {
    // Avoid installing selection listeners in jsdom/unit tests where
    // Range.getBoundingClientRect may be missing. Detect jsdom via userAgent.
    if (typeof navigator !== "undefined" && navigator.userAgent.includes("jsdom")) {
      return;
    }
    const onMouseUp = async (event: MouseEvent) => {
      const text = selectedDefinitionTerm(event);
      if (!text) {return;}
      await requestInlineDefinitionForTerm(text, event, {
        abortRef,
        lastRequestAtRef,
        lastTermRef,
        setAnchorPosition,
        setOpen,
        setResult,
      });
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
