"use client";

import type { CountrySelection, ExpandedSortMode } from "@/lib/globe-workspace";
import type { NewsArticle } from "@/lib/api";
import { useCallback, useRef, useState } from "react";
import type { RefObject } from "react";
import { z } from "zod";

type LightingMode = "all-lit" | "day-night";
type LensViewMode = "internal" | "external";

interface PanelPointerEvent {
  readonly clientY: number;
  readonly currentTarget: {
    readonly releasePointerCapture: (pointerId: number) => void;
    readonly setPointerCapture: (pointerId: number) => void;
  };
  readonly pointerId: number;
}
type PanelPointerHandler = (event: PanelPointerEvent) => void;

const DEFAULT_LENS_LIMIT = 40;
const EMPTY_COUNT = 0;
const COUNTRY_NAME_SCHEMA = z.string();
const MIN_DRAG_DISTANCE = 36;
const MIN_DRAG_MOVEMENT = 8;

const useGlobeDisplayState = () => {
  const [earthLightingMode, setEarthLightingMode] = useState<LightingMode>("all-lit");
  const [expandedSort, setExpandedSort] = useState<ExpandedSortMode>("recent");
  const [isArticleModalOpen, setIsArticleModalOpen] = useState(false);
  const [isFocusExpanded, setIsFocusExpanded] = useState(false);
  const [isMobileSheetExpanded, setIsMobileSheetExpanded] = useState(false);
  const [lensLimit, setLensLimit] = useState(DEFAULT_LENS_LIMIT);
  return {
    earthLightingMode,
    expandedSort,
    isArticleModalOpen,
    isFocusExpanded,
    isMobileSheetExpanded,
    lensLimit,
    setEarthLightingMode,
    setExpandedSort,
    setIsArticleModalOpen,
    setIsFocusExpanded,
    setIsMobileSheetExpanded,
    setLensLimit,
  };
};

const useGlobeArticleSelectionState = () => {
  const [selectedArticle, setSelectedArticle] = useState<NewsArticle | null>(null);
  const [selectedCountry, setSelectedCountry] = useState<CountrySelection>(null);
  const [selectedCountryName, setSelectedCountryName] = useState<string | null>(null);
  return {
    selectedArticle,
    selectedCountry,
    selectedCountryName,
    setSelectedArticle,
    setSelectedCountry,
    setSelectedCountryName,
  };
};

const useGlobeNavigationState = () => {
  const [sidebarTab, setSidebarTab] = useState("briefing");
  const [viewMode, setViewMode] = useState<LensViewMode>("internal");
  return { setSidebarTab, setViewMode, sidebarTab, viewMode };
};

const useGlobeSelectionRefs = () => {
  const lensBriefRef = useRef<HTMLDivElement | null>(null);
  const sourceBreakdownRef = useRef<HTMLDivElement | null>(null);
  const topStoriesRef = useRef<HTMLDivElement | null>(null);
  const trendingTopicsRef = useRef<HTMLDivElement | null>(null);
  const coverageMapRef = useRef<HTMLDivElement | null>(null);
  return {
    coverageMapRef,
    lensBriefRef,
    sourceBreakdownRef,
    topStoriesRef,
    trendingTopicsRef,
  };
};

const useGlobeSelectionState = () => {
  const displayState = useGlobeDisplayState();
  const articleSelectionState = useGlobeArticleSelectionState();
  const navigationState = useGlobeNavigationState();
  const selectionRefs = useGlobeSelectionRefs();
  return {
    ...displayState,
    ...articleSelectionState,
    ...navigationState,
    ...selectionRefs,
  };
};

interface SheetDragState {
  readonly lastY: number;
  readonly moved: boolean;
  readonly pointerId: number;
  readonly startY: number;
}

type SetSheetExpanded = (value: boolean | ((current: boolean) => boolean)) => void;

type SetDragState = (value: SheetDragState | null) => void;
type SetSuppressClick = (value: boolean) => void;

