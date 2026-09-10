import { useCallback, useRef } from "react";
import type { ViewMode } from "@/components/global-navigation";
import { getAdjacentView, getSwipeDirection } from "@/app/news-page-model";
import type { ReadonlyTouchEvent } from "@/app/news-page-model";
import {
  loadBlindspotView,
  loadFeedView,
  loadGlobeView,
  loadLiveNewsView,
} from "@/app/news-page-active-view";
import type { NewsPageState } from "@/app/news-page-state";

interface NewsPageNavigation {
  readonly handleCategoryChange: (category: string) => void;
  readonly handleViewChange: (view: ViewMode) => void;
  readonly preloadView: (view: ViewMode) => void;
  readonly handleTouchStart: (event: ReadonlyTouchEvent) => void;
  readonly handleTouchEnd: (event: ReadonlyTouchEvent) => void;
}

const preloadNewsView = (view: ViewMode): void => {
  switch (view) {
    case "globe": {
      void loadGlobeView();
      break;
    }
    case "scroll": {
      void loadFeedView();
      break;
    }
    case "blindspot": {
      void loadBlindspotView();
      break;
    }
    case "live-news": {
      void loadLiveNewsView();
      break;
    }
    case "grid": {
      break;
    }
  }
};

const useTouchNavigation = (moveView: (direction: 1 | -1) => void) => {
  const touchStartRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const handleTouchStart = useCallback((event: ReadonlyTouchEvent) => {
    const touch = event.touches[0];
    if (touch) {
      touchStartRef.current = { clientX: touch.clientX, clientY: touch.clientY };
    }
  }, []);
  const handleTouchEnd = useCallback(
    (event: ReadonlyTouchEvent) => {
      const start = touchStartRef.current;
      touchStartRef.current = null;
      const touch = event.changedTouches[0];
      if (!start || !touch) {
        return;
      }
      const deltaX = touch.clientX - start.clientX;
      const deltaY = touch.clientY - start.clientY;
      if (Math.abs(deltaX) < 72 || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) {
        return;
      }
      moveView(getSwipeDirection(deltaX));
    },
    [moveView],
  );
  return { handleTouchEnd, handleTouchStart };
};

const useNewsPageNavigation = (
  state: Pick<NewsPageState, "setActiveCategory" | "setCurrentView">,
): NewsPageNavigation => {
  const { setActiveCategory, setCurrentView } = state;
  const handleCategoryChange = useCallback(
    (category: string) => {
      setActiveCategory(category);
    },
    [setActiveCategory],
  );
  const handleViewChange = useCallback(
    (view: ViewMode) => {
      setCurrentView(view);
    },
    [setCurrentView],
  );
  const moveView = useCallback(
    (direction: 1 | -1) => {
      setCurrentView((view) => getAdjacentView(view, direction));
    },
    [setCurrentView],
  );
  const touchNavigation = useTouchNavigation(moveView);
  return {
    handleCategoryChange,
    handleTouchEnd: touchNavigation.handleTouchEnd,
    handleTouchStart: touchNavigation.handleTouchStart,
    handleViewChange,
    preloadView: preloadNewsView,
  };
};

export { useNewsPageNavigation, type NewsPageNavigation };
