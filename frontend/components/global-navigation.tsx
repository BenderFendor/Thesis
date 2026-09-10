"use client";

import { Bell, ChevronLeft, ChevronRight } from "lucide-react";
import {
  LIBRARY_NAVIGATION,
  VIEW_NAVIGATION,
  WIKI_NAVIGATION,
} from "@/components/navigation/navigation-config";
import {
  buildSearchHref,
  buildViewHref,
  getViewFromSearch,
  readSidebarExpanded,
  subscribeSidebarExpanded,
  writeSidebarExpanded,
} from "@/components/navigation/navigation-state";
import { useCallback, useEffect, useSyncExternalStore } from "react";

import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { SafeImage } from "@/components/safe-image";
import { SidebarNavigationItem } from "@/components/navigation/sidebar-navigation-item";
import { SidebarSection } from "@/components/navigation/sidebar-section";
import type { ViewMode } from "@/components/navigation/navigation-config";
import { WorkspaceSearch } from "@/components/navigation/workspace-search";

interface GlobalNavigationProps {
  readonly currentView?: ViewMode;
  readonly onViewChange?: (view: ViewMode) => void;
  readonly onViewPreload?: (view: ViewMode) => void;
  readonly onAlertsClick?: () => void;
  readonly alertCount?: number;
  readonly navigationServices?: GlobalNavigationServices;
}

interface GlobalNavigationRouter {
  readonly push: (href: string) => void;
  readonly replace: (href: string, options?: { readonly scroll?: boolean }) => void;
}

interface GlobalNavigationServices {
  readonly usePathname: () => string;
  readonly useRouter: () => GlobalNavigationRouter;
}

interface GlobalViewNavigationItemProps {
  readonly active: boolean;
  readonly expanded: boolean;
  readonly itemKey: ViewMode;
  readonly onClick: (view: ViewMode) => void;
  readonly onPreload?: (view: ViewMode) => void;
}

const GlobalViewNavigationItem = ({
  active,
  expanded,
  itemKey,
  onClick,
  onPreload,
}: Readonly<GlobalViewNavigationItemProps>) => {
  const item = VIEW_NAVIGATION.find((candidate) => candidate.key === itemKey);
  const handlePreload = useCallback(() => onPreload?.(itemKey), [itemKey, onPreload]);
  const handleClick = useCallback(() => {
    onClick(itemKey);
  }, [itemKey, onClick]);

  if (!item) {
    return null;
  }

  return (
    <SidebarNavigationItem
      expanded={expanded}
      label={item.label}
      description={item.description}
      icon={item.icon}
      active={active}
      onFocus={handlePreload}
      onPointerEnter={handlePreload}
      onClick={handleClick}
    />
  );
};

const navigationWidthClassName = (expanded: boolean): string => {
  if (expanded) {
    return "w-72";
  }
  return "w-[4.5rem]";
};

const navigationBrandClassName = (expanded: boolean): string => {
  if (expanded) {
    return "gap-3";
  }
  return "justify-center";
};

const navigationBrandLabelClassName = (expanded: boolean): string => {
  if (expanded) {
    return "translate-x-0 opacity-100";
  }
  return "pointer-events-none -translate-x-1 opacity-0";
};

const navigationToggleLabel = (expanded: boolean): string => {
  if (expanded) {
    return "Collapse navigation";
  }
  return "Expand navigation";
};

const NavigationToggleIcon = ({ expanded }: Readonly<{ expanded: boolean }>) => {
  if (expanded) {
    return <ChevronLeft className="h-3.5 w-3.5" />;
  }
  return <ChevronRight className="h-3.5 w-3.5" />;
};

const GlobalNavigationBrand = ({ expanded }: Readonly<{ expanded: boolean }>) => (
  <Link
    href="/"
    className={`flex min-w-0 flex-1 items-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${navigationBrandClassName(expanded)}`}
    aria-label="Scoop dashboard"
  >
    <SafeImage
      src="/favicon.svg"
      alt=""
      width={44}
      height={44}
      className="h-11 w-11 shrink-0"
      sizes="44px"
    />
    <span
      className={`min-w-0 transition-[opacity,transform] duration-200 ${navigationBrandLabelClassName(expanded)}`}
      aria-hidden={!expanded}
    >
      <span className="block font-mono text-[9px] uppercase tracking-[0.32em] text-muted-foreground">
        Scoop
      </span>
      <span className="block truncate font-serif text-xl font-semibold tracking-tight text-foreground">
        News workspace
      </span>
    </span>
  </Link>
);

