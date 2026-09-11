"use client";

import { useCallback, useRef } from "react";
import { toast } from "sonner";
import type {
  CreateHighlightPayload,
  DeleteHighlightPayload,
  Highlight,
  HighlightAnchorElement,
  LocalHighlight,
  ModalHighlightActionsProps,
  ModalHighlightEditorActionsProps,
  ModalHighlightHistoryProps,
  UpdateHighlightPayload,
} from "../lib/article-detail-modal-data";
import {
  dedupeLocalHighlights,
  generateClientId,
  highlightStableId,
  markPending,
} from "../lib/article-detail-modal-data";
import { syncHighlights } from "./article-detail-modal-reader";
import {
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
} from "./article-detail-modal-highlight-operations";

const EMPTY_COUNT = 0;
const HIGHLIGHT_POPOVER_DELAY_MS = 10;

type HighlightSelectionActionProps = Readonly<{
  readonly highlights: ModalHighlightActionsProps["highlights"];
  readonly setActiveHighlightId: ModalHighlightActionsProps["setActiveHighlightId"];
  readonly setHighlightPopoverAnchorEl: ModalHighlightActionsProps["setHighlightPopoverAnchorEl"];
  readonly setHighlightPopoverHighlight: ModalHighlightActionsProps["setHighlightPopoverHighlight"];
  readonly setHighlightPopoverOpen: ModalHighlightActionsProps["setHighlightPopoverOpen"];
  readonly updateHighlightsWithHistory: ModalHighlightActionsProps["updateHighlightsWithHistory"];
}>;

const useModalHighlightSelectionActions = ({
  highlights,
  setActiveHighlightId,
  setHighlightPopoverAnchorEl,
  setHighlightPopoverHighlight,
  setHighlightPopoverOpen,
  updateHighlightsWithHistory,
}: HighlightSelectionActionProps) => {
  const updateHighlightByStableId = useCallback(
    (stableId: string, updater: (highlight: LocalHighlight) => LocalHighlight) => {
      updateHighlightsWithHistory((previous) =>
        updateHighlightByClientId(previous, stableId, updater),
      );
    },
    [updateHighlightsWithHistory],
  );
  const handleHighlightClick = useCallback(
    (stableId: string, element: HighlightAnchorElement) => {
      const found = highlights.find((item) => highlightStableId(item) === stableId);
      setActiveHighlightId(stableId);
      setHighlightPopoverHighlight(found);
      setHighlightPopoverAnchorEl(element);
      setHighlightPopoverOpen(true);
    },
    [
      highlights,
      setActiveHighlightId,
      setHighlightPopoverAnchorEl,
      setHighlightPopoverHighlight,
      setHighlightPopoverOpen,
    ],
  );
  const handleSaveHighlightNote = useCallback(
    (highlightId: string, note: string): Promise<void> => {
      updateHighlightByStableId(highlightId, (item) =>
        markPending({
          highlight: { ...item, note },
          op: getNextHighlightOp(item, "update"),
        }),
      );
      return Promise.resolve();
    },
    [updateHighlightByStableId],
  );

  return { handleHighlightClick, handleSaveHighlightNote, updateHighlightByStableId };
};

type HighlightCreationActionProps = Readonly<{
  readonly article: Readonly<ModalHighlightActionsProps["article"]>;
  readonly articleContentRef: ModalHighlightActionsProps["articleContentRef"];
  readonly highlights: ModalHighlightActionsProps["highlights"];
  readonly setHighlightColor: ModalHighlightActionsProps["setHighlightColor"];
  readonly setHighlightPopoverAnchorEl: ModalHighlightActionsProps["setHighlightPopoverAnchorEl"];
  readonly setHighlightPopoverHighlight: ModalHighlightActionsProps["setHighlightPopoverHighlight"];
  readonly setHighlightPopoverOpen: ModalHighlightActionsProps["setHighlightPopoverOpen"];
  readonly updateHighlightByStableId: ReturnType<
    typeof useModalHighlightSelectionActions
  >["updateHighlightByStableId"];
  readonly updateHighlightsWithHistory: ModalHighlightActionsProps["updateHighlightsWithHistory"];
}>;

type HighlightCreateActionProps = Omit<
  HighlightCreationActionProps,
  "setHighlightColor" | "updateHighlightByStableId"
>;
type HighlightCreationRef = ReturnType<typeof useRef<string | undefined>>;

