"use client";

import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { X, Star, Search, ChevronDown } from "lucide-react";
import { useFavorites } from "@/hooks/useFavorites";
import { useSourceFilter } from "@/hooks/useSourceFilter";
import { fetchSources, NewsSource } from "@/lib/api";

interface SourceSidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SourceSidebar({ isOpen, onClose }: SourceSidebarProps) {
  const [sources, setSources] = useState<NewsSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedSections, setExpandedSections] = useState({
    favorites: true,
    allSources: true,
  });

  const { favorites, toggleFavorite, isFavorite } = useFavorites();
  const {
    selectedSources,
    toggleSource,
    isSelected,
    selectAll,
    clearAll,
    getSelectionCount,
    isFilterActive,
  } = useSourceFilter();

  // Load sources on mount
  useEffect(() => {
    const loadSources = async () => {
      try {
        setLoading(true);
        const fetchedSources = await fetchSources();
        setSources(fetchedSources);
      } catch (error) {
        console.error("Failed to load sources:", error);
      } finally {
        setLoading(false);
      }
    };

    if (isOpen) {
      loadSources();
    }
  }, [isOpen]);

  // Get favorite sources
  const favoriteSources = useMemo(() => {
    return sources.filter((source) => isFavorite(source.id));
  }, [sources, isFavorite]);

  // Filter sources based on search query
  const filteredSources = useMemo(() => {
    return sources.filter((source) =>
      source.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      source.country.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [sources, searchQuery]);

  const toggleSection = (section: "favorites" | "allSources") => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const handleSelectAll = () => {
    selectAll(sources.map((s) => s.id));
  };

  const handleClearAll = () => {
    clearAll();
  };

  const handleFavoriteToggle = (e: React.MouseEvent, sourceId: string) => {
    e.stopPropagation();
    toggleFavorite(sourceId);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Sidebar */}
      <div className="relative w-80 bg-background border-r border-border overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold">Sources</h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Filter Badge */}
        {isFilterActive() && (
          <div className="px-4 pt-2 pb-1">
            <Badge variant="secondary" className="cursor-pointer"
              onClick={handleClearAll}>
              {getSelectionCount()} selected ✕
            </Badge>
          </div>
        )}

        {/* Search Bar */}
        <div className="px-4 py-3 border-b border-border">
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search sources..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-9"
            />
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-4 text-center text-muted-foreground">
              Loading sources...
            </div>
          ) : (
            <div className="divide-y divide-border">
              {/* Favorites Section */}
              {favoriteSources.length > 0 && (
                <div className="p-4">
                  <button
                    onClick={() => toggleSection("favorites")}
                    className="flex items-center gap-2 w-full mb-3 hover:opacity-70 transition-opacity"
                  >
                    <ChevronDown
                      className={`h-4 w-4 transition-transform ${
                        !expandedSections.favorites ? "-rotate-90" : ""
                      }`}
                    />
                    <Star className="h-4 w-4 fill-yellow-500 text-yellow-500" />
                    <span className="text-sm font-semibold">
                      Favorites ({favoriteSources.length})
                    </span>
                  </button>

                  {expandedSections.favorites && (
                    <div className="space-y-2 ml-4">
                      {favoriteSources.map((source) => (
                        <SourceItem
                          key={source.id}
                          source={source}
                          isFavorite={isFavorite(source.id)}
                          isSelected={isSelected(source.id)}
                          onToggleFavorite={(e) =>
                            handleFavoriteToggle(e, source.id)
                          }
                          onToggleSelect={() => toggleSource(source.id)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* All Sources Section */}
              <div className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <button
                    onClick={() => toggleSection("allSources")}
                    className="flex items-center gap-2 flex-1 hover:opacity-70 transition-opacity"
                  >
                    <ChevronDown
                      className={`h-4 w-4 transition-transform ${
                        !expandedSections.allSources ? "-rotate-90" : ""
                      }`}
                    />
                    <span className="text-sm font-semibold">
                      All Sources ({sources.length})
                    </span>
                  </button>
                </div>

                {expandedSections.allSources && (
                  <div className="space-y-1 mb-3">
                    <div className="flex gap-1 flex-wrap">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleSelectAll}
                        className="h-8 text-xs"
                      >
                        All
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleClearAll}
                        className="h-8 text-xs"
                      >
                        Clear
                      </Button>
                    </div>
                  </div>
                )}

                {expandedSections.allSources && (
                  <div className="space-y-2 ml-2">
                    {filteredSources.length > 0 ? (
                      filteredSources.map((source) => (
                        <SourceItem
                          key={source.id}
                          source={source}
                          isFavorite={isFavorite(source.id)}
                          isSelected={isSelected(source.id)}
                          onToggleFavorite={(e) =>
                            handleFavoriteToggle(e, source.id)
                          }
                          onToggleSelect={() => toggleSource(source.id)}
                        />
                      ))
                    ) : (
                      <div className="text-xs text-muted-foreground py-2">
                        No sources found
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Individual source list item
 */
function SourceItem({
  source,
  isFavorite,
  isSelected,
  onToggleFavorite,
  onToggleSelect,
}: {
  source: NewsSource;
  isFavorite: boolean;
  isSelected: boolean;
  onToggleFavorite: (e: React.MouseEvent) => void;
  onToggleSelect: () => void;
}) {
  return (
    <div
      className={`flex items-center gap-2 p-2 rounded-md cursor-pointer transition-colors ${
        isSelected
          ? "bg-primary/10 border border-primary/30"
          : "hover:bg-muted border border-transparent"
      }`}
      onClick={onToggleSelect}
    >
      {/* Checkbox */}
      <input
        type="checkbox"
        checked={isSelected}
        onChange={() => {}}
        className="h-4 w-4 cursor-pointer rounded border-primary"
      />

      {/* Source Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{source.name}</p>
        <p className="text-xs text-muted-foreground truncate">
          {source.country}
        </p>
      </div>

      {/* Favorite Button */}
      <button
        onClick={onToggleFavorite}
        className="flex-shrink-0 p-1 rounded hover:bg-muted transition-colors"
        title={isFavorite ? "Remove favorite" : "Add to favorites"}
      >
        <Star
          className={`h-4 w-4 transition-colors ${
            isFavorite
              ? "fill-yellow-500 text-yellow-500"
              : "text-muted-foreground hover:text-yellow-500"
          }`}
        />
      </button>
    </div>
  );
}