const GlobalNavigationToggle = ({
  expanded,
  onClick,
}: Readonly<{ expanded: boolean; onClick: () => void }>) => {
  const label = navigationToggleLabel(expanded);
  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute -right-3 top-[4.45rem] flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-[var(--news-bg-secondary)] text-muted-foreground shadow-lg transition-colors hover:border-primary/35 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      aria-expanded={expanded}
      aria-controls="primary-navigation-content"
      aria-label={label}
      title={label}
    >
      <NavigationToggleIcon expanded={expanded} />
    </button>
  );
};

const GlobalNavigationHeader = ({
  expanded,
  onToggle,
}: Readonly<{ expanded: boolean; onToggle: () => void }>) => (
  <div className="relative flex h-[5.25rem] items-center border-b border-white/10 px-3">
    <GlobalNavigationBrand expanded={expanded} />
    <GlobalNavigationToggle expanded={expanded} onClick={onToggle} />
  </div>
);

interface GlobalNavigationSectionsProps {
  readonly currentView?: ViewMode;
  readonly expanded: boolean;
  readonly onViewClick: (view: ViewMode) => void;
  readonly onViewPreload?: (view: ViewMode) => void;
  readonly pathname: string;
}

const GlobalViewSection = ({
  currentView,
  expanded,
  onViewClick,
  onViewPreload,
  pathname,
}: Readonly<GlobalNavigationSectionsProps>) => (
  <SidebarSection expanded={expanded} label="Views">
    {VIEW_NAVIGATION.map((item) => (
      <GlobalViewNavigationItem
        key={item.key}
        expanded={expanded}
        active={pathname === "/" && currentView === item.key}
        itemKey={item.key}
        onClick={onViewClick}
        onPreload={onViewPreload}
      />
    ))}
  </SidebarSection>
);

const GlobalWikiSection = ({
  expanded,
  pathname,
}: Readonly<{ expanded: boolean; pathname: string }>) => (
  <SidebarSection expanded={expanded} label="Intelligence">
    {WIKI_NAVIGATION.map((item) => (
      <SidebarNavigationItem
        key={item.href}
        expanded={expanded}
        href={item.href}
        label={item.label}
        description={item.description}
        icon={item.icon}
        active={item.match(pathname)}
      />
    ))}
  </SidebarSection>
);

const GlobalLibrarySection = ({
  expanded,
  pathname,
}: Readonly<{ expanded: boolean; pathname: string }>) => (
  <SidebarSection expanded={expanded} label="Library">
    {LIBRARY_NAVIGATION.map((item) => (
      <SidebarNavigationItem
        key={item.href}
        expanded={expanded}
        href={item.href}
        label={item.label}
        description={item.description}
        icon={item.icon}
        active={item.match(pathname)}
      />
    ))}
  </SidebarSection>
);

const GlobalNavigationSections = (props: Readonly<GlobalNavigationSectionsProps>) => (
  <nav
    className="no-scrollbar flex-1 space-y-7 overflow-y-auto px-3 py-5"
    aria-label="Workspace"
  >
    <GlobalViewSection
      currentView={props.currentView}
      expanded={props.expanded}
      onViewClick={props.onViewClick}
      onViewPreload={props.onViewPreload}
      pathname={props.pathname}
    />
    <GlobalWikiSection expanded={props.expanded} pathname={props.pathname} />
    <GlobalLibrarySection expanded={props.expanded} pathname={props.pathname} />
  </nav>
);

const GlobalNavigationAlerts = ({
  alertCount,
  expanded,
  onAlertsClick,
}: Readonly<{ alertCount: number; expanded: boolean; onAlertsClick: () => void }>) => (
  <div className="border-t border-white/10 p-3">
    <SidebarNavigationItem
      expanded={expanded}
      label="Alerts"
      description="Review errors and feed warnings"
      icon={Bell}
      badge={alertCount}
      onClick={onAlertsClick}
    />
  </div>
);

interface GlobalNavigationContentProps extends GlobalNavigationSectionsProps {
  readonly alertCount: number;
  readonly onAlertsClick?: () => void;
  readonly onExpand: () => void;
  readonly onSearch: (query: string) => void;
}

