import { Bell, Bookmark, Search } from "lucide-react";
import Link from "next/link";
import type { ViewMode } from "@/components/global-navigation";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";
import { ALERTS_BUTTON_ID, VIEW_OPTIONS } from "@/app/news-page-model";
import type { ArticleSortMode, CategoryOption, TopicSortMode } from "@/app/news-page-model";
import { CategorySelect, MobileViewTabs, SortSelect } from "@/app/news-page-header-controls";

interface HeaderBarProps {
  readonly isGlobeView: boolean;
  readonly currentView: ViewMode;
  readonly gridMode: "source" | "topic";
  readonly topicSortMode: TopicSortMode;
  readonly sortMode: ArticleSortMode;
  readonly categories: readonly CategoryOption[];
  readonly activeCategory: string;
  readonly onCategoryChange: (category: string) => void;
  readonly onSortModeChange: (value: string) => void;
  readonly articleCount: number;
  readonly actionableNotificationCount: number;
  readonly onAlertsClick: () => void;
  readonly lens: string;
  readonly activeLensLabel: string;
  readonly onOpenSidebar: () => void;
  readonly onViewChange: (view: ViewMode) => void;
  readonly onViewPreload: (view: ViewMode) => void;
}

type HeaderIdentityProps = Pick<HeaderBarProps, "isGlobeView" | "currentView" | "articleCount">;
type HeaderFilterProps = Pick<
  HeaderBarProps,
  | "isGlobeView"
  | "currentView"
  | "gridMode"
  | "topicSortMode"
  | "sortMode"
  | "categories"
  | "activeCategory"
  | "onCategoryChange"
  | "onSortModeChange"
>;
type HeaderActionProps = Pick<
  HeaderBarProps,
  "isGlobeView" | "lens" | "activeLensLabel" | "onOpenSidebar"
>;

const getHeaderSurfaceClass = (isGlobeView: boolean): string => {
  if (isGlobeView) {
    return "absolute inset-x-0 top-0 border-b-0 bg-transparent";
  }
  return "sticky top-0 border-b border-white/5 bg-[var(--news-bg-primary)]/95 supports-[backdrop-filter]:bg-[var(--news-bg-primary)]/80";
};

const getHeaderLayoutGap = (isGlobeView: boolean): string => {
  if (isGlobeView) {
    return "gap-2";
  }
  return "gap-3";
};

const getControlGap = (isGlobeView: boolean): string => {
  if (isGlobeView) {
    return "gap-1.5";
  }
  return "gap-2";
};

const getSourceButtonLabel = (lens: string, activeLensLabel: string): string => {
  if (lens === "all") {
    return "Sources";
  }
  return activeLensLabel;
};

const getSortValue = ({ currentView, gridMode, topicSortMode, sortMode }: HeaderFilterProps) => {
  if (currentView === "grid" && gridMode === "topic") {
    return topicSortMode;
  }
  return sortMode;
};

const HeaderIdentity = (props: Readonly<HeaderIdentityProps>) => {
  const { isGlobeView, currentView, articleCount } = props;
  const viewLabel = VIEW_OPTIONS.find((view) => view.value === currentView)?.label;
  return (
    <div className="flex min-w-0 items-center gap-3 sm:gap-4">
      <h3
        className={cn(
          "min-w-0 truncate whitespace-nowrap font-serif text-lg font-black uppercase tracking-tight text-foreground/90 sm:text-2xl",
          "hidden lg:block",
        )}
      >
        {viewLabel} View
      </h3>
      <div className={cn("hidden h-4 w-px bg-white/10 sm:block", isGlobeView && "lg:block")} />
      <span
        className={cn(
          "hidden whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/50 sm:inline",
          isGlobeView && "lg:inline",
        )}
      >
        {articleCount} articles indexed
      </span>
    </div>
  );
};

const SavedResourceLink = () => (
  <Link href="/saved">
    <Bookmark className="mr-1.5 h-3.5 w-3.5" />
    Saved
  </Link>
);

const ResearchResourceLink = () => (
  <Link href="/search">
    <Search className="mr-1.5 h-3.5 w-3.5" />
    Research
  </Link>
);

const HeaderResourceLinks = ({ isGlobeView }: Readonly<Pick<HeaderBarProps, "isGlobeView">>) => (
  <div className="contents lg:flex lg:items-center lg:gap-1.5">
    <div className="hidden lg:block">
      <ThemeToggle />
    </div>
    <Button
      asChild
      variant="outline"
      size="sm"
      className={cn(
        "h-8 min-w-0 border-white/5 bg-white/[0.03] px-2 font-mono text-[9px] uppercase tracking-widest hover:bg-white/10 lg:px-3",
        isGlobeView && "h-7 bg-black/25 backdrop-blur-xl",
      )}
    >
      <SavedResourceLink />
    </Button>
    <Button
      asChild
      variant="outline"
      size="sm"
      className={cn(
        "h-8 min-w-0 border-white/5 bg-white/[0.03] px-2 font-mono text-[9px] uppercase tracking-widest hover:bg-white/10 lg:px-3",
        isGlobeView && "h-7 bg-black/25 backdrop-blur-xl",
      )}
    >
      <ResearchResourceLink />
    </Button>
  </div>
);

