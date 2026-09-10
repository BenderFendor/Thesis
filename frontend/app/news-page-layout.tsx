import { Loader2 } from "lucide-react";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { GlobalNavigation } from "@/components/global-navigation";
import { NotificationsPopup } from "@/components/notification-popup";
import type { Notification, NotificationActionType } from "@/components/notification-popup";
import { SourceSidebar } from "@/components/source-sidebar";
import { cn } from "@/lib/utils";
import type { ViewMode } from "@/components/global-navigation";
import { ActiveView } from "@/app/news-page-active-view";
import type { ActiveViewProps } from "@/app/news-page-active-view";
import { HeaderBar } from "@/app/news-page-header";
import type { HeaderBarProps } from "@/app/news-page-header";
import { HalftoneOverlay, LeadSection } from "@/app/news-page-lead";
import type { LeadSectionProps } from "@/app/news-page-lead";
import type {
  CategoryOption,
  ReadonlyNewsArticleList,
  ReadonlyTouchEvent,
  SourceRecency,
} from "@/app/news-page-model";

interface PageNavigationProps {
  readonly currentView?: ViewMode;
  readonly onViewChange?: (view: ViewMode) => void;
  readonly onViewPreload?: (view: ViewMode) => void;
  readonly onAlertsClick?: () => void;
  readonly alertCount?: number;
}

interface PageNotificationsProps {
  readonly notifications: readonly Notification[];
  readonly onClear: (id: string) => void;
  readonly onClearAll: () => void;
  readonly onAction?: (type: NotificationActionType, notification: Notification) => void;
  readonly onClose: () => void;
  readonly anchorId?: string;
}

type PageLeadProps = LeadSectionProps;

interface PageSourceSidebarProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly sourceRecency?: Readonly<SourceRecency>;
}

interface NewsPageLayoutProps {
  readonly loading: boolean;
  readonly activeViewArticles: ReadonlyNewsArticleList;
  readonly currentView: ViewMode;
  readonly showNotifications: boolean;
  readonly navigation: PageNavigationProps;
  readonly notifications: PageNotificationsProps;
  readonly header: HeaderBarProps;
  readonly lead: PageLeadProps;
  readonly activeView: ActiveViewProps;
  readonly categories: readonly CategoryOption[];
  readonly activeCategory: string;
  readonly onCategoryChange: (category: string) => void;
  readonly onTouchStart: (event: ReadonlyTouchEvent) => void;
  readonly onTouchEnd: (event: ReadonlyTouchEvent) => void;
  readonly sourceSidebar: PageSourceSidebarProps;
}

const LoadingLabel = () => (
  <span className="flex items-center gap-2 rounded-full border border-primary/30 bg-primary/15 px-2 py-0.5 text-[9px] font-mono uppercase tracking-[0.2em] text-primary">
    <Loader2 className="w-3 h-3 animate-spin" />
    Loading
  </span>
);

const LoadingToastContent = () => (
  <div className="pointer-events-auto w-64 overflow-hidden rounded-xl border border-white/10 bg-[var(--news-bg-secondary)]/90 p-4 shadow-2xl backdrop-blur-xl transition-all duration-500 animate-in slide-in-from-bottom-4">
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.08),_transparent_60%)]" />
    <div className="relative">
      <LoadingLabel />
      <h3 className="mt-3 font-serif text-sm font-medium text-foreground">
        Loading live articles...
      </h3>
    </div>
  </div>
);

const LoadingToast = () => (
  <div className="fixed bottom-4 left-4 sm:bottom-8 sm:left-8 z-[100] pointer-events-none">
    <LoadingToastContent />
  </div>
);

const getContentSectionClass = (isCompactView: boolean): string => {
  if (isCompactView) {
    return "h-full overflow-hidden";
  }
  return "min-h-[calc(100vh-80px)]";
};

const NewsCategoryTabs = (
  props: Readonly<{
    currentView: ViewMode;
    activeCategory: string;
    categories: readonly CategoryOption[];
    activeView: ActiveViewProps;
    onCategoryChange: (category: string) => void;
  }>,
) => {
  const isCompactView = props.currentView === "globe" || props.currentView === "scroll";
  const handleCategoryChange = props.onCategoryChange;
  const handleGridModeChange = props.activeView.onGridModeChange;
  return (
    <Tabs
      value={props.activeCategory}
      onValueChange={handleCategoryChange}
      className={cn("flex-1 flex flex-col", isCompactView && "overflow-hidden")}
    >
      {props.categories.map((category) => (
        <TabsContent
          key={category.id}
          value={category.id}
          className={cn("mt-0 flex-1", isCompactView && "overflow-hidden flex flex-col")}
        >
          {props.activeCategory === category.id && (
            <ActiveView
              activeCategory={props.activeCategory}
              articles={props.activeView.articles}
              categoryId={category.id}
              currentView={props.activeView.currentView}
              debugMode={props.activeView.debugMode}
              gridMode={props.activeView.gridMode}
              loading={props.activeView.loading}
              onGridModeChange={handleGridModeChange}
              selectedSourceIds={props.activeView.selectedSourceIds}
              topicSortMode={props.activeView.topicSortMode}
              totalCount={props.activeView.totalCount}
            />
          )}
        </TabsContent>
      ))}
    </Tabs>
  );
};