const GlobalNavigationContent = ({
  alertCount,
  currentView,
  expanded,
  onAlertsClick,
  onExpand,
  onSearch,
  onViewClick,
  onViewPreload,
  pathname,
}: Readonly<GlobalNavigationContentProps>) => (
  <div id="primary-navigation-content" className="flex min-h-0 flex-1 flex-col">
    <div className="border-b border-white/10 p-3">
      <WorkspaceSearch expanded={expanded} onExpand={onExpand} onSearch={onSearch} />
    </div>
    <GlobalNavigationSections
      currentView={currentView}
      expanded={expanded}
      onViewClick={onViewClick}
      onViewPreload={onViewPreload}
      pathname={pathname}
    />
    {onAlertsClick && (
      <GlobalNavigationAlerts
        alertCount={alertCount}
        expanded={expanded}
        onAlertsClick={onAlertsClick}
      />
    )}
  </div>
);

const useHomeViewLocation = (
  isHomeRoute: boolean,
  onViewChange?: (view: ViewMode) => void,
): void => {
  useEffect(() => {
    if (!isHomeRoute || !onViewChange) {
      return () => {};
    }

    const syncViewFromLocation = () => {
      const requestedView = getViewFromSearch(globalThis.location.search);
      if (requestedView) {
        onViewChange(requestedView);
      }
    };

    syncViewFromLocation();
    globalThis.addEventListener("popstate", syncViewFromLocation);
    return () => {
      globalThis.removeEventListener("popstate", syncViewFromLocation);
    };
  }, [isHomeRoute, onViewChange]);
};

interface GlobalNavigationActions {
  readonly expandNavigation: () => void;
  readonly handleSearch: (query: string) => void;
  readonly handleViewClick: (view: ViewMode) => void;
  readonly toggleExpanded: () => void;
}

interface GlobalNavigationActionInputs extends GlobalNavigationRouter {
  readonly expanded: boolean;
  readonly isHomeRoute: boolean;
  readonly onViewChange?: (view: ViewMode) => void;
}

const useGlobalNavigationActions = ({
  expanded,
  isHomeRoute,
  onViewChange,
  push,
  replace,
}: Readonly<GlobalNavigationActionInputs>): GlobalNavigationActions => {
  const handleSearch = useCallback(
    (query: string) => {
      push(buildSearchHref(query));
    },
    [push],
  );
  const handleViewClick = useCallback(
    (view: ViewMode) => {
      if (isHomeRoute && onViewChange) {
        onViewChange(view);
        replace(buildViewHref(view), { scroll: false });
        return;
      }
      push(buildViewHref(view));
    },
    [isHomeRoute, onViewChange, push, replace],
  );
  const toggleExpanded = useCallback(() => {
    writeSidebarExpanded(!expanded);
  }, [expanded]);
  const expandNavigation = useCallback(() => {
    writeSidebarExpanded(true);
  }, []);
  return { expandNavigation, handleSearch, handleViewClick, toggleExpanded };
};

const DEFAULT_NAVIGATION_SERVICES: GlobalNavigationServices = {
  usePathname,
  useRouter,
};

const GlobalNavigation = ({
  currentView,
  onViewChange,
  onViewPreload,
  onAlertsClick,
  alertCount = 0,
  navigationServices = DEFAULT_NAVIGATION_SERVICES,
}: Readonly<GlobalNavigationProps>) => {
  const pathname = navigationServices.usePathname();
  const isHomeRoute = pathname === "/";
  const { push, replace } = navigationServices.useRouter();
  const expanded = useSyncExternalStore(subscribeSidebarExpanded, readSidebarExpanded, () => false);
  useHomeViewLocation(isHomeRoute, onViewChange);
  const { expandNavigation, handleSearch, handleViewClick, toggleExpanded } =
    useGlobalNavigationActions({ expanded, isHomeRoute, onViewChange, push, replace });

  return (
    <aside
      className={`sticky top-0 z-50 hidden h-screen shrink-0 flex-col border-r border-white/10 bg-[var(--news-bg-secondary)]/95 shadow-[18px_0_60px_rgba(0,0,0,0.08)] backdrop-blur-xl transition-[width] duration-300 lg:flex ${navigationWidthClassName(expanded)}`}
      aria-label="Primary workspace navigation"
      data-expanded={expanded}
    >
      <GlobalNavigationHeader expanded={expanded} onToggle={toggleExpanded} />
      <GlobalNavigationContent
        alertCount={alertCount}
        currentView={currentView}
        expanded={expanded}
        onAlertsClick={onAlertsClick}
        onExpand={expandNavigation}
        onSearch={handleSearch}
        onViewClick={handleViewClick}
        onViewPreload={onViewPreload}
        pathname={pathname}
      />
    </aside>
  );
};
export { GlobalNavigation };
export type { GlobalNavigationServices };
export type { ViewMode } from "@/components/navigation/navigation-config";
