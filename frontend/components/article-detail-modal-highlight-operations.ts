"use client";

import { toast } from "sonner";
import type { Highlight, HighlightRange, LocalHighlight } from "../lib/article-detail-modal-data";
import {
  HIGHLIGHT_STORE_VERSION,
  createHighlightFingerprint,
  highlightStableId,
  markPending,
  saveHighlightStore,
} from "../lib/article-detail-modal-data";

interface HighlightHistoryState {
  readonly nextHistory: LocalHighlight[][];
  readonly previousState: LocalHighlight[] | undefined;
}

const EMPTY_COUNT = 0;
const HIGHLIGHT_HISTORY_LIMIT = 20;

const appendHighlightHistory = (
  history: readonly (readonly LocalHighlight[])[],
  currentHighlights: readonly LocalHighlight[],
): LocalHighlight[][] =>
  [...history.map((entry) => [...entry]), [...currentHighlights]].slice(-HIGHLIGHT_HISTORY_LIMIT);

const buildPendingHighlight = ({
  articleUrl,
  clientId,
  color,
  highlightedText,
  range,
}: Readonly<{
  articleUrl: string;
  clientId: string;
  color: Highlight["color"];
  highlightedText: string;
  range: HighlightRange;
}>): LocalHighlight =>
  markPending({
    highlight: {
      article_url: articleUrl,
      character_end: range.end,
      character_start: range.start,
      client_id: clientId,
      color,
      highlighted_text: highlightedText,
      local_updated_at: new Date().toISOString(),
      pending_op: "create",
      sync_status: "pending",
    },
    op: "create",
  });

const deleteHighlightWithUndo = ({
  getNextHighlightOp: resolveNextHighlightOp,
  removed,
  updateHighlightByStableId,
  updateHighlightsWithHistory,
}: Readonly<{
  readonly getNextHighlightOp: (
    highlight: LocalHighlight,
    fallback: "update" | "delete",
  ) => "create" | "update" | "delete";
  readonly removed: LocalHighlight;
  readonly updateHighlightByStableId: (
    stableId: string,
    updater: (highlight: LocalHighlight) => LocalHighlight,
  ) => void;
  readonly updateHighlightsWithHistory: (
    updater: (previous: readonly Readonly<LocalHighlight>[]) => LocalHighlight[],
  ) => void;
}>): void => {
  try {
    updateHighlightByStableId(highlightStableId(removed), (item) =>
      markPending({
        highlight: item,
        op: resolveNextHighlightOp(item, "delete"),
      }),
    );

    toast("Annotation removed", {
      action: {
        label: "Undo",
        onClick: () => {
          updateHighlightsWithHistory((previous) =>
            restoreDeletedHighlight(previous, removed.client_id),
          );
        },
      },
    });
  } catch (error) {
    console.error("Failed to delete highlight", error);
    toast.error("Failed to delete annotation");
  }
};

const getHighlightPendingOperation = (highlight: LocalHighlight): "create" | "update" => {
  if (highlight.server_id !== undefined) {
    return "update";
  }
  return "create";
};

const getNextHighlightOp = (
  highlight: LocalHighlight,
  fallback: "update" | "delete",
): "create" | "update" | "delete" => {
  const fallbackOperations = {
      delete: "delete",
      update: "create",
    } satisfies Record<"update" | "delete", "create" | "delete">,
    highlightId = highlight.server_id ?? highlight.id;
  if (highlight.pending_op === "create") {
    return "create";
  }
  if (highlightId !== undefined && highlightId !== EMPTY_COUNT) {
    return fallback;
  }
  return fallbackOperations[fallback];
};

const getPreviousHighlightHistory = (
  history: readonly (readonly LocalHighlight[])[],
): HighlightHistoryState => {
  const nextHistory: LocalHighlight[][] = history.map((entry) => [...entry]),
    previousState = nextHistory.pop();
  return { nextHistory, previousState };
};