interface NewsContentSectionProps {
  readonly currentView: ViewMode;
  readonly activeCategory: string;
  readonly categories: readonly CategoryOption[];
  readonly activeView: ActiveViewProps;
  readonly lead: PageLeadProps;
  readonly onCategoryChange: (category: string) => void;
}

const NewsContentSection = (props: Readonly<NewsContentSectionProps>) => {
  const isGlobeView = props.currentView === "globe";
  const isCompactView = isGlobeView || props.currentView === "scroll";
  return (
    <section
      className={cn(
        "lg:col-span-12 bg-[var(--news-bg-primary)] flex flex-col",
        getContentSectionClass(isCompactView),
      )}
    >
      <LeadSection
        articleCount={props.lead.articleCount}
        currentView={props.currentView}
        isBlindspotView={props.currentView === "blindspot"}
        isGlobeView={isGlobeView}
        leadArticle={props.lead.leadArticle}
        sourceCount={props.lead.sourceCount}
      />
      <NewsCategoryTabs
        activeCategory={props.activeCategory}
        activeView={props.activeView}
        categories={props.categories}
        currentView={props.currentView}
        onCategoryChange={props.onCategoryChange}
      />
    </section>
  );
};

const NewsMainContent = (
  props: Readonly<{
    currentView: ViewMode;
    activeCategory: string;
    categories: readonly CategoryOption[];
    activeView: ActiveViewProps;
    lead: PageLeadProps;
    onCategoryChange: (category: string) => void;
    onTouchStart: (event: ReadonlyTouchEvent) => void;
    onTouchEnd: (event: ReadonlyTouchEvent) => void;
  }>,
) => {
  const isCompactView = props.currentView === "globe" || props.currentView === "scroll";
  const handleTouchStart = props.onTouchStart;
  const handleTouchEnd = props.onTouchEnd;
  return (
    <main
      className={cn(
        "flex-1 min-w-0 bg-[var(--news-bg-primary)]",
        isCompactView && "overflow-hidden",
      )}
    >
      <div
        className={cn("w-full grid grid-cols-1 lg:grid-cols-12 gap-0", isCompactView && "h-full")}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <NewsContentSection
          activeCategory={props.activeCategory}
          activeView={props.activeView}
          categories={props.categories}
          currentView={props.currentView}
          lead={props.lead}
          onCategoryChange={props.onCategoryChange}
        />
      </div>
    </main>
  );
};

const NewsPageChrome = ({ page }: Readonly<{ page: NewsPageLayoutProps }>) => {
  const props = page;
  const handleAlertsClick = props.navigation.onAlertsClick;
  const handleViewChange = props.navigation.onViewChange;
  const handleViewPreload = props.navigation.onViewPreload;
  const handleAction = props.notifications.onAction;
  const handleClear = props.notifications.onClear;
  const handleClearAll = props.notifications.onClearAll;
  const handleClose = props.notifications.onClose;
  return (
    <>
      <HalftoneOverlay />
      {props.loading && props.activeViewArticles.length === 0 && <LoadingToast />}
      <GlobalNavigation
        alertCount={props.navigation.alertCount}
        currentView={props.navigation.currentView}
        onAlertsClick={handleAlertsClick}
        onViewChange={handleViewChange}
        onViewPreload={handleViewPreload}
      />
      {props.showNotifications && (
        <NotificationsPopup
          anchorId={props.notifications.anchorId}
          notifications={props.notifications.notifications}
          onAction={handleAction}
          onClear={handleClear}
          onClearAll={handleClearAll}
          onClose={handleClose}
        />
      )}
    </>
  );
};

const NewsPageLayout = (props: Readonly<NewsPageLayoutProps>) => {
  const isScrollView = props.currentView === "scroll";
  const handleCloseSidebar = props.sourceSidebar.onClose;
  return (
    <div className="min-h-screen overflow-x-hidden flex bg-[var(--news-bg-primary)] text-foreground">
      <NewsPageChrome page={props} />
      <div
        className={cn("flex-1 flex flex-col min-w-0", isScrollView && "h-screen overflow-hidden")}
      >
        <HeaderBar header={props.header} />
        <NewsMainContent
          activeCategory={props.activeCategory}
          activeView={props.activeView}
          categories={props.categories}
          currentView={props.currentView}
          lead={props.lead}
          onCategoryChange={props.onCategoryChange}
          onTouchEnd={props.onTouchEnd}
          onTouchStart={props.onTouchStart}
        />
      </div>
      <SourceSidebar
        isOpen={props.sourceSidebar.isOpen}
        onClose={handleCloseSidebar}
        sourceRecency={props.sourceSidebar.sourceRecency}
      />
    </div>
  );
};

export {
  NewsPageLayout,
  type NewsPageLayoutProps,
  type PageLeadProps,
  type PageNavigationProps,
  type PageNotificationsProps,
  type PageSourceSidebarProps,
};