const useSheetDragMotionCallbacks = (drag: SheetDragState | null, setDrag: SetDragState) => {
  const cancelSheetDrag = useCallback(
    (event: Readonly<PanelPointerEvent>): void => {
      if (drag?.pointerId !== event.pointerId) {
        return;
      }
      setDrag(null);
      event.currentTarget.releasePointerCapture(event.pointerId);
    },
    [drag, setDrag],
  );
  const handleSheetDragMove = useCallback(
    (event: Readonly<PanelPointerEvent>): void => {
      if (drag === null || drag.pointerId !== event.pointerId) {
        return;
      }
      setDrag({
        lastY: event.clientY,
        moved: drag.moved || Math.abs(event.clientY - drag.startY) > MIN_DRAG_MOVEMENT,
        pointerId: drag.pointerId,
        startY: drag.startY,
      });
    },
    [drag, setDrag],
  );
  const handleSheetDragStart = useCallback(
    (event: Readonly<PanelPointerEvent>): void => {
      setDrag({
        lastY: event.clientY,
        moved: false,
        pointerId: event.pointerId,
        startY: event.clientY,
      });
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [setDrag],
  );
  return { cancelSheetDrag, handleSheetDragMove, handleSheetDragStart };
};

const useSheetDragCompletionCallbacks = (
  drag: SheetDragState | null,
  setDrag: SetDragState,
  setIsMobileSheetExpanded: SetSheetExpanded,
  setSuppressClick: SetSuppressClick,
  suppressClick: boolean,
) => {
  const finishSheetDrag = useCallback(
    (event: Readonly<PanelPointerEvent>): void => {
      if (drag === null || drag.pointerId !== event.pointerId) {
        return;
      }
      setDrag(null);
      event.currentTarget.releasePointerCapture(event.pointerId);
      const deltaY = drag.lastY - drag.startY;
      if (!drag.moved || Math.abs(deltaY) < MIN_DRAG_DISTANCE) {
        return;
      }
      setIsMobileSheetExpanded(deltaY < EMPTY_COUNT);
      setSuppressClick(true);
      globalThis.setTimeout(() => {
        setSuppressClick(false);
      }, EMPTY_COUNT);
    },
    [drag, setDrag, setIsMobileSheetExpanded, setSuppressClick],
  );
  const handleSheetHandleClick = useCallback((): void => {
    if (suppressClick) {
      setSuppressClick(false);
      return;
    }
    setIsMobileSheetExpanded((current) => !current);
  }, [setIsMobileSheetExpanded, setSuppressClick, suppressClick]);
  return { finishSheetDrag, handleSheetHandleClick };
};

const useSheetDragCallbacks = (setIsMobileSheetExpanded: SetSheetExpanded) => {
  const [drag, setDrag] = useState<SheetDragState | null>(null);
  const [suppressClick, setSuppressClick] = useState(false);
  const motionCallbacks = useSheetDragMotionCallbacks(drag, setDrag);
  const completionCallbacks = useSheetDragCompletionCallbacks(
    drag,
    setDrag,
    setIsMobileSheetExpanded,
    setSuppressClick,
    suppressClick,
  );
  return {
    ...motionCallbacks,
    ...completionCallbacks,
  };
};

type GlobeActionState = Readonly<
  Pick<
    ReturnType<typeof useGlobeSelectionState>,
    | "setEarthLightingMode"
    | "setExpandedSort"
    | "setIsArticleModalOpen"
    | "setIsFocusExpanded"
    | "setIsMobileSheetExpanded"
    | "setLensLimit"
    | "setSelectedArticle"
    | "setSelectedCountry"
    | "setSelectedCountryName"
    | "setSidebarTab"
    | "setViewMode"
  >
>;

type GlobeGeoData = Readonly<{
  readonly countries?: Readonly<Record<string, { readonly name?: string }>>;
}>;

type CountrySelectionActions = Pick<
  GlobeActionState,
  | "setIsFocusExpanded"
  | "setIsMobileSheetExpanded"
  | "setLensLimit"
  | "setSelectedCountry"
  | "setSelectedCountryName"
  | "setSidebarTab"
  | "setViewMode"
>;

const resolveCountryName = (
  country: CountrySelection,
  name: string | null | undefined,
  geoData: GlobeGeoData | undefined,
): string | null => {
  const resolvedName = name ?? null;
  if (country === null || country === "") {
    return resolvedName;
  }
  const wireName = geoData?.countries?.[country]?.name;
  const countryName = COUNTRY_NAME_SCHEMA.safeParse(wireName);
  if (countryName.success) {
    return countryName.data;
  }
  return resolvedName ?? country;
};

const applyCountrySelection = (
  actions: CountrySelectionActions,
  country: CountrySelection,
  countryName: string | null,
): void => {
  actions.setSelectedCountry(country);
  actions.setSelectedCountryName(countryName);
  actions.setViewMode("internal");
  actions.setSidebarTab("briefing");
  actions.setIsFocusExpanded(false);
  actions.setIsMobileSheetExpanded(false);
  actions.setLensLimit(DEFAULT_LENS_LIMIT);
};

const useGlobeArticleSelectionActions = (state: GlobeActionState) => {
  const { setIsArticleModalOpen, setSelectedArticle } = state;
  const handleArticleSelect = useCallback(
    (article: NewsArticle): void => {
      setSelectedArticle(article);
      setIsArticleModalOpen(true);
    },
    [setIsArticleModalOpen, setSelectedArticle],
  );
  return { handleArticleSelect };
};

const useGlobeCountrySelectionActions = (
  state: GlobeActionState,
  geoData: GlobeGeoData | undefined,
) => {
  const {
    setIsFocusExpanded,
    setIsMobileSheetExpanded,
    setLensLimit,
    setSelectedCountry,
    setSelectedCountryName,
    setSidebarTab,
    setViewMode,
  } = state;
  const handleCountrySelect = useCallback(
    (country: CountrySelection, name?: string | null): void => {
      const resolvedName = resolveCountryName(country, name, geoData);
      applyCountrySelection(
        {
          setIsFocusExpanded,
          setIsMobileSheetExpanded,
          setLensLimit,
          setSelectedCountry,
          setSelectedCountryName,
          setSidebarTab,
          setViewMode,
        },
        country,
        resolvedName,
      );
    },
    [
      geoData,
      setIsFocusExpanded,
      setIsMobileSheetExpanded,
      setLensLimit,
      setSelectedCountry,
      setSelectedCountryName,
      setSidebarTab,
      setViewMode,
    ],
  );
  return { handleCountrySelect };
};

const useGlobeSelectionActions = (state: GlobeActionState, geoData: GlobeGeoData | undefined) => {
  const articleActions = useGlobeArticleSelectionActions(state);
  const countryActions = useGlobeCountrySelectionActions(state, geoData);
  return { ...articleActions, ...countryActions };
};

const nextExpandedSort = (current: ExpandedSortMode): ExpandedSortMode => {
  if (current === "recent") {
    return "oldest";
  }
  if (current === "oldest") {
    return "source";
  }
  return "recent";
};

const useGlobeNavigationActions = (state: GlobeActionState) => {
  const { setSidebarTab } = state;
  const handleQuickNav = useCallback(
    (
      tab: "briefing" | "intelligence" | "sources",
      ref: Readonly<RefObject<HTMLDivElement | null>>,
    ): void => {
      setSidebarTab(tab);
      ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    [setSidebarTab],
  );
  const scrollToSection = useCallback((ref: Readonly<RefObject<HTMLDivElement | null>>): void => {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);
  return { handleQuickNav, scrollToSection };
};

const useGlobeDisplayActions = (state: GlobeActionState) => {
  const { setEarthLightingMode, setExpandedSort, setIsMobileSheetExpanded } = state;
  const cycleExpandedSort = useCallback((): void => {
    setExpandedSort(nextExpandedSort);
  }, [setExpandedSort]);
  const setAllLit = useCallback((): void => {
    setEarthLightingMode("all-lit");
  }, [setEarthLightingMode]);
  const setDayNight = useCallback((): void => {
    setEarthLightingMode("day-night");
  }, [setEarthLightingMode]);
  const toggleMobileSheet = useCallback((): void => {
    setIsMobileSheetExpanded((current) => !current);
  }, [setIsMobileSheetExpanded]);
  return { cycleExpandedSort, setAllLit, setDayNight, toggleMobileSheet };
};

const useGlobeInteractionActions = (state: GlobeActionState, geoData: GlobeGeoData | undefined) => {
  const sheetActions = useSheetDragCallbacks(state.setIsMobileSheetExpanded);
  const selectionActions = useGlobeSelectionActions(state, geoData);
  const navigationActions = useGlobeNavigationActions(state);
  const displayActions = useGlobeDisplayActions(state);
  return {
    ...sheetActions,
    ...selectionActions,
    ...navigationActions,
    ...displayActions,
  };
};
export { useGlobeSelectionState, useGlobeInteractionActions };
export type { LightingMode, LensViewMode, PanelPointerHandler };
