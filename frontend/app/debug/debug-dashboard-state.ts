import { useDebugMode } from "@/hooks/use-debug-mode";
import { useState } from "react";
import {
  DEBUG_DEFAULT_OFFSET,
  DEBUG_DEFAULT_PAGE_SIZE,
  DEBUG_MAX_DATABASE_PAGE_SIZE,
  DEBUG_MAX_OFFSET,
  DEBUG_MAX_PAGE_SIZE,
  DEBUG_MIN_PAGE_SIZE,
} from "./debug-dashboard-schemas";
import type {
  ArticleParserTestResult,
  RssParserTestResult,
} from "./debug-dashboard-types";

interface DebugDashboardState {
  readonly chromaLimit: number;
  readonly setChromaLimit: (value: number) => void;
  readonly chromaOffset: number;
  readonly setChromaOffset: (value: number) => void;
  readonly dbLimit: number;
  readonly setDbLimit: (value: number) => void;
  readonly dbOffset: number;
  readonly setDbOffset: (value: number) => void;
  readonly dbSortDirection: "asc" | "desc";
  readonly setDbSortDirection: (value: "asc" | "desc") => void;
  readonly dbMissingOnly: boolean;
  readonly setDbMissingOnly: (value: boolean) => void;
  readonly dbSourceDraft: string;
  readonly setDbSourceDraft: (value: string) => void;
  readonly dbSourceFilter: string | undefined;
  readonly setDbSourceFilter: (value: string | undefined) => void;
  readonly dbBeforeDraft: string;
  readonly setDbBeforeDraft: (value: string) => void;
  readonly dbBeforeFilter: string | undefined;
  readonly setDbBeforeFilter: (value: string | undefined) => void;
  readonly dbAfterDraft: string;
  readonly setDbAfterDraft: (value: string) => void;
  readonly dbAfterFilter: string | undefined;
  readonly setDbAfterFilter: (value: string | undefined) => void;
  readonly cacheLimit: number;
  readonly setCacheLimit: (value: number) => void;
  readonly cacheOffset: number;
  readonly setCacheOffset: (value: number) => void;
  readonly cacheSourceDraft: string;
  readonly setCacheSourceDraft: (value: string) => void;
  readonly cacheSourceFilter: string | undefined;
  readonly setCacheSourceFilter: (value: string | undefined) => void;
  readonly frontendDebugMode: boolean;
  readonly cacheRefreshRunning: boolean;
  readonly setCacheRefreshRunning: (value: boolean) => void;
  readonly cacheRefreshMessage: string | undefined;
  readonly setCacheRefreshMessage: (value: string | undefined) => void;
  readonly cacheRefreshError: string | undefined;
  readonly setCacheRefreshError: (value: string | undefined) => void;
  readonly rssTestUrl: string;
  readonly setRssTestUrl: (value: string) => void;
  readonly rssTestResult: RssParserTestResult | undefined;
  readonly setRssTestResult: (value: RssParserTestResult | undefined) => void;
  readonly rssTestLoading: boolean;
  readonly setRssTestLoading: (value: boolean) => void;
  readonly articleTestUrl: string;
  readonly setArticleTestUrl: (value: string) => void;
  readonly articleTestResult: ArticleParserTestResult | undefined;
  readonly setArticleTestResult: (value: Readonly<ArticleParserTestResult> | undefined) => void;
  readonly articleTestLoading: boolean;
  readonly setArticleTestLoading: (value: boolean) => void;
}

const usePersistentNumber = (
  initial: number,
  min: number,
  max: number,
): [number, (value: number) => void] => {
  const [value, setValue] = useState(initial),
    clampAndSet = (next: number) => {
      const clamped = Math.min(Math.max(next, min), max);
      setValue(clamped);
    };
  return [value, clampAndSet];
};

const useChromaDebugState = () => {
  const {
    limit: chromaLimit,
    offset: chromaOffset,
    setLimit: setChromaLimit,
    setOffset: setChromaOffset,
  } = useDebugPaginationState(DEBUG_MAX_PAGE_SIZE);
  return {
    chromaLimit,
    chromaOffset,
    setChromaLimit,
    setChromaOffset,
  };
};

const useDebugDraftFilter = () => {
  const [draft, setDraft] = useState(""),
    [filter, setFilter] = useState<string | undefined>();
  return { draft, filter, setDraft, setFilter };
};