const HeaderSourceFilterButton = (props: Readonly<HeaderActionProps>) => {
  const { isGlobeView, lens, activeLensLabel } = props;
  const handleOpenSidebar = props.onOpenSidebar;
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleOpenSidebar}
      className={cn(
        "h-8 min-w-0 border-white/5 bg-white/[0.03] px-2 font-mono text-[9px] uppercase tracking-widest hover:bg-white/10 lg:px-3",
        isGlobeView && "h-7 bg-black/25 backdrop-blur-xl",
      )}
    >
      {getSourceButtonLabel(lens, activeLensLabel)}
    </Button>
  );
};

const HeaderResourceActions = (props: Readonly<HeaderActionProps>) => {
  const { isGlobeView, lens, activeLensLabel } = props;
  const handleOpenSidebar = props.onOpenSidebar;
  return (
    <div className={cn("grid grid-cols-3 gap-2 sm:flex sm:items-center", isGlobeView && "gap-1.5")}>
      <div className="hidden h-4 w-px bg-white/10 lg:block" />
      <HeaderResourceLinks isGlobeView={isGlobeView} />
      <HeaderSourceFilterButton
        activeLensLabel={activeLensLabel}
        isGlobeView={isGlobeView}
        lens={lens}
        onOpenSidebar={handleOpenSidebar}
      />
    </div>
  );
};

const HeaderFilters = (props: Readonly<HeaderFilterProps>) => {
  const isTopicMode = props.currentView === "grid" && props.gridMode === "topic";
  const handleCategoryChange = props.onCategoryChange;
  const handleSortModeChange = props.onSortModeChange;
  return (
    <div className="grid min-w-0 grid-cols-2 gap-2 sm:flex sm:items-center">
      <CategorySelect
        activeCategory={props.activeCategory}
        categories={props.categories}
        isGlobeView={props.isGlobeView}
        onCategoryChange={handleCategoryChange}
      />
      <SortSelect
        isGlobeView={props.isGlobeView}
        isTopicMode={isTopicMode}
        onSortModeChange={handleSortModeChange}
        sortValue={getSortValue(props)}
      />
    </div>
  );
};

const HeaderControls = ({ header }: Readonly<{ header: HeaderBarProps }>) => {
  const handleCategoryChange = header.onCategoryChange;
  const handleSortModeChange = header.onSortModeChange;
  const handleOpenSidebar = header.onOpenSidebar;
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col sm:flex-row sm:flex-wrap sm:items-center sm:justify-between lg:justify-end lg:gap-3",
        getControlGap(header.isGlobeView),
      )}
    >
      <HeaderFilters
        activeCategory={header.activeCategory}
        categories={header.categories}
        currentView={header.currentView}
        gridMode={header.gridMode}
        isGlobeView={header.isGlobeView}
        onCategoryChange={handleCategoryChange}
        onSortModeChange={handleSortModeChange}
        sortMode={header.sortMode}
        topicSortMode={header.topicSortMode}
      />
      <HeaderResourceActions
        activeLensLabel={header.activeLensLabel}
        isGlobeView={header.isGlobeView}
        lens={header.lens}
        onOpenSidebar={handleOpenSidebar}
      />
    </div>
  );
};

const HeaderMobileActions = (
  props: Readonly<Pick<HeaderBarProps, "actionableNotificationCount" | "onAlertsClick">>,
) => {
  const handleAlertsClick = props.onAlertsClick;
  return (
    <div className="flex shrink-0 items-center gap-2 lg:hidden">
      <Button
        id={ALERTS_BUTTON_ID}
        type="button"
        variant="outline"
        size="icon"
        onClick={handleAlertsClick}
        className="relative h-8 w-8 border-white/10 bg-[var(--news-bg-secondary)] p-0"
        title="Alerts"
      >
        <Bell className="h-3.5 w-3.5" />
        {props.actionableNotificationCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-1 text-[8px] font-bold text-primary-foreground">
            {props.actionableNotificationCount}
          </span>
        )}
      </Button>
      <ThemeToggle />
    </div>
  );
};

const HeaderIdentityGroup = ({ header }: Readonly<{ header: HeaderBarProps }>) => {
  const handleAlertsClick = header.onAlertsClick;
  return (
    <div
      className={cn(
        "flex items-center justify-between lg:justify-start lg:gap-6",
        "absolute right-3 top-2 z-10 lg:static",
      )}
    >
      <HeaderIdentity
        articleCount={header.articleCount}
        currentView={header.currentView}
        isGlobeView={header.isGlobeView}
      />
      <HeaderMobileActions
        actionableNotificationCount={header.actionableNotificationCount}
        onAlertsClick={handleAlertsClick}
      />
    </div>
  );
};

const HeaderBar = ({ header }: Readonly<{ header: HeaderBarProps }>) => {
  const handleViewChange = header.onViewChange;
  const handleViewPreload = header.onViewPreload;
  return (
    <header
      className={cn(
        "z-40 px-3 py-3 backdrop-blur sm:px-4 lg:sticky lg:top-0 lg:border-b-0 lg:bg-[var(--news-bg-primary)]/95 lg:px-6 lg:py-4 supports-[backdrop-filter]:lg:bg-[var(--news-bg-primary)]/80",
        getHeaderSurfaceClass(header.isGlobeView),
      )}
    >
      <div
        className={cn(
          "flex min-w-0 flex-col lg:flex-row lg:items-center lg:justify-between",
          getHeaderLayoutGap(header.isGlobeView),
        )}
      >
        <HeaderIdentityGroup header={header} />
        <MobileViewTabs
          currentView={header.currentView}
          onViewChange={handleViewChange}
          onViewPreload={handleViewPreload}
        />
        <HeaderControls header={header} />
      </div>
    </header>
  );
};

export { HeaderBar, type HeaderBarProps };
