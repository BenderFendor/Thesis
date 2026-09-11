"use client";
import { hasText } from "@/lib/utils";

import type { Dispatch, SetStateAction } from "react";
import { useEffect, useRef, useState } from "react";
import { requestInlineDefinition } from "../lib/api";
import type { DeepReadonly } from "@/lib/deep-readonly";

interface InlineDefinitionResult {
  readonly term: string;
  readonly definition?: string | null;
  readonly error?: string | null;
}

const HORIZONTAL_POSITION = "x";
const VERTICAL_POSITION = "y";
type AnchorPosition = Readonly<{
  [HORIZONTAL_POSITION]: number;
  [VERTICAL_POSITION]: number;
}>;

type ReadonlySelection = Readonly<Pick<Selection, "getRangeAt">>;
type InlineMouseEvent = Readonly<Pick<MouseEvent, "altKey" | "clientX" | "clientY">>;
type InlineKeyboardEvent = Readonly<Pick<KeyboardEvent, "key">>;

const getSelectionAnchorPosition = (
  selection: ReadonlySelection,
  event: InlineMouseEvent,
): AnchorPosition => {
  try {
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    return {
      [HORIZONTAL_POSITION]: rect.left + rect.width / 2 + globalThis.scrollX,
      [VERTICAL_POSITION]: rect.top + globalThis.scrollY,
    } satisfies AnchorPosition;
  } catch {
    return {
      [HORIZONTAL_POSITION]: event.clientX + globalThis.scrollX,
      [VERTICAL_POSITION]: event.clientY + globalThis.scrollY,
    } satisfies AnchorPosition;
  }
};

interface InlineDefinitionRequestState {
  readonly getAbortController: () => AbortController | null;
  readonly setAbortController: (controller: Readonly<AbortController> | null) => void;
  readonly getLastRequestAt: () => number;
  readonly setLastRequestAt: (value: number) => void;
  readonly getLastTerm: () => string | null;
  readonly setLastTerm: (value: string | null) => void;
  readonly setAnchorPosition: (position: AnchorPosition) => void;
  readonly setOpen: (open: boolean) => void;
  readonly setResult: Dispatch<SetStateAction<InlineDefinitionResult | null>>;
}

const selectedDefinitionTerm = (event: InlineMouseEvent): string | undefined => {
  if (!event.altKey) {
    return void 0;
  }
  const selection = globalThis.getSelection();
  if (!selection) {
    return void 0;
  }
  const text = selection.toString().trim();
  return text || undefined;
};

const buildInlineDefinitionResult = (
  term: string,
  response: DeepReadonly<Awaited<ReturnType<typeof requestInlineDefinition>>>,
): InlineDefinitionResult => {
  if (response.success) {
    return { definition: response.definition, term };
  }
  return { error: response.error, term };
};

const inlineDefinitionErrorMessage = (error: Error | string): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return error;
};

const isRecentInlineDefinitionRequest = (
  normalizedTerm: string,
  now: number,
  state: DeepReadonly<InlineDefinitionRequestState>,
): boolean => state.getLastTerm() === normalizedTerm && now - state.getLastRequestAt() < 4000;

const prepareInlineDefinitionRequest = (
  text: string,
  normalized: string,
  now: number,
  state: DeepReadonly<InlineDefinitionRequestState>,
): void => {
  state.setLastTerm(normalized);
  state.setLastRequestAt(now);
  state.getAbortController()?.abort();
  state.setAbortController(new AbortController());
  state.setResult({ definition: "Loading...", term: text });
  state.setOpen(true);
};

const setInlineDefinitionError = (
  state: DeepReadonly<InlineDefinitionRequestState>,
  error: Error | string,
): void => {
  const message = inlineDefinitionErrorMessage(error);
  state.setResult((result) => {
    if (result) {
      return { ...result, error: message };
    }
    return null;
  });
};

const loadInlineDefinition = async (
  text: string,
  state: DeepReadonly<InlineDefinitionRequestState>,
): Promise<void> => {
  try {
    const response = await requestInlineDefinition(text);
    state.setResult(buildInlineDefinitionResult(text, response));
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return;
    }
    console.error("Inline definition error:", error);
    if (error instanceof Error) {
      setInlineDefinitionError(state, error);
      return;
    }
    setInlineDefinitionError(state, String(error));
  }
};

const requestInlineDefinitionForTerm = async (
  text: string,
  event: InlineMouseEvent,
  state: DeepReadonly<InlineDefinitionRequestState>,
): Promise<void> => {
  const selection = globalThis.getSelection();
  if (!selection) {
    return;
  }
  state.setAnchorPosition(getSelectionAnchorPosition(selection, event));

  const normalized = text.toLowerCase(),
    now = Date.now();
  if (isRecentInlineDefinitionRequest(normalized, now, state)) {
    state.setOpen(true);
    return;
  }

  prepareInlineDefinitionRequest(text, normalized, now, state);
  await loadInlineDefinition(text, state);
};

function useInlineDefinition() {
  const [result, setResult] = useState<InlineDefinitionResult | null>(null);
  const [open, setOpen] = useState(false);
  const [anchorPosition, setAnchorPosition] = useState<AnchorPosition | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastTermRef = useRef<string | null>(null);
  const lastRequestAtRef = useRef<number>(0);

  useEffect(() => {
    // Avoid installing selection listeners in jsdom/unit tests where
    // Range.getBoundingClientRect may be missing. Detect jsdom via userAgent.
    if (globalThis.navigator?.userAgent.includes("jsdom")) {
      return () => {};
    }
    const onKey = (event: InlineKeyboardEvent) => {
        // Close on Escape
        if (event.key === "Escape") {
          setOpen(false);
        }
      },
      onMouseUp = (event: InlineMouseEvent) => {
        const text = selectedDefinitionTerm(event);
        if (!hasText(text)) {
          return;
        }
        void requestInlineDefinitionForTerm(text, event, {
          getAbortController: () => abortRef.current,
          getLastRequestAt: () => lastRequestAtRef.current,
          getLastTerm: () => lastTermRef.current,
          setAbortController: (controller) => {
            abortRef.current = controller;
          },
          setAnchorPosition,
          setLastRequestAt: (value) => {
            lastRequestAtRef.current = value;
          },
          setLastTerm: (value) => {
            lastTermRef.current = value;
          },
          setOpen,
          setResult,
        });
      };

    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("keydown", onKey);
    const abort = abortRef.current;
    return () => {
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("keydown", onKey);
      abort?.abort();
    };
  }, []);

  return { anchorPosition, open, result, setOpen };
}
export { useInlineDefinition };
