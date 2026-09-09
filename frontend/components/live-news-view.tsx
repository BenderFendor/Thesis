"use client";
import { hasText } from "@/lib/utils";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { LiveNewsPreferences } from "@/hooks/use-live-news-preferences";
import type { DeepReadonly } from "@/lib/deep-readonly";
import { LiveNewsSourcePicker } from "./live-news-source-picker";
import { LiveNewsToolbar } from "./live-news-toolbar";
import type { NewsArticle } from "@/lib/api";
import { StreamCard } from "./stream-card";
import { getDefaultSources } from "@/lib/live-news-sources";
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

const useLiveNewsHandlers = (
  prefs: DeepReadonly<LiveNewsPreferences>,
  updatePrefs: LiveNewsPreferencesUpdater,
  fullscreenId: string | null,
  setFullscreenId: React.Dispatch<React.SetStateAction<string | null>>,
  setLoadedSources: React.Dispatch<React.SetStateAction<ReadonlyLoadedSources>>,
) => {
  const handleBecameHidden = useCallback(
      (sourceId: string) => {
        setLoadedSources((prev) => {
          const next = new Set(prev);
          next.delete(sourceId);
          return next;
        });
      },
      [setLoadedSources],
    ),
    handleBecameVisible = useCallback(
      (sourceId: string) => {
        setLoadedSources((prev) => {
          const next = new Set(prev);
          next.add(sourceId);
          if (next.size > MAX_LOADED_IFRAMES) {
            const toRemove = [...next].slice(0, next.size - MAX_LOADED_IFRAMES);
            for (const id of toRemove) {
              next.delete(id);
            }
          }
          return next;
        });
      },
      [setLoadedSources],
    ),
    handleCloseSource = useCallback(
      (sourceId: string) => {
        const nextIds = prefs.activeSourceIds.filter((id) => id !== sourceId);
        updatePrefs({ activeSourceIds: nextIds });
        if (fullscreenId === sourceId) {
          setFullscreenId(null);
        }
      },
      [fullscreenId, prefs.activeSourceIds, setFullscreenId, updatePrefs],
    ),
    handleDoubleClick = useCallback(
      (sourceId: string) => {
        setFullscreenId((prev) => ((() => {
  if (prev === sourceId) {
    return null;
  }
  return sourceId;
})()));
      },
      [setFullscreenId],
    ),
    handleMuteAll = useCallback(() => {
      updatePrefs({ muteState: "all-muted" });
    }, [updatePrefs]),
    handleToggleMute = useCallback(
      (_sourceId: string) => {
        if (prefs.muteState === "all-muted") {
          updatePrefs({ muteState: "per-source" });
        } else {
          updatePrefs({ muteState: "all-muted" });
        }
      },
      [prefs.muteState, updatePrefs],
    ),
    handleToggleSource = useCallback(
      (sourceId: string) => {
        const nextIds = (() => {
  if (prefs.activeSourceIds.includes(sourceId)) {
    return prefs.activeSourceIds.filter(id => id !== sourceId);
  }
  return [...prefs.activeSourceIds, sourceId];
})();
        updatePrefs({ activeSourceIds: nextIds });
      },
      [prefs.activeSourceIds, updatePrefs],
    ),
    handleUnmuteAll = useCallback(() => {
      updatePrefs({ muteState: "per-source" });
    }, [updatePrefs]),
    mutedForSource = useCallback(
      (_sourceId: string) => prefs.muteState === "all-muted",
      [prefs.muteState],
    );

  return {
    handleBecameHidden,
    handleBecameVisible,
    handleCloseSource,
    handleDoubleClick,
    handleMuteAll,
    handleToggleMute,
    handleToggleSource,
    handleUnmuteAll,
    mutedForSource,
    setLoadedSources,
  };
};

