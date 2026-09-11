"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { LiveNewsPreferences } from "@/hooks/use-live-news-preferences";
import type { DeepReadonly } from "@/lib/deep-readonly";
import { getDefaultSources } from "@/lib/live-news-sources";
import type { LiveNewsSource } from "@/lib/live-news-sources";
import type { NewsArticle } from "@/lib/api";
import { LiveNewsSourcePicker } from "./live-news-source-picker";
import { LiveNewsToolbar } from "./live-news-toolbar";
import { StreamCard } from "./stream-card";
import { useLiveNewsPreferences } from "@/hooks/use-live-news-preferences";

interface LiveNewsViewProps {
  readonly articles: readonly NewsArticle[];
  readonly loading: boolean;
}

const MAX_LOADED_IFRAMES = 3,
  MIN_DESKTOP_WIDTH = 1024;

type LiveNewsLayout = LiveNewsPreferences["layout"];
type LiveNewsPreferencesUpdater = (
  patch: DeepReadonly<Partial<LiveNewsPreferences>>,
) => void;
type ReadonlyLoadedSources = ReadonlySet<string>;
type EscapeKeyEvent = Readonly<Pick<KeyboardEvent, "key">>;

const getLiveNewsGridStyle = (gridTemplateColumns: string) => ({
  alignContent: "start" as const,
  display: "grid" as const,
  gap: "0.75rem",
  gridTemplateColumns,
});

const gridTemplateFor = (layout: LiveNewsLayout, sourceCount: number): string => {
  if (layout === "2x2") {
    return "repeat(2, 1fr)";
  }
  if (layout === "3x3") {
    return "repeat(3, 1fr)";
  }
  if (sourceCount <= 4) {
    return "repeat(2, 1fr)";
  }
  return "repeat(3, 1fr)";
};

const getLoadedSourcesAfterVisible = (
  previous: ReadonlyLoadedSources,
  sourceId: string,
): ReadonlyLoadedSources => {
  const next = new Set([...previous, sourceId]);
  if (next.size <= MAX_LOADED_IFRAMES) {
    return next;
  }
  return new Set([...next].slice(-MAX_LOADED_IFRAMES));
};

const useLiveNewsVisibilityHandlers = (
  setLoadedSources: React.Dispatch<React.SetStateAction<ReadonlyLoadedSources>>,
) => {
  const handleBecameHidden = useCallback(
    (sourceId: string) => {
      setLoadedSources((previous) => {
        const next = new Set(previous);
        next.delete(sourceId);
        return next;
      });
    },
    [setLoadedSources],
  );
  const handleBecameVisible = useCallback(
    (sourceId: string) => {
      setLoadedSources((previous) => getLoadedSourcesAfterVisible(previous, sourceId));
    },
    [setLoadedSources],
  );

  return { handleBecameHidden, handleBecameVisible };
};

const getNextFullscreenId = (currentId: string | null, sourceId: string): string | null => {
  if (currentId === sourceId) {
    return null;
  }
  return sourceId;
};

const getNextActiveSourceIds = (
  activeSourceIds: readonly string[],
  sourceId: string,
): string[] => {
  if (activeSourceIds.includes(sourceId)) {
    return activeSourceIds.filter((activeSourceId) => activeSourceId !== sourceId);
  }
  return [...activeSourceIds, sourceId];
};

type LiveNewsSourceHandlersProps = Readonly<{
  readonly fullscreenId: string | null;
  readonly prefs: DeepReadonly<LiveNewsPreferences>;
  readonly setFullscreenId: React.Dispatch<React.SetStateAction<string | null>>;
  readonly updatePrefs: LiveNewsPreferencesUpdater;
}>;