const scheduleCreatedHighlightPopover = ({
  articleContentRef,
  clientId,
  nextLocal,
  setHighlightPopoverAnchorEl,
  setHighlightPopoverHighlight,
  setHighlightPopoverOpen,
}: Readonly<{
  readonly articleContentRef: ModalHighlightActionsProps["articleContentRef"];
  readonly clientId: string;
  readonly nextLocal: LocalHighlight;
  readonly setHighlightPopoverAnchorEl: ModalHighlightActionsProps["setHighlightPopoverAnchorEl"];
  readonly setHighlightPopoverHighlight: ModalHighlightActionsProps["setHighlightPopoverHighlight"];
  readonly setHighlightPopoverOpen: ModalHighlightActionsProps["setHighlightPopoverOpen"];
}>): void => {
  setTimeout(() => {
    const anchor = articleContentRef.current?.querySelector<HTMLElement>(
      ["mark[data-highlight-stable-id='client:", clientId, "']"].join(""),
    );
    setHighlightPopoverHighlight(nextLocal);
    setHighlightPopoverAnchorEl(anchor ?? undefined);
    setHighlightPopoverOpen(true);
  }, HIGHLIGHT_POPOVER_DELAY_MS);
};

const useModalHighlightCreateAction = ({
  article,
  articleContentRef,
  highlights,
  setHighlightPopoverAnchorEl,
  setHighlightPopoverHighlight,
  setHighlightPopoverOpen,
  updateHighlightsWithHistory,
}: HighlightCreateActionProps) => {
  const lastCreatedClientIdRef = useRef<string | undefined>(void 0);
  const handleToolbarCreate = useCallback(
    ({ highlightedText, color, range }: Readonly<CreateHighlightPayload>): void => {
      if (hasDuplicateHighlight(highlights, highlightedText, range)) {
        toast.error("That exact text is already highlighted");
        return;
      }

      const clientId = generateClientId();
      lastCreatedClientIdRef.current = clientId;
      const nextLocal = buildPendingHighlight({
        articleUrl: article.url,
        clientId,
        color,
        highlightedText,
        range,
      });
      updateHighlightsWithHistory((previous) => dedupeLocalHighlights([...previous, nextLocal]));
      scheduleCreatedHighlightPopover({
        articleContentRef,
        clientId,
        nextLocal,
        setHighlightPopoverAnchorEl,
        setHighlightPopoverHighlight,
        setHighlightPopoverOpen,
      });
    },
    [
      article.url,
      articleContentRef,
      highlights,
      setHighlightPopoverAnchorEl,
      setHighlightPopoverHighlight,
      setHighlightPopoverOpen,
      updateHighlightsWithHistory,
    ],
  );

  return { handleToolbarCreate, lastCreatedClientIdRef };
};

const useModalHighlightColorAction = ({
  lastCreatedClientIdRef,
  setHighlightColor,
  updateHighlightByStableId,
}: Readonly<{
  readonly lastCreatedClientIdRef: Readonly<HighlightCreationRef>;
  readonly setHighlightColor: ModalHighlightActionsProps["setHighlightColor"];
  readonly updateHighlightByStableId: HighlightCreationActionProps["updateHighlightByStableId"];
}>) => {
  const handleColorSelect = useCallback(
    (color: Highlight["color"]) => {
      setHighlightColor(color);
      const lastClientId = lastCreatedClientIdRef.current;
      if (lastClientId === undefined || lastClientId === "") {
        return;
      }
      updateHighlightByStableId(lastClientId, (item) =>
        markPending({
          highlight: { ...item, color },
          op: getNextHighlightOp(item, "update"),
        }),
      );
    },
    [lastCreatedClientIdRef, setHighlightColor, updateHighlightByStableId],
  );

  return { handleColorSelect };
};

const useModalHighlightCreationActions = (props: Readonly<HighlightCreationActionProps>) => {
  const creation = useModalHighlightCreateAction(props);
  const color = useModalHighlightColorAction({
    lastCreatedClientIdRef: creation.lastCreatedClientIdRef,
    setHighlightColor: props.setHighlightColor,
    updateHighlightByStableId: props.updateHighlightByStableId,
  });

  return { ...color, ...creation };
};

type HighlightMutationActionProps = Readonly<
  Pick<
    ModalHighlightActionsProps,
    "article" | "highlights" | "runHighlightOperations" | "setShowHighlights" | "updateHighlightsWithHistory"
  >
>;

const useModalHighlightMutationActions = ({
  article,
  highlights,
  runHighlightOperations,
  setShowHighlights,
  updateHighlightsWithHistory,
}: HighlightMutationActionProps) => {
  const handleToolbarUpdate = useCallback(
    ({ highlightId, note }: Readonly<UpdateHighlightPayload>): void => {
      updateHighlightsWithHistory((previous) =>
        updateHighlightByServerId(previous, highlightId, (item) =>
          markPending({ highlight: { ...item, note }, op: "update" }),
        ),
      );
    },
    [updateHighlightsWithHistory],
  );
  const handleToolbarDelete = useCallback(
    ({ highlightId }: Readonly<DeleteHighlightPayload>): void => {
      updateHighlightsWithHistory((previous) =>
        updateHighlightByServerId(previous, highlightId, (item) =>
          markPending({ highlight: item, op: "delete" }),
        ),
      );
    },
    [updateHighlightsWithHistory],
  );
  const handleRetrySync = useCallback(() => {
    runHighlightOperations(article.url, highlights);
  }, [article.url, highlights, runHighlightOperations]);
  const handleToggleShowHighlights = useCallback(() => {
    setShowHighlights((previous) => !previous);
  }, [setShowHighlights]);

  return { handleRetrySync, handleToggleShowHighlights, handleToolbarDelete, handleToolbarUpdate };
};