export const LiveNewsView = ({
  articles: _articles,
  loading: _loading,
}: Readonly<LiveNewsViewProps>) => {
  const [prefs, updatePrefs, resetToDefaults] = useLiveNewsPreferences();
  const [loadedSources, setLoadedSources] = useState<ReadonlyLoadedSources>(new Set());
  const [fullscreenId, setFullscreenId] = useState<string | null>(null);
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(true);
  const allSources = useMemo(() => getDefaultSources(), []);
  const activeSources = useMemo(() => {
      const activeIds = new Set(prefs.activeSourceIds);
      return allSources.filter((s) => activeIds.has(s.id));
    }, [allSources, prefs.activeSourceIds]);

  useEffect(() => {
    const check = () => {
      setIsDesktop(globalThis.innerWidth >= MIN_DESKTOP_WIDTH);
    };
    check();
    globalThis.addEventListener("resize", check);
    return () => {
      globalThis.removeEventListener("resize", check);
    };
  }, []);

  useEffect(() => {
    const handleKey = (e: EscapeKeyEvent) => {
      if (e.key === "Escape") {
        setFullscreenId(null);
      }
    };
    globalThis.addEventListener("keydown", handleKey);
    return () => {
      globalThis.removeEventListener("keydown", handleKey);
    };
  }, []);

  const {
      handleBecameHidden,
      handleBecameVisible,
      handleCloseSource,
      handleDoubleClick,
      handleMuteAll,
      handleToggleMute,
      handleToggleSource,
      handleUnmuteAll,
      mutedForSource,
    } = useLiveNewsHandlers(prefs, updatePrefs, fullscreenId, setFullscreenId, setLoadedSources);
  const gridTemplateColumns = gridTemplateFor(prefs.layout, activeSources.length);
  const handleLayoutChange = useCallback(
      (layout: LiveNewsLayout) => {
        updatePrefs({ layout });
      },
      [updatePrefs],
    );
  const handleAddSource = useCallback(() => {
      setSourcePickerOpen(true);
    }, []);
  const handleCloseSourcePicker = useCallback(() => {
      setSourcePickerOpen(false);
    }, []);

  if (!isDesktop) {
    return (
      <div className="flex items-center justify-center h-[60vh] px-6">
        <div className="text-center space-y-3 max-w-xs">
          <span className="font-mono text-[9px] uppercase tracking-[0.25em] text-muted-foreground/50">
            Desktop Required
          </span>
          <p className="font-serif text-sm leading-relaxed text-foreground/60">
            Live News view requires a larger screen. Please switch to a desktop device or expand
            your browser globalThis.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <LiveNewsToolbar
        layout={prefs.layout}
        onLayoutChange={handleLayoutChange}
        muteState={prefs.muteState}
        onMuteAll={handleMuteAll}
        onUnmuteAll={handleUnmuteAll}
        onReset={resetToDefaults}
        onAddSource={handleAddSource}
        activeCount={activeSources.length}
        totalCount={allSources.length}
      />

      {(() => {
  if (activeSources.length === 0) {
    return <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-2">
            <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground/50">
              No sources enabled
            </span>
            <p className="font-serif text-sm text-foreground/50">Use the toolbar to add sources.</p>
          </div>
        </div>;
  }
  return <div className="flex-1 overflow-y-auto p-3" style={getLiveNewsGridStyle(gridTemplateColumns)}>
          {(() => {
      if (hasText(fullscreenId)) {
        return activeSources.filter(s => s.id === fullscreenId).map(source => <StreamCard key={source.id} source={source} muted={mutedForSource(source.id)} loaded={loadedSources.has(source.id)} isFullscreen onToggleMute={handleToggleMute} onClose={handleCloseSource} onDoubleClick={handleDoubleClick} onBecameVisible={handleBecameVisible} onBecameHidden={handleBecameHidden} />);
      }
      return activeSources.map(source => <StreamCard key={source.id} source={source} muted={mutedForSource(source.id)} loaded={loadedSources.has(source.id)} isFullscreen={false} onToggleMute={handleToggleMute} onClose={handleCloseSource} onDoubleClick={handleDoubleClick} onBecameVisible={handleBecameVisible} onBecameHidden={handleBecameHidden} />);
    })()}
        </div>;
})()}

      <LiveNewsSourcePicker
        open={sourcePickerOpen}
        sources={allSources}
        activeSourceIds={prefs.activeSourceIds}
        onToggleSource={handleToggleSource}
        onClose={handleCloseSourcePicker}
      />
    </div>
  );
};
