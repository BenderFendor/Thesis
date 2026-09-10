"use client";

import { ErrorBoundary } from "@/components/error-boundary";
import type { NotificationActionType } from "@/components/notification-popup";
import type { ViewMode } from "@/components/global-navigation";
import { ALERTS_BUTTON_ID } from "@/app/news-page-model";
import type {
  ArticleSortMode,
  ReadonlyNewsArticleList,
  ReadonlyNotificationList,
  SourceRecency,
  TopicSortMode,
} from "@/app/news-page-model";
import { NewsPageLayout } from "@/app/news-page-layout";
import type {
  NewsPageLayoutProps,
  PageLeadProps,
  PageNavigationProps,
  PageNotificationsProps,
  PageSourceSidebarProps,
} from "@/app/news-page-layout";
import { useNewsPageActions } from "@/app/news-page-actions";
import { useNewsPageQueryData, useNewsPageViewData } from "@/app/news-page-data";
import type { NewsPageViewData } from "@/app/news-page-data";
import { useNewsPageNavigation } from "@/app/news-page-navigation";
import type { NewsPageState } from "@/app/news-page-state";
import { useNewsPageState } from "@/app/news-page-state";
import type { DeepReadonly } from "@/lib/deep-readonly";

interface PageFactoryData {
  readonly activeCategory: string;
  readonly activeLensLabel: string;
  readonly activeViewArticles: ReadonlyNewsArticleList;
  readonly actionableNotificationCount: number;
  readonly articleCount: number;
  readonly articles: ReadonlyNewsArticleList;
  readonly browseIndexTotalCount: number;
  readonly categories: NewsPageLayoutProps["categories"];
  readonly currentView: ViewMode;
  readonly debugMode: boolean;
  readonly dismissAll: NewsPageViewData["dismissAll"];
  readonly dismissOne: NewsPageViewData["dismissOne"];
  readonly gridMode: NewsPageState["gridMode"];
  readonly handleNotificationAction: (actionType: NotificationActionType) => void;
  readonly handleTouchEnd: NewsPageLayoutProps["onTouchEnd"];
  readonly handleTouchStart: NewsPageLayoutProps["onTouchStart"];
  readonly handleViewChange: (view: ViewMode) => void;
  readonly handleViewPreload: (view: ViewMode) => void;
  readonly isSidebarOpen: boolean;
  readonly isGlobeView: boolean;
  readonly leadArticle: PageLeadProps["leadArticle"];
  readonly lens: string;
  readonly loading: boolean;
  readonly onAlertsClick: () => void;
  readonly onCategoryChange: (category: string) => void;
  readonly onCloseNotifications: () => void;
  readonly onCloseSidebar: () => void;
  readonly onGridModeChange: NewsPageLayoutProps["activeView"]["onGridModeChange"];
  readonly onOpenSidebar: () => void;
  readonly onSortModeChange: (value: string) => void;
  readonly notifications: ReadonlyNotificationList;
  readonly sourceCount: number;
  readonly sourceRecency: SourceRecency;
  readonly sortMode: ArticleSortMode;
  readonly selectedSourceIds: readonly string[];
  readonly showNotifications: boolean;
  readonly topicSortMode: TopicSortMode;
}

const createPageNavigationProps = (data: DeepReadonly<PageFactoryData>): PageNavigationProps => ({
  alertCount: data.actionableNotificationCount,
  currentView: data.currentView,
  onAlertsClick: data.onAlertsClick,
  onViewChange: data.handleViewChange,
  onViewPreload: data.handleViewPreload,
});

const createPageNotificationProps = (
  data: DeepReadonly<PageFactoryData>,
): PageNotificationsProps => ({
  anchorId: ALERTS_BUTTON_ID,
  notifications: data.notifications,
  onAction: data.handleNotificationAction,
  onClear: data.dismissOne,
  onClearAll: data.dismissAll,
  onClose: data.onCloseNotifications,
});

const createPageHeaderProps = (data: DeepReadonly<PageFactoryData>) => ({
  actionableNotificationCount: data.actionableNotificationCount,
  activeCategory: data.activeCategory,
  activeLensLabel: data.activeLensLabel,
  articleCount: data.articleCount,
  categories: data.categories,
  currentView: data.currentView,
  gridMode: data.gridMode,
  isGlobeView: data.isGlobeView,
  lens: data.lens,
  onAlertsClick: data.onAlertsClick,
  onCategoryChange: data.onCategoryChange,
  onOpenSidebar: data.onOpenSidebar,
  onSortModeChange: data.onSortModeChange,
  onViewChange: data.handleViewChange,
  onViewPreload: data.handleViewPreload,
  sortMode: data.sortMode,
  topicSortMode: data.topicSortMode,
});

