"use client";

import {
  Copy,
  Download,
  Focus,
  Loader2,
  RefreshCw,
  Search,
} from "lucide-react";
import type {
  ChangeEvent,
  KeyboardEvent,
  RefObject,
} from "react";

import type { AtlasSearchItem } from "./lib/atlas-schema";
import styles from "./atlas.module.css";

function humanize(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function dateDistance(value?: string | null): string {
  if (!value) return "Not indexed";
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "Not indexed";
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

interface AtlasTopbarProps {
  inputRef: RefObject<HTMLInputElement | null>;
  searchText: string;
  searchOpen: boolean;
  searchItems: AtlasSearchItem[];
  activeSearchIndex: number;
  searching: boolean;
  focus: boolean;
  exporting: boolean;
  refreshing: boolean;
  indexing: boolean;
  lastIndexed?: string | null;
  onSearchChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onSearchFocus: () => void;
  onSearchKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onSearchHover: (index: number) => void;
  onChooseSearchResult: (item: AtlasSearchItem) => void;
  onToggleFocus: () => void;
  onCopy: () => void;
  onExport: () => void;
  onRefresh: () => void;
}

export function AtlasTopbar({
  inputRef,
  searchText,
  searchOpen,
  searchItems,
  activeSearchIndex,
  searching,
  focus,
  exporting,
  refreshing,
  indexing,
  lastIndexed,
  onSearchChange,
  onSearchFocus,
  onSearchKeyDown,
  onSearchHover,
  onChooseSearchResult,
  onToggleFocus,
  onCopy,
  onExport,
  onRefresh,
}: AtlasTopbarProps) {
  return (
    <header className={styles.topbar}>
      <div>
        <div className={styles.brandEyebrow}>SCOOP / Media accountability</div>
        <h1 className={styles.brandTitle}>Intelligence Atlas</h1>
      </div>

      <div className={styles.searchWrap}>
        <Search className={styles.searchIcon} />
        <input
          ref={inputRef}
          value={searchText}
          onChange={onSearchChange}
          onFocus={onSearchFocus}
          onKeyDown={onSearchKeyDown}
          className={styles.searchInput}
          id="atlas-search"
          name="atlas-search"
          placeholder="Search sources, owners, reporters, countries, or IDs"
          aria-label="Search Intelligence Atlas"
          aria-expanded={searchOpen}
          aria-controls="atlas-search-results"
          role="combobox"
          autoComplete="off"
        />
        <span className={styles.searchShortcut}>⌘K</span>
        {searchOpen && searchText.trim() ? (
          <div id="atlas-search-results" className={styles.searchResults} role="listbox">
            {searching ? (
              <div className="flex items-center gap-2 p-4 text-sm text-[#77736a]">
                <Loader2 className="h-4 w-4 animate-spin" /> Searching indexed entities
              </div>
            ) : searchItems.length > 0 ? (
              (["source", "organization", "reporter"] as const).map((type) => {
                const items = searchItems.filter((item) => item.entity_type === type);
                if (items.length === 0) return null;
                return (
                  <div key={type} className={styles.searchGroup}>
                    <div className={`${styles.microLabel} px-2 pb-2`}>{humanize(type)}s</div>
                    {items.map((item) => {
                      const index = searchItems.findIndex((candidate) => candidate.id === item.id);
                      return (
                        <button
                          key={item.id}
                          type="button"
                          role="option"
                          aria-selected={index === activeSearchIndex}
                          className={styles.searchResult}
                          data-active={index === activeSearchIndex}
                          onMouseEnter={() => onSearchHover(index)}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => onChooseSearchResult(item)}
                        >
                          <span className={styles.entityMark} data-type={item.entity_type} aria-hidden="true">
                            {item.entity_type.slice(0, 2).toUpperCase()}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm text-[#f0ede4]">{item.label}</span>
                            <span className="mt-1 block truncate text-xs text-[#77736a]">
                              {item.subtitle || item.country_code || item.id}
                            </span>
                          </span>
                          <span className={styles.confidence} data-tier={item.confidence_tier ?? "unresolved"}>
                            {item.confidence_tier || "unresolved"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                );
              })
            ) : (
              <div className="p-4 text-sm text-[#77736a]">No indexed entity matches this query.</div>
            )}
          </div>
        ) : null}
      </div>

      <div className={styles.actionRow}>
        <div className="hidden items-center gap-2 pr-2 text-[10px] font-mono uppercase tracking-[0.13em] text-[#77736a] xl:flex">
          <span className={`h-1.5 w-1.5 rounded-full ${indexing ? "animate-pulse bg-amber-300" : "bg-emerald-300"}`} />
          {indexing ? "Indexing" : `Indexed ${dateDistance(lastIndexed)}`}
        </div>
        <button type="button" className={styles.actionButton} data-active={focus} aria-label="Toggle focus mode" onClick={onToggleFocus}>
          <Focus className="h-4 w-4" /> <span>Focus</span>
        </button>
        <button type="button" className={styles.iconButton} aria-label="Copy investigation link" onClick={onCopy}>
          <Copy className="h-4 w-4" />
        </button>
        <button type="button" className={styles.actionButton} aria-label="Export Atlas investigation" disabled={exporting} onClick={onExport}>
          {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} <span>Export</span>
        </button>
        <button type="button" className={styles.iconButton} aria-label="Refresh Atlas data" onClick={onRefresh}>
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
        </button>
      </div>
    </header>
  );
}