const hasDuplicateHighlight = (
  highlights: readonly LocalHighlight[],
  highlightedText: string,
  range: HighlightRange,
): boolean => {
  const fingerprint = createHighlightFingerprint({
    character_end: range.end,
    character_start: range.start,
    highlighted_text: highlightedText,
  });
  return highlights.some((highlight) => {
    if (highlight.deleted === true) {
      return false;
    }
    return (
      createHighlightFingerprint({
        character_end: highlight.character_end,
        character_start: highlight.character_start,
        highlighted_text: highlight.highlighted_text,
      }) === fingerprint
    );
  });
};

const persistHighlightChanges = (
  articleUrl: string | undefined,
  highlights: readonly LocalHighlight[],
  runHighlightOperations: (url: string, current: readonly LocalHighlight[]) => void,
): void => {
  if (articleUrl === undefined || articleUrl === "") {
    return;
  }
  saveHighlightStore({
    article_url: articleUrl,
    highlights: [...highlights],
    version: HIGHLIGHT_STORE_VERSION,
  });
  runHighlightOperations(articleUrl, highlights);
};

const restoreDeletedHighlight = (
  highlights: readonly LocalHighlight[],
  clientId: string,
): LocalHighlight[] =>
  highlights.map((highlight) => {
    if (highlight.client_id !== clientId) {
      return highlight;
    }
    return {
      ...highlight,
      deleted: false,
      last_error: undefined,
      local_updated_at: new Date().toISOString(),
      pending_op: undefined,
      sync_status: "pending",
    };
  });

const restoreHighlightState = (
  previousState: readonly LocalHighlight[],
  current: readonly LocalHighlight[],
): LocalHighlight[] => [
  ...previousState.map((previousHighlight) =>
    restorePreviousHighlight(
      previousHighlight,
      current.find((highlight) => highlight.client_id === previousHighlight.client_id),
    ),
  ),
  ...current
    .filter((currentHighlight) => shouldRestoreDeletedHighlight(previousState, currentHighlight))
    .map((currentHighlight) =>
      markPending({
        highlight: { ...currentHighlight, deleted: true },
        op: "delete",
      }),
    ),
];

const restorePreviousHighlight = (
  previousHighlight: LocalHighlight,
  currentEquivalent: LocalHighlight | undefined,
): LocalHighlight => {
  if (currentEquivalent === undefined && previousHighlight.deleted !== true) {
    return markPending({
      highlight: previousHighlight,
      op: getHighlightPendingOperation(previousHighlight),
    });
  }
  if (currentEquivalent?.deleted === true && previousHighlight.deleted !== true) {
    return markPending({
      highlight: { ...previousHighlight, deleted: false },
      op: getHighlightPendingOperation(previousHighlight),
    });
  }
  return previousHighlight;
};

const shouldRestoreDeletedHighlight = (
  previousState: readonly LocalHighlight[],
  currentHighlight: LocalHighlight,
): boolean =>
  !previousState.some((highlight) => highlight.client_id === currentHighlight.client_id) &&
  currentHighlight.deleted !== true;

const updateHighlightByClientId = (
  highlights: readonly LocalHighlight[],
  clientId: string,
  updater: (highlight: LocalHighlight) => LocalHighlight,
): LocalHighlight[] =>
  highlights.map((highlight) => {
    if (highlight.client_id !== clientId) {
      return highlight;
    }
    return updater(highlight);
  });

const updateHighlightByServerId = (
  highlights: readonly LocalHighlight[],
  highlightId: number,
  updater: (highlight: LocalHighlight) => LocalHighlight,
): LocalHighlight[] =>
  highlights.map((highlight) => {
    const id = highlight.server_id ?? highlight.id;
    if (id !== highlightId) {
      return highlight;
    }
    return updater(highlight);
  });

export {
  appendHighlightHistory,
  buildPendingHighlight,
  deleteHighlightWithUndo,
  getNextHighlightOp,
  getPreviousHighlightHistory,
  hasDuplicateHighlight,
  persistHighlightChanges,
  restoreHighlightState,
  updateHighlightByClientId,
  updateHighlightByServerId,
};