const useLiveNewsSourceHandlers = ({
  fullscreenId,
  prefs,
  setFullscreenId,
  updatePrefs,
}: LiveNewsSourceHandlersProps) => {
  const handleCloseSource = useCallback(
    (sourceId: string) => {
      updatePrefs({
        activeSourceIds: prefs.activeSourceIds.filter((activeSourceId) => activeSourceId !== sourceId),
      });
      if (fullscreenId === sourceId) {
        setFullscreenId(null);
      }
    },
    [fullscreenId, prefs.activeSourceIds, setFullscreenId, updatePrefs],
  );
  const handleDoubleClick = useCallback(
    (sourceId: string) => {
      setFullscreenId((currentId) => getNextFullscreenId(currentId, sourceId));
    },
    [setFullscreenId],
  );
  const handleToggleSource = useCallback(
    (sourceId: string) => {
      updatePrefs({ activeSourceIds: getNextActiveSourceIds(prefs.activeSourceIds, sourceId) });
    },
    [prefs.activeSourceIds, updatePrefs],
  );

  return { handleCloseSource, handleDoubleClick, handleToggleSource };
};

const useLiveNewsMuteHandlers = (
  prefs: DeepReadonly<LiveNewsPreferences>,
  updatePrefs: LiveNewsPreferencesUpdater,
) => {
  const handleMuteAll = useCallback(() => {
    updatePrefs({ muteState: "all-muted" });
  }, [updatePrefs]);
  const handleToggleMute = useCallback(
    (_sourceId: string) => {
      if (prefs.muteState === "all-muted") {
        updatePrefs({ muteState: "per-source" });
      } else {
        updatePrefs({ muteState: "all-muted" });
      }
    },
    [prefs.muteState, updatePrefs],
  );
  const handleUnmuteAll = useCallback(() => {
    updatePrefs({ muteState: "per-source" });
  }, [updatePrefs]);
  const mutedForSource = useCallback(
    (_sourceId: string) => prefs.muteState === "all-muted",
    [prefs.muteState],
  );

  return { handleMuteAll, handleToggleMute, handleUnmuteAll, mutedForSource };
};

const useLiveNewsHandlers = ({
  fullscreenId,
  prefs,
  setFullscreenId,
  setLoadedSources,
  updatePrefs,
}: Readonly<
  LiveNewsSourceHandlersProps & {
    readonly setLoadedSources: React.Dispatch<React.SetStateAction<ReadonlyLoadedSources>>;
  }
>) => ({
  ...useLiveNewsVisibilityHandlers(setLoadedSources),
  ...useLiveNewsSourceHandlers({ fullscreenId, prefs, setFullscreenId, updatePrefs }),
  ...useLiveNewsMuteHandlers(prefs, updatePrefs),
});

const useIsDesktop = (): boolean => {
  const [isDesktop, setIsDesktop] = useState(true);

  useEffect(() => {
    const handleResize = () => {
      setIsDesktop(globalThis.innerWidth >= MIN_DESKTOP_WIDTH);
    };
    handleResize();
    globalThis.addEventListener("resize", handleResize);
    return () => {
      globalThis.removeEventListener("resize", handleResize);
    };
  }, []);

  return isDesktop;
};

const useEscapeToCloseFullscreen = (
  setFullscreenId: React.Dispatch<React.SetStateAction<string | null>>,
): void => {
  useEffect(() => {
    const handleKey = (event: EscapeKeyEvent) => {
      if (event.key === "Escape") {
        setFullscreenId(null);
      }
    };
    globalThis.addEventListener("keydown", handleKey);
    return () => {
      globalThis.removeEventListener("keydown", handleKey);
    };
  }, [setFullscreenId]);
};

const DesktopRequiredMessage = () => (
  <div className="flex h-[60vh] w-full items-center justify-center space-y-3 px-6 text-center">
    <span className="font-mono text-[9px] uppercase tracking-[0.25em] text-muted-foreground/50">
      Desktop Required
    </span>
    <p className="mx-auto max-w-xs font-serif text-sm leading-relaxed text-foreground/60">
      Live News view requires a larger screen. Please switch to a desktop device or expand your
      browser window.
    </p>
  </div>
);

const LiveNewsEmptyState = () => (
  <div className="flex flex-1 items-center justify-center space-y-2 text-center">
    <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground/50">
      No sources enabled
    </span>
    <p className="font-serif text-sm text-foreground/50">Use the toolbar to add sources.</p>
  </div>
);

