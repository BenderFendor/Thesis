import { useCallback } from "react";
import type { NotificationActionType } from "@/components/notification-popup";
import { parseArticleSortMode, parseTopicSortMode } from "@/app/news-page-model";
import type { NewsPageState } from "@/app/news-page-state";

interface NewsPageActions {
  readonly handleNotificationAction: (actionType: NotificationActionType) => void;
  readonly handleSortModeChange: (value: string) => void;
  readonly toggleNotifications: () => void;
  readonly closeNotifications: () => void;
  readonly openSidebar: () => void;
  readonly closeSidebar: () => void;
}

const useNotificationActions = (
  router: NewsPageState["router"],
  setShowNotifications: NewsPageState["setShowNotifications"],
  refetchBrowseIndex: () => void,
) => {
  const handleRetry = useCallback(() => {
    refetchBrowseIndex();
  }, [refetchBrowseIndex]);
  const handleNotificationAction = useCallback(
    (actionType: NotificationActionType) => {
      if (actionType === "open-debug") {
        router.push("/debug");
        setShowNotifications(false);
        return;
      }
      if (actionType === "retry") {
        handleRetry();
        setShowNotifications(false);
      }
    },
    [handleRetry, router, setShowNotifications],
  );
  const toggleNotifications = useCallback(() => {
    setShowNotifications((visible) => !visible);
  }, [setShowNotifications]);
  const closeNotifications = useCallback(() => {
    setShowNotifications(false);
  }, [setShowNotifications]);
  return { closeNotifications, handleNotificationAction, toggleNotifications };
};

const useSortModeChange = (
  currentView: NewsPageState["currentView"],
  gridMode: NewsPageState["gridMode"],
  setSortMode: NewsPageState["setSortMode"],
  setTopicSortMode: NewsPageState["setTopicSortMode"],
) =>
  useCallback(
    (value: string) => {
      if (currentView === "grid" && gridMode === "topic") {
        const topicSortMode = parseTopicSortMode(value);
        if (topicSortMode) {
          setTopicSortMode(topicSortMode);
        }
        return;
      }
      const articleSortMode = parseArticleSortMode(value);
      if (articleSortMode) {
        setSortMode(articleSortMode);
      }
    },
    [currentView, gridMode, setSortMode, setTopicSortMode],
  );

const useSidebarActions = (setSidebarOpen: NewsPageState["setSidebarOpen"]) => {
  const openSidebar = useCallback(() => {
    setSidebarOpen(true);
  }, [setSidebarOpen]);
  const closeSidebar = useCallback(() => {
    setSidebarOpen(false);
  }, [setSidebarOpen]);
  return { closeSidebar, openSidebar };
};

const useNewsPageActions = (
  state: Pick<
    NewsPageState,
    | "currentView"
    | "gridMode"
    | "router"
    | "setShowNotifications"
    | "setTopicSortMode"
    | "setSortMode"
    | "setSidebarOpen"
  >,
  refetchBrowseIndex: () => void,
): NewsPageActions => {
  const notificationActions = useNotificationActions(
    state.router,
    state.setShowNotifications,
    refetchBrowseIndex,
  );
  const handleSortModeChange = useSortModeChange(
    state.currentView,
    state.gridMode,
    state.setSortMode,
    state.setTopicSortMode,
  );
  const sidebarActions = useSidebarActions(state.setSidebarOpen);
  return {
    ...notificationActions,
    ...sidebarActions,
    handleSortModeChange,
  };
};

export { useNewsPageActions, type NewsPageActions };
