import { useCallback } from "react";
import { cn } from "@/lib/utils";
import type { ViewMode } from "@/components/global-navigation";
import { getViewFromEvent, MOBILE_VIEW_OPTIONS } from "@/app/news-page-model";
import type { CategoryOption, SelectChangeEvent, ViewDataEvent } from "@/app/news-page-model";

interface MobileViewTabsProps {
  readonly currentView: ViewMode;
  readonly onViewChange: (view: ViewMode) => void;
  readonly onViewPreload: (view: ViewMode) => void;
}

interface CategorySelectProps {
  readonly categories: readonly CategoryOption[];
  readonly activeCategory: string;
  readonly onCategoryChange: (category: string) => void;
  readonly isGlobeView: boolean;
}

interface SortSelectProps {
  readonly isGlobeView: boolean;
  readonly isTopicMode: boolean;
  readonly sortValue: string;
  readonly onSortModeChange: (value: string) => void;
}

const getViewButtonClass = (currentView: ViewMode, view: ViewMode): string => {
  if (currentView === view) {
    return "border-primary text-foreground";
  }
  return "border-transparent text-muted-foreground/70";
};

const getSelectPaddingClass = (isGlobeView: boolean): string => {
  if (isGlobeView) {
    return "py-0.5";
  }
  return "py-1";
};

const getSortOptions = (isTopicMode: boolean) => {
  if (isTopicMode) {
    return (
      <>
        <option value="sources" className="bg-[#0a0a0a]">
          Sources
        </option>
        <option value="articles" className="bg-[#0a0a0a]">
          Articles
        </option>
        <option value="recent" className="bg-[#0a0a0a]">
          Recent
        </option>
      </>
    );
  }
  return (
    <>
      <option value="favorites" className="bg-[#0a0a0a]">
        Favorites
      </option>
      <option value="newest" className="bg-[#0a0a0a]">
        Newest
      </option>
    </>
  );
};

const MobileViewTabs = (props: Readonly<MobileViewTabsProps>) => {
  const { currentView, onViewChange, onViewPreload } = props;
  const handlePreload = useCallback(
    (event: ViewDataEvent) => {
      const view = getViewFromEvent(event);
      if (view) {
        onViewPreload(view);
      }
    },
    [onViewPreload],
  );
  const handleChange = useCallback(
    (event: ViewDataEvent) => {
      const view = getViewFromEvent(event);
      if (view) {
        onViewChange(view);
      }
    },
    [onViewChange],
  );
  return (
    <nav
      aria-label="Mobile view tabs"
      className={cn(
        "flex items-center justify-center gap-5 overflow-x-auto px-1 py-0.5 no-scrollbar lg:hidden",
        "order-first -mb-1 justify-start pr-24",
      )}
    >
      {MOBILE_VIEW_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          data-view={option.value}
          onFocus={handlePreload}
          onPointerEnter={handlePreload}
          onClick={handleChange}
          className={cn(
            "shrink-0 border-b px-0.5 pb-1 font-mono text-[10px] uppercase tracking-[0.18em] transition-colors",
            getViewButtonClass(currentView, option.value),
          )}
        >
          {option.label}
        </button>
      ))}
    </nav>
  );
};

const CategorySelect = (props: Readonly<CategorySelectProps>) => {
  const { categories, activeCategory, onCategoryChange, isGlobeView } = props;
  const handleChange = useCallback(
    (event: SelectChangeEvent) => {
      onCategoryChange(event.target.value);
    },
    [onCategoryChange],
  );
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded-sm border border-white/5 bg-white/[0.03] p-1",
        isGlobeView && "bg-black/25 backdrop-blur-xl",
      )}
    >
      <span
        className={cn(
          "px-1.5 text-[8px] font-mono uppercase tracking-widest text-muted-foreground/40 sm:px-2",
          isGlobeView && "sr-only sm:not-sr-only",
        )}
      >
        Category
      </span>
      <select
        value={activeCategory}
        onChange={handleChange}
        className={cn(
          "min-w-0 flex-1 cursor-pointer border-none bg-transparent px-1 font-mono text-[9px] uppercase tracking-widest text-foreground/80 focus:ring-0 sm:px-2",
          getSelectPaddingClass(isGlobeView),
        )}
      >
        {categories.map((category) => (
          <option key={category.id} value={category.id} className="bg-[#0a0a0a]">
            {category.label}
          </option>
        ))}
      </select>
    </div>
  );
};

const SortSelect = (props: Readonly<SortSelectProps>) => {
  const { isGlobeView, isTopicMode, sortValue, onSortModeChange } = props;
  const handleChange = useCallback(
    (event: SelectChangeEvent) => {
      onSortModeChange(event.target.value);
    },
    [onSortModeChange],
  );
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded-sm border border-white/5 bg-white/[0.03] p-1",
        isGlobeView && "bg-black/25 backdrop-blur-xl",
      )}
    >
      <span
        className={cn(
          "px-1.5 text-[8px] font-mono uppercase tracking-widest text-muted-foreground/40 sm:px-2",
          isGlobeView && "sr-only sm:not-sr-only",
        )}
      >
        Sort
      </span>
      <select
        value={sortValue}
        onChange={handleChange}
        className={cn(
          "min-w-0 flex-1 cursor-pointer border-none bg-transparent px-1 font-mono text-[9px] uppercase tracking-widest text-foreground/80 focus:ring-0 sm:px-2",
          getSelectPaddingClass(isGlobeView),
        )}
      >
        {getSortOptions(isTopicMode)}
      </select>
    </div>
  );
};

export {
  CategorySelect,
  MobileViewTabs,
  SortSelect,
};
