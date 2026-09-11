import type { ViewMode } from "@/components/navigation/navigation-config";
import { isViewMode } from "@/components/navigation/navigation-config";

const SIDEBAR_EXPANDED_CHANGE_EVENT = "scoop:sidebar-expanded-change",
  SIDEBAR_EXPANDED_STORAGE_KEY = "scoop:sidebar-expanded";
const sidebarExpandedFallback = { value: false };
type SidebarStorageEvent = Readonly<Pick<StorageEvent, "key">>;

const buildViewHref = (view: ViewMode): string => `/?view=${view}`;

const buildSearchHref = (query: string): string =>
  `/search?query=${encodeURIComponent(query.trim())}`;

const getViewFromSearch = (search: string): ViewMode | null => {
  const requestedView = new URLSearchParams(search).get("view");
  if (isViewMode(requestedView)) {
  return requestedView;
}
return null;
};

const readSidebarExpanded = (): boolean => {
  if (globalThis.window === undefined) {
    return false;
  }

  try {
    const storedValue = globalThis.localStorage.getItem(SIDEBAR_EXPANDED_STORAGE_KEY);
    sidebarExpandedFallback.value = storedValue === "true";
  } catch {
    // Fall back to the in-memory state in restricted browser contexts.
  }

  return sidebarExpandedFallback.value;
};

const writeSidebarExpanded = (expanded: boolean): void => {
  if (globalThis.window === undefined) {
    return;
  }

  sidebarExpandedFallback.value = expanded;
  try {
    globalThis.localStorage.setItem(SIDEBAR_EXPANDED_STORAGE_KEY, String(expanded));
  } catch {
    // The current tab still updates through the in-memory fallback.
  }
  globalThis.dispatchEvent(new Event(SIDEBAR_EXPANDED_CHANGE_EVENT));
};

const subscribeSidebarExpanded = (onChange: () => void): (() => void) => {
  if (globalThis.window === undefined) {
    return () => {};
  }

  const handleStorage = (event: SidebarStorageEvent) => {
    if (event.key === SIDEBAR_EXPANDED_STORAGE_KEY || event.key === null) {
      onChange();
    }
  };
  globalThis.addEventListener("storage", handleStorage);
  globalThis.addEventListener(SIDEBAR_EXPANDED_CHANGE_EVENT, onChange);

  return () => {
    globalThis.removeEventListener("storage", handleStorage);
    globalThis.removeEventListener(SIDEBAR_EXPANDED_CHANGE_EVENT, onChange);
  };
};
export {
  buildViewHref,
  buildSearchHref,
  getViewFromSearch,
  readSidebarExpanded,
  writeSidebarExpanded,
  subscribeSidebarExpanded,
};
