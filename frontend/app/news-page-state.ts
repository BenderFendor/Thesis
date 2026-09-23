import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useRouter } from "next/navigation";
import {
  GRID_VIEW_MODE_STORAGE_KEY,
  getStoredGridViewMode,
  isGridViewMode,
} from "@/lib/view-mode-storage";
import { useDebugMode } from "@/hooks/use-debug-mode";
import { useFavorites } from "@/hooks/use-favorites";
import { useNewsLens } from "@/hooks/use-news-lens";
import { useSourceFilter } from "@/hooks/use-source-filter";
import type { ArticleSortMode, TopicSortMode } from "@/app/news-page-model";

type StateSetter<Value> = Dispatch<SetStateAction<Value>>;

interface NewsPageState {
  readonly currentView: "globe" | "grid" | "scroll" | "blindspot" | "live-news";
  readonly setCurrentView: StateSetter<NewsPageState["currentView"]>;
  readonly activeCategory: string;
  readonly setActiveCategory: StateSetter<string>;
  readonly showNotifications: boolean;
  readonly setShowNotifications: StateSetter<boolean>;
  readonly sidebarOpen: boolean;
  readonly setSidebarOpen: StateSetter<boolean>;
  readonly sortMode: ArticleSortMode;
  readonly setSortMode: StateSetter<ArticleSortMode>;
  readonly topicSortMode: TopicSortMode;
  readonly setTopicSortMode: StateSetter<TopicSortMode>;
  readonly gridMode: "source" | "topic";
  readonly setGridMode: StateSetter<"source" | "topic">;
  readonly debugMode: boolean;
  readonly router: ReturnType<typeof useRouter>;
  readonly isFavorite: (sourceId: string) => boolean;
  readonly selectedSources: ReadonlySet<string>;
  readonly isFilterActive: () => boolean;
  readonly lens: ReturnType<typeof useNewsLens>["lens"];
}

const useGridModeStorageEffect = (setGridMode: NewsPageState["setGridMode"]): void => {
  useEffect(() => {
    const handleStorage = (event: Readonly<Pick<StorageEvent, "key" | "newValue">>) => {
      if (event.key === GRID_VIEW_MODE_STORAGE_KEY && isGridViewMode(event.newValue)) {
        setGridMode(event.newValue);
      }
    };
    globalThis.addEventListener("storage", handleStorage);
    return () => {
      globalThis.removeEventListener("storage", handleStorage);
    };
  }, [setGridMode]);
};

const useNewsPageLocalState = () => {
  const [currentView, setCurrentView] = useState<NewsPageState["currentView"]>("grid");
  const [activeCategory, setActiveCategory] = useState("all");
  const [showNotifications, setShowNotifications] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sortMode, setSortMode] = useState<ArticleSortMode>("favorites");
  const [topicSortMode, setTopicSortMode] = useState<TopicSortMode>("sources");
  const [gridMode, setGridMode] = useState<"source" | "topic">(getStoredGridViewMode);
  return {
    activeCategory,
    currentView,
    gridMode,
    setActiveCategory,
    setCurrentView,
    setGridMode,
    setShowNotifications,
    setSidebarOpen,
    setSortMode,
    setTopicSortMode,
    showNotifications,
    sidebarOpen,
    sortMode,
    topicSortMode,
  };
};

const useNewsPageState = (): NewsPageState => {
  const localState = useNewsPageLocalState();
  const debugMode = useDebugMode();
  const router = useRouter();
  const { isFavorite } = useFavorites();
  const { selectedSources, isFilterActive } = useSourceFilter();
  const { lens } = useNewsLens();

  useGridModeStorageEffect(localState.setGridMode);
  return {
    ...localState,
    debugMode,
    isFavorite,
    isFilterActive,
    lens,
    router,
    selectedSources,
  };
};

export { useNewsPageState, type NewsPageState };