const useModalHighlightActions = (props: Readonly<ModalHighlightActionsProps>) => {
  const selectionActions = useModalHighlightSelectionActions(props);
  const creationActions = useModalHighlightCreationActions({
    ...props,
    updateHighlightByStableId: selectionActions.updateHighlightByStableId,
  });
  const mutationActions = useModalHighlightMutationActions(props);

  return { ...creationActions, ...mutationActions, ...selectionActions };
};

const useModalHighlightEditorActions = ({
  handleSaveHighlightNote,
  setSidebarEditingId,
  setSidebarEditingNote,
  updateHighlightByStableId,
  updateHighlightsWithHistory,
}: Readonly<ModalHighlightEditorActionsProps>) => {
  const handleCancelEdit = useCallback(() => {
      setSidebarEditingId(undefined);
      setSidebarEditingNote("");
    }, [setSidebarEditingId, setSidebarEditingNote]),
    handleHighlightDelete = useCallback(
      (removed: LocalHighlight) => {
        deleteHighlightWithUndo({
          getNextHighlightOp,
          removed,
          updateHighlightByStableId,
          updateHighlightsWithHistory,
        });
      },
      [updateHighlightByStableId, updateHighlightsWithHistory],
    ),
    handleSaveNote = useCallback(
      async (stableId: string, note: string): Promise<void> => {
        await handleSaveHighlightNote(stableId, note);
        setSidebarEditingId(undefined);
        setSidebarEditingNote("");
      },
      [handleSaveHighlightNote, setSidebarEditingId, setSidebarEditingNote],
    ),
    handleStartEdit = useCallback(
      (highlight: LocalHighlight) => {
        setSidebarEditingId(highlightStableId(highlight));
        setSidebarEditingNote(highlight.note ?? "");
      },
      [setSidebarEditingId, setSidebarEditingNote],
    );

  return { handleCancelEdit, handleHighlightDelete, handleSaveNote, handleStartEdit };
};

const useModalHighlightRunner = ({
  services,
  setHighlightSyncStatus,
  setHighlights,
}: Readonly<
  Pick<ModalHighlightHistoryProps, "services" | "setHighlightSyncStatus" | "setHighlights">
>) => {
  const latestHighlightSyncRef = useRef(EMPTY_COUNT);
  const setReadonlyHighlights = useCallback(
    (next: readonly Readonly<LocalHighlight>[]): void => {
      setHighlights([...next]);
    },
    [setHighlights],
  );
  const runHighlightOperations = useCallback(
    (articleUrl: string, current: readonly LocalHighlight[]) => {
      void syncHighlights(articleUrl, current, {
        latestSyncToken: latestHighlightSyncRef,
        services,
        setHighlights: setReadonlyHighlights,
        setLatestSyncToken: (syncToken) => {
          latestHighlightSyncRef.current = syncToken;
        },
        setStatus: setHighlightSyncStatus,
      });
    },
    [services, setHighlightSyncStatus, setReadonlyHighlights],
  );

  return { runHighlightOperations };
};

const useModalHighlightHistory = ({
  article,
  services,
  setHighlightSyncStatus,
  setHighlights,
  setHighlightsHistory,
}: Readonly<ModalHighlightHistoryProps>) => {
  const { runHighlightOperations } = useModalHighlightRunner({
    services,
    setHighlightSyncStatus,
    setHighlights,
  });
  const pushToHistory = useCallback(
    (currentHighlights: readonly LocalHighlight[]) => {
      setHighlightsHistory((previous) => appendHighlightHistory(previous, currentHighlights));
    },
    [setHighlightsHistory],
  );
  const handleUndo = useCallback(() => {
    setHighlightsHistory((previous) => {
      const { nextHistory, previousState } = getPreviousHighlightHistory(previous);
      if (!previousState || !article.url) {
        return nextHistory;
      }

      setHighlights((current) => {
        const nextState = restoreHighlightState(previousState, current);
        persistHighlightChanges(article.url, nextState, runHighlightOperations);
        return nextState;
      });
      return nextHistory;
    });
  }, [article.url, runHighlightOperations, setHighlights, setHighlightsHistory]);
  const updateHighlightsWithHistory = useCallback(
    (updater: (previous: readonly Readonly<LocalHighlight>[]) => LocalHighlight[]) => {
      setHighlights((previous) => {
        pushToHistory(previous);
        const next = updater(previous);
        persistHighlightChanges(article.url, next, runHighlightOperations);
        return next;
      });
    },
    [article.url, pushToHistory, runHighlightOperations, setHighlights],
  );

  return { handleUndo, runHighlightOperations, updateHighlightsWithHistory };
};


export {
  useModalHighlightActions,
  useModalHighlightEditorActions,
  useModalHighlightHistory,
};