const createPageLeadProps = (data: DeepReadonly<PageFactoryData>): PageLeadProps => ({
  articleCount: data.articleCount,
  currentView: data.currentView,
  isBlindspotView: data.currentView === "blindspot",
  isGlobeView: data.isGlobeView,
  leadArticle: data.leadArticle,
  sourceCount: data.sourceCount,
});

const createPageActiveViewProps = (data: DeepReadonly<PageFactoryData>) => ({
  activeCategory: data.activeCategory,
  articles: data.articles,
  categoryId: data.activeCategory,
  currentView: data.currentView,
  debugMode: data.debugMode,
  gridMode: data.gridMode,
  loading: data.loading,
  onGridModeChange: data.onGridModeChange,
  selectedSourceIds: data.selectedSourceIds,
  topicSortMode: data.topicSortMode,
  totalCount: data.browseIndexTotalCount,
});

const createPageSidebarProps = (data: DeepReadonly<PageFactoryData>): PageSourceSidebarProps => ({
  isOpen: data.isSidebarOpen,
  onClose: data.onCloseSidebar,
  sourceRecency: data.sourceRecency,
});

const buildNewsPageLayoutProps = (data: DeepReadonly<PageFactoryData>): NewsPageLayoutProps => ({
  activeCategory: data.activeCategory,
  activeView: createPageActiveViewProps(data),
  activeViewArticles: data.activeViewArticles,
  categories: data.categories,
  currentView: data.currentView,
  header: createPageHeaderProps(data),
  lead: createPageLeadProps(data),
  loading: data.loading,
  navigation: createPageNavigationProps(data),
  notifications: createPageNotificationProps(data),
  onCategoryChange: data.onCategoryChange,
  onTouchEnd: data.handleTouchEnd,
  onTouchStart: data.handleTouchStart,
  showNotifications: data.showNotifications,
  sourceSidebar: createPageSidebarProps(data),
});

const useNewsPageController = (): NewsPageLayoutProps => {
  const state = useNewsPageState();
  const queries = useNewsPageQueryData(state);
  const view = useNewsPageViewData(state, queries);
  const navigation = useNewsPageNavigation(state);
  const actions = useNewsPageActions(state, queries.refetchBrowseIndex);
  return buildNewsPageLayoutProps({
    actionableNotificationCount: view.actionableNotificationCount,
    activeCategory: state.activeCategory,
    activeLensLabel: view.activeLensLabel,
    activeViewArticles: view.activeViewArticles,
    articleCount: view.articleCount,
    articles: view.browseArticles,
    browseIndexTotalCount: queries.browseIndexTotalCount,
    categories: queries.categories,
    currentView: state.currentView,
    debugMode: state.debugMode,
    dismissAll: view.dismissAll,
    dismissOne: view.dismissOne,
    gridMode: state.gridMode,
    handleNotificationAction: actions.handleNotificationAction,
    handleTouchEnd: navigation.handleTouchEnd,
    handleTouchStart: navigation.handleTouchStart,
    handleViewChange: navigation.handleViewChange,
    handleViewPreload: navigation.preloadView,
    isGlobeView: state.currentView === "globe",
    isSidebarOpen: state.sidebarOpen,
    leadArticle: view.leadArticle,
    lens: state.lens,
    loading: view.loading,
    notifications: view.visibleNotifications,
    onAlertsClick: actions.toggleNotifications,
    onCategoryChange: navigation.handleCategoryChange,
    onCloseNotifications: actions.closeNotifications,
    onCloseSidebar: actions.closeSidebar,
    onGridModeChange: state.setGridMode,
    onOpenSidebar: actions.openSidebar,
    onSortModeChange: actions.handleSortModeChange,
    selectedSourceIds: queries.selectedSourceIds,
    showNotifications: state.showNotifications,
    sortMode: state.sortMode,
    sourceCount: view.sourceCount,
    sourceRecency: view.sourceRecency,
    topicSortMode: state.topicSortMode,
  });
};

const NewsPageController = () => {
  const props = useNewsPageController();
  return (
    <NewsPageLayout
      activeCategory={props.activeCategory}
      activeView={props.activeView}
      activeViewArticles={props.activeViewArticles}
      categories={props.categories}
      currentView={props.currentView}
      header={props.header}
      lead={props.lead}
      loading={props.loading}
      navigation={props.navigation}
      notifications={props.notifications}
      onCategoryChange={props.onCategoryChange}
      onTouchEnd={props.onTouchEnd}
      onTouchStart={props.onTouchStart}
      showNotifications={props.showNotifications}
      sourceSidebar={props.sourceSidebar}
    />
  );
};

const Page = () => (
  <ErrorBoundary>
    <NewsPageController />
  </ErrorBoundary>
);

export default Page;