interface LiveNewsGridProps {
  readonly activeSources: readonly LiveNewsSource[];
  readonly fullscreenId: string | null;
  readonly gridTemplateColumns: string;
  readonly loadedSources: ReadonlyLoadedSources;
  readonly mutedForSource: (sourceId: string) => boolean;
  readonly onBecameHidden: (sourceId: string) => void;
  readonly onBecameVisible: (sourceId: string) => void;
  readonly onCloseSource: (sourceId: string) => void;
  readonly onDoubleClick: (sourceId: string) => void;
  readonly onToggleMute: (sourceId: string) => void;
}

const getVisibleLiveNewsSources = (
  activeSources: readonly LiveNewsSource[],
  fullscreenId: string | null,
): readonly LiveNewsSource[] => {
  if (fullscreenId === null) {
    return activeSources;
  }
  return activeSources.filter((source) => source.id === fullscreenId);
};

const LiveNewsGrid = ({
  activeSources,
  fullscreenId,
  gridTemplateColumns,
  loadedSources,
  mutedForSource,
  onBecameHidden,
  onBecameVisible,
  onCloseSource,
  onDoubleClick,
  onToggleMute,
}: Readonly<LiveNewsGridProps>) => {
  if (activeSources.length === 0) {
    return <LiveNewsEmptyState />;
  }

  const visibleSources = getVisibleLiveNewsSources(activeSources, fullscreenId);
  const isFullscreen = fullscreenId !== null;
  return (
    <div className="flex-1 overflow-y-auto p-3" style={getLiveNewsGridStyle(gridTemplateColumns)}>
      {visibleSources.map((source) => (
        <StreamCard
          key={source.id}
          source={source}
          muted={mutedForSource(source.id)}
          loaded={loadedSources.has(source.id)}
          isFullscreen={isFullscreen}
          onToggleMute={onToggleMute}
          onClose={onCloseSource}
          onDoubleClick={onDoubleClick}
          onBecameVisible={onBecameVisible}
          onBecameHidden={onBecameHidden}
        />
      ))}
    </div>
  );
};

interface LiveNewsDesktopLayoutProps extends LiveNewsGridProps {
  readonly activeSourceIds: readonly string[];
  readonly allSources: readonly LiveNewsSource[];
  readonly layout: LiveNewsLayout;
  readonly muteState: LiveNewsPreferences["muteState"];
  readonly onAddSource: () => void;
  readonly onCloseSourcePicker: () => void;
  readonly onLayoutChange: (layout: LiveNewsLayout) => void;
  readonly onMuteAll: () => void;
  readonly onReset: () => void;
  readonly onToggleSource: (sourceId: string) => void;
  readonly onUnmuteAll: () => void;
  readonly sourcePickerOpen: boolean;
}

const LiveNewsDesktopLayout = (props: Readonly<LiveNewsDesktopLayoutProps>) => (
  <div className="flex h-full flex-col">
    <LiveNewsToolbar
      layout={props.layout}
      onLayoutChange={props.onLayoutChange}
      muteState={props.muteState}
      onMuteAll={props.onMuteAll}
      onUnmuteAll={props.onUnmuteAll}
      onReset={props.onReset}
      onAddSource={props.onAddSource}
      activeCount={props.activeSources.length}
      totalCount={props.allSources.length}
    />
    <LiveNewsGrid
      activeSources={props.activeSources}
      fullscreenId={props.fullscreenId}
      gridTemplateColumns={props.gridTemplateColumns}
      loadedSources={props.loadedSources}
      mutedForSource={props.mutedForSource}
      onBecameHidden={props.onBecameHidden}
      onBecameVisible={props.onBecameVisible}
      onCloseSource={props.onCloseSource}
      onDoubleClick={props.onDoubleClick}
      onToggleMute={props.onToggleMute}
    />
    <LiveNewsSourcePicker
      open={props.sourcePickerOpen}
      sources={props.allSources}
      activeSourceIds={props.activeSourceIds}
      onToggleSource={props.onToggleSource}
      onClose={props.onCloseSourcePicker}
    />
  </div>
);