const useDebugPaginationState = (maxLimit: number) => {
  const [limit, setLimit] = usePersistentNumber(
      DEBUG_DEFAULT_PAGE_SIZE,
      DEBUG_MIN_PAGE_SIZE,
      maxLimit,
    ),
    [offset, setOffset] = usePersistentNumber(
      DEBUG_DEFAULT_OFFSET,
      DEBUG_DEFAULT_OFFSET,
      DEBUG_MAX_OFFSET,
    );
  return { limit, offset, setLimit, setOffset };
};

const useDatabaseDebugState = () => {
  const {
      limit: dbLimit,
      offset: dbOffset,
      setLimit: setDbLimit,
      setOffset: setDbOffset,
    } = useDebugPaginationState(DEBUG_MAX_DATABASE_PAGE_SIZE),
    [dbSortDirection, setDbSortDirection] = useState<"asc" | "desc">("desc"),
    [dbMissingOnly, setDbMissingOnly] = useState(false),
    {
      draft: dbSourceDraft,
      filter: dbSourceFilter,
      setDraft: setDbSourceDraft,
      setFilter: setDbSourceFilter,
    } = useDebugDraftFilter(),
    {
      draft: dbBeforeDraft,
      filter: dbBeforeFilter,
      setDraft: setDbBeforeDraft,
      setFilter: setDbBeforeFilter,
    } = useDebugDraftFilter(),
    {
      draft: dbAfterDraft,
      filter: dbAfterFilter,
      setDraft: setDbAfterDraft,
      setFilter: setDbAfterFilter,
    } = useDebugDraftFilter();

  return {
    dbAfterDraft,
    dbAfterFilter,
    dbBeforeDraft,
    dbBeforeFilter,
    dbLimit,
    dbMissingOnly,
    dbOffset,
    dbSortDirection,
    dbSourceDraft,
    dbSourceFilter,
    setDbAfterDraft,
    setDbAfterFilter,
    setDbBeforeDraft,
    setDbBeforeFilter,
    setDbLimit,
    setDbMissingOnly,
    setDbOffset,
    setDbSortDirection,
    setDbSourceDraft,
    setDbSourceFilter,
  };
};

const useCacheDebugState = () => {
  const {
      limit: cacheLimit,
      offset: cacheOffset,
      setLimit: setCacheLimit,
      setOffset: setCacheOffset,
    } = useDebugPaginationState(DEBUG_MAX_PAGE_SIZE),
    {
      draft: cacheSourceDraft,
      filter: cacheSourceFilter,
      setDraft: setCacheSourceDraft,
      setFilter: setCacheSourceFilter,
    } = useDebugDraftFilter();

  return {
    cacheLimit,
    cacheOffset,
    cacheSourceDraft,
    cacheSourceFilter,
    setCacheLimit,
    setCacheOffset,
    setCacheSourceDraft,
    setCacheSourceFilter,
  };
};

const useStorageDebugState = () => ({
  ...useChromaDebugState(),
  ...useDatabaseDebugState(),
  ...useCacheDebugState(),
});

const useCacheRefreshState = () => {
  const frontendDebugMode = useDebugMode(),
    [cacheRefreshRunning, setCacheRefreshRunning] = useState(false),
    [cacheRefreshMessage, setCacheRefreshMessage] = useState<string | undefined>(),
    [cacheRefreshError, setCacheRefreshError] = useState<string | undefined>();

  return {
    cacheRefreshError,
    cacheRefreshMessage,
    cacheRefreshRunning,
    frontendDebugMode,
    setCacheRefreshError,
    setCacheRefreshMessage,
    setCacheRefreshRunning,
  };
};

const useParserDebugState = () => {
  const [rssTestUrl, setRssTestUrl] = useState(""),
    [rssTestResult, setRssTestResult] = useState<RssParserTestResult | undefined>(),
    [rssTestLoading, setRssTestLoading] = useState(false),
    [articleTestUrl, setArticleTestUrl] = useState(""),
    [articleTestResult, setArticleTestResult] = useState<ArticleParserTestResult | undefined>(),
    [articleTestLoading, setArticleTestLoading] = useState(false);

  return {
    articleTestLoading,
    articleTestResult,
    articleTestUrl,
    rssTestLoading,
    rssTestResult,
    rssTestUrl,
    setArticleTestLoading,
    setArticleTestResult,
    setArticleTestUrl,
    setRssTestLoading,
    setRssTestResult,
    setRssTestUrl,
  };
};

export {
  useCacheRefreshState,
  useParserDebugState,
  useStorageDebugState,
};
export type { DebugDashboardState };
