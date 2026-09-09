"use client";
import { hasText } from "@/lib/utils";

import { Copy, Download, Focus, Loader2, RefreshCw, Search } from "lucide-react";
import { useCallback } from "react";
import type { DeepReadonly } from "@/lib/deep-readonly";

import type { AtlasSearchItem } from "./lib/atlas-schema";
import styles from "./atlas.module.css";

const humanize = (value: string): string =>
  value.replaceAll("_", " ").replaceAll(/\b\w/gu, (letter) => letter.toUpperCase());

const pluralGroupLabel = (type: string): string => {
  if (type === "person") {
    return "People";
  }
  return `${humanize(type)}s`;
};

const dateDistance = (value?: string | null): string => {
  if (!hasText(value)) {
    return "Not indexed";
  }
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    return "Not indexed";
  }
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) {
    return "just now";
  }
  if (seconds < 3600) {
    return `${Math.round(seconds / 60)}m ago`;
  }
  if (seconds < 86_400) {
    return `${Math.round(seconds / 3600)}h ago`;
  }
  return `${Math.round(seconds / 86_400)}d ago`;
};

type ReadonlyAtlasSearchItem = DeepReadonly<AtlasSearchItem>;

type AtlasSearchChangeEvent = Readonly<{
  readonly target: Readonly<{ readonly value: string }>;
}>;
type AtlasSearchKeyDownEvent = Readonly<{
  readonly key: string;
  readonly preventDefault: () => void;
}>;

interface AtlasSearchResultButtonProps {
  readonly activeSearchIndex: number;
  readonly index: number;
  readonly item: ReadonlyAtlasSearchItem;
  readonly onChooseSearchResult: (item: ReadonlyAtlasSearchItem) => void;
  readonly onSearchHover: (index: number) => void;
}

const AtlasSearchResultButton = ({
  activeSearchIndex,
  index,
  item,
  onChooseSearchResult,
  onSearchHover,
}: Readonly<AtlasSearchResultButtonProps>) => {
  const handleMouseEnter = useCallback(() => {
      onSearchHover(index);
    }, [index, onSearchHover]);
  const handleChoose = useCallback(() => {
      onChooseSearchResult(item);
    }, [item, onChooseSearchResult]);

  return (
    <button
      type="button"
      className={styles.searchResult}
      data-active={index === activeSearchIndex}
      onMouseEnter={handleMouseEnter}
      onClick={handleChoose}
    >
      <span className={styles.entityMark} data-type={item.entity_type} aria-hidden="true">
        {item.entity_type.slice(0, 2).toUpperCase()}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm text-[#f0ede4]">{item.label}</span>
        <span className="mt-1 block truncate text-xs text-[#77736a]">
          {(item.subtitle ?? item.country_code) ?? item.id}
        </span>
      </span>
      <span className={styles.confidence} data-tier={item.confidence_tier ?? "unresolved"}>
        {item.confidence_tier ?? "unresolved"}
      </span>
    </button>
  );
};

interface AtlasInputRef<TInput extends HTMLInputElement> {
  readonly current: TInput | null;
}

type AtlasTopbarProps<TInput extends HTMLInputElement> = Readonly<{
  inputRef: AtlasInputRef<TInput>;
  searchText: string;
  searchOpen: boolean;
  searchItems: readonly ReadonlyAtlasSearchItem[];
  activeSearchIndex: number;
  searching: boolean;
  focus: boolean;
  exporting: boolean;
  refreshing: boolean;
  indexing: boolean;
  lastIndexed?: string | null;
  onSearchChange: (
    event: Readonly<{ target: Readonly<{ readonly value: string }> }>,
  ) => void;
  onSearchFocus: () => void;
  onSearchKeyDown: (event: Readonly<{ readonly key: string; readonly preventDefault: () => void }>) =>
    void;
  onSearchHover: (index: number) => void;
  onChooseSearchResult: (item: Readonly<AtlasSearchItem>) => void;
  onToggleFocus: () => void;
  onCopy: () => void;
  onExport: () => void;
  onRefresh: () => void;
}>;

const AtlasTopbar = <TInput extends HTMLInputElement,>({
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
}: AtlasTopbarProps<TInput>) => (
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
        placeholder="Search outlets, owners, reporters, countries, or IDs"
        aria-label="Search Intelligence Atlas"
        aria-expanded={searchOpen}
        aria-controls="atlas-search-results"
        role="combobox"
        autoComplete="off"
      />
      <span className={styles.searchShortcut}>⌘K</span>
      {Boolean(searchOpen && searchText.trim()) && <ul id="atlas-search-results" className={`${styles.searchResults} m-0 list-none p-0`}>
          {(() => {
  if (searching) {
    return <li className="flex items-center gap-2 p-4 text-sm text-[#77736a]">
              <Loader2 className="h-4 w-4 animate-spin" /> Searching indexed entities
            </li>;
  }
  return (() => {
    if (searchItems.length > 0) {
      return (["outlet", "organization", "person", "reporter"] as const).map(type => {
        const items = searchItems.filter(item => item.entity_type === type);
        if (items.length === 0) {
          return null;
        }
        return <li key={type} className={styles.searchGroup}>
                  <div className={`${styles.microLabel} px-2 pb-2`}>{pluralGroupLabel(type)}</div>
                  <ul className="m-0 list-none p-0">
                    {items.map(item => {
              const index = searchItems.findIndex(candidate => candidate.id === item.id);
              return <li key={item.id}>
                          <AtlasSearchResultButton activeSearchIndex={activeSearchIndex} index={index} item={item} onChooseSearchResult={onChooseSearchResult} onSearchHover={onSearchHover} />
                        </li>;
            })}
                  </ul>
                </li>;
      });
    }
    return <li className="p-4 text-sm text-[#77736a]">No indexed entity matches this query.</li>;
  })();
})()}
        </ul>}
    </div>

    <div className={styles.actionRow}>
      <div className="hidden items-center gap-2 pr-2 text-[10px] font-mono uppercase tracking-[0.13em] text-[#77736a] xl:flex">
        <span
          className={`h-1.5 w-1.5 rounded-full ${(() => {
  if (indexing) {
    return "animate-pulse bg-amber-300";
  }
  return "bg-emerald-300";
})()}`}
        />
        {(() => {
  if (indexing) {
    return "Indexing";
  }
  return `Indexed ${dateDistance(lastIndexed)}`;
})()}
      </div>
      <button
        type="button"
        className={styles.actionButton}
        data-active={focus}
        aria-label="Toggle focus mode"
        onClick={onToggleFocus}
      >
        <Focus className="h-4 w-4" /> <span>Focus</span>
      </button>
      <button
        type="button"
        className={styles.iconButton}
        aria-label="Copy investigation link"
        onClick={onCopy}
      >
        <Copy className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={styles.actionButton}
        aria-label="Export Atlas investigation"
        disabled={exporting}
        onClick={onExport}
      >
        {(() => {
  if (exporting) {
    return <Loader2 className="h-4 w-4 animate-spin" />;
  }
  return <Download className="h-4 w-4" />;
})()}{" "}
        <span>Export</span>
      </button>
      <button
        type="button"
        className={styles.iconButton}
        aria-label="Refresh Atlas data"
        onClick={onRefresh}
      >
        <RefreshCw className={`h-4 w-4 ${(() => {
  if (refreshing) {
    return "animate-spin";
  }
  return "";
})()}`} />
      </button>
    </div>
  </header>
);
export { AtlasTopbar };
export type { AtlasSearchChangeEvent, AtlasSearchKeyDownEvent };