const useLiveNewsViewControls = (
  updatePrefs: LiveNewsPreferencesUpdater,
  setSourcePickerOpen: React.Dispatch<React.SetStateAction<boolean>>,
) => {
  const handleLayoutChange = useCallback(
    (layout: LiveNewsLayout) => {
      updatePrefs({ layout });
    },
    [updatePrefs],
  );
  const handleAddSource = useCallback(() => {
    setSourcePickerOpen(true);
  }, [setSourcePickerOpen]);
  const handleCloseSourcePicker = useCallback(() => {
    setSourcePickerOpen(false);
  }, [setSourcePickerOpen]);

  return { handleAddSource, handleCloseSourcePicker, handleLayoutChange };
};

const useLiveNewsSourceState = () => {
  const [prefs, updatePrefs, handleReset] = useLiveNewsPreferences();
  const [loadedSources, setLoadedSources] = useState<ReadonlyLoadedSources>(new Set());
  const [fullscreenId, setFullscreenId] = useState<string | null>(null);
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false);

  return {
    fullscreenId,
    handleReset,
    loadedSources,
    prefs,
    setFullscreenId,
    setLoadedSources,
    setSourcePickerOpen,
    sourcePickerOpen,
    updatePrefs,
  };
};

const useLiveNewsViewState = () => {
  const sourceState = useLiveNewsSourceState();
  const isDesktop = useIsDesktop();
  useEscapeToCloseFullscreen(sourceState.setFullscreenId);
  const allSources = useMemo(() => getDefaultSources(), []);
  const activeSources = useMemo(() => {
    const activeIds = new Set(sourceState.prefs.activeSourceIds);
    return allSources.filter((source) => activeIds.has(source.id));
  }, [allSources, sourceState.prefs.activeSourceIds]);
  const handlers = useLiveNewsHandlers({
    fullscreenId: sourceState.fullscreenId,
    prefs: sourceState.prefs,
    setFullscreenId: sourceState.setFullscreenId,
    setLoadedSources: sourceState.setLoadedSources,
    updatePrefs: sourceState.updatePrefs,
  });
  const gridTemplateColumns = gridTemplateFor(sourceState.prefs.layout, activeSources.length);
  const controls = useLiveNewsViewControls(
    sourceState.updatePrefs,
    sourceState.setSourcePickerOpen,
  );

  return {
    ...controls,
    activeSources,
    allSources,
    gridTemplateColumns,
    isDesktop,
    ...sourceState,
    ...handlers,
  };
};

export const LiveNewsView = ({
  articles: _articles,
  loading: _loading,
}: Readonly<LiveNewsViewProps>) => {
  const viewState = useLiveNewsViewState();
  if (!viewState.isDesktop) {
    return <DesktopRequiredMessage />;
  }

  return (
    <LiveNewsDesktopLayout
      activeSources={viewState.activeSources}
      activeSourceIds={viewState.prefs.activeSourceIds}
      allSources={viewState.allSources}
      fullscreenId={viewState.fullscreenId}
      gridTemplateColumns={viewState.gridTemplateColumns}
      loadedSources={viewState.loadedSources}
      mutedForSource={viewState.mutedForSource}
      muteState={viewState.prefs.muteState}
      onAddSource={viewState.handleAddSource}
      onBecameHidden={viewState.handleBecameHidden}
      onBecameVisible={viewState.handleBecameVisible}
      onCloseSource={viewState.handleCloseSource}
      onCloseSourcePicker={viewState.handleCloseSourcePicker}
      onDoubleClick={viewState.handleDoubleClick}
      onLayoutChange={viewState.handleLayoutChange}
      onMuteAll={viewState.handleMuteAll}
      onReset={viewState.handleReset}
      onToggleMute={viewState.handleToggleMute}
      onToggleSource={viewState.handleToggleSource}
      onUnmuteAll={viewState.handleUnmuteAll}
      layout={viewState.prefs.layout}
      sourcePickerOpen={viewState.sourcePickerOpen}
    />
  );
};
