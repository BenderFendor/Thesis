"use client";

import type { ReactElement } from "react";
import { useCallback, useMemo, useState } from "react";
import { fetchBlindspotViewer } from "@/lib/api";
import { serializeSources } from "@/lib/utils";
import type { DeepReadonly } from "@/lib/deep-readonly";
import { useQuery } from "@tanstack/react-query";
import { BlindspotControls } from "@/components/blindspot-view-controls";
import { BlindspotLaneSections } from "@/components/blindspot-view-lanes";
import {
  BlindspotClusterModal,
  BlindspotErrorState,
  BlindspotLoadingState,
  BlindspotOfflineState,
} from "@/components/blindspot-view-states";
import {
  CARDS_PER_LANE,
  DEFAULT_LENS,
  DEFAULT_WINDOW,
  EMPTY_BLINDSPOT_CARDS,
  cardToCluster,
  createLaneMap,
  getPoleLabels,
  sortCards,
} from "@/components/blindspot-view-helpers";
import type {
  BlindspotResultsProps,
  BlindspotViewServices,
  ReadonlyBlindspotCard,
  ReadonlyBlindspotLens,
  ReadonlyBlindspotServices,
  ReadonlyBlindspotViewProps,
  SortMode,
} from "@/components/blindspot-view-types";

const DEFAULT_BLINDSPOT_VIEW_SERVICES: BlindspotViewServices = {
  fetchBlindspotViewer,
};

const useBlindspotData = (
  category: string | undefined,
  selectedLens: ReadonlyBlindspotLens["id"],
  sortMode: SortMode,
  sources: readonly string[] | undefined,
  services: ReadonlyBlindspotServices,
) => {
  const serializedSources = useMemo(() => serializeSources(sources), [sources]);
  const query = useQuery({
    gcTime: 5 * 60 * 1000,
    queryFn: () =>
      services.fetchBlindspotViewer({
        category,
        lens: selectedLens,
        perLane: CARDS_PER_LANE,
        sources: serializedSources,
        window: DEFAULT_WINDOW,
      }),
    queryKey: [
      "blindspots",
      "viewer",
      { category: category ?? "all", lens: selectedLens, sources: serializedSources },
    ],
    refetchOnWindowFocus: false,
    staleTime: 30 * 1000,
  });
  const { refetch } = query;
  const handleRetry = useCallback(() => {
    void refetch();
  }, [refetch]);
  const sortedCards = useMemo(() => {
    if (query.data === undefined) {
      return EMPTY_BLINDSPOT_CARDS;
    }
    return sortCards(query.data.cards, sortMode);
  }, [query.data, sortMode]);
  const laneMap = useMemo(
    () => createLaneMap(query.data?.lanes ?? [], sortedCards),
    [query.data, sortedCards],
  );
  const poleLabels = useMemo(() => getPoleLabels(query.data?.lanes), [query.data]);
  return {
    data: query.data,
    error: query.error,
    handleRetry,
    isLoading: query.isLoading,
    laneMap,
    poleLabels,
  };
};

const useBlindspotFilters = () => {
  const [selectedLens, setSelectedLens] = useState<ReadonlyBlindspotLens["id"]>(DEFAULT_LENS);
  const [sortMode, setSortMode] = useState<SortMode>("asymmetry");
  const handleLensChange = useCallback((lens: ReadonlyBlindspotLens["id"]) => {
    setSelectedLens(lens);
  }, []);
  const handleSortChange = useCallback((mode: SortMode) => {
    setSortMode(mode);
  }, []);
  return { handleLensChange, handleSortChange, selectedLens, sortMode };
};

const useBlindspotCards = () => {
  const [selectedCard, setSelectedCard] = useState<ReadonlyBlindspotCard | null>(null);
  const [expandedLanes, setExpandedLanes] = useState<
    Record<"pole_a" | "pole_b" | "shared", boolean>
  >({
    pole_a: false,
    pole_b: false,
    shared: false,
  });
  const selectedCluster = useMemo(() => {
    if (selectedCard === null) {
      return null;
    }
    return cardToCluster(selectedCard);
  }, [selectedCard]);
  const handleExpandLane = useCallback((laneId: "pole_a" | "pole_b" | "shared") => {
    setExpandedLanes((current) => ({ ...current, [laneId]: true }));
  }, []);
  const handleClose = useCallback(() => {
    setSelectedCard(null);
  }, []);
  const handleOpenCard = useCallback((card: ReadonlyBlindspotCard) => {
    setSelectedCard(card);
  }, []);
  return {
    expandedLanes,
    handleClose,
    handleExpandLane,
    handleOpenCard,
    selectedCard,
    selectedCluster,
  };
};

const useBlindspotSelection = () => {
  const filters = useBlindspotFilters();
  const cards = useBlindspotCards();
  return { ...cards, ...filters };
};

const BlindspotLaneContent = (
  props: DeepReadonly<
    Pick<
      BlindspotResultsProps,
      "data" | "expandedLanes" | "laneMap" | "onExpandLane" | "onOpenCard" | "poleLabels"
    >
  >,
): ReactElement => {
  if (props.data.selected_lens.available) {
    return (
      <BlindspotLaneSections
        expandedLanes={props.expandedLanes}
        laneMap={props.laneMap}
        onExpandLane={props.onExpandLane}
        onOpenCard={props.onOpenCard}
        poleLabels={props.poleLabels}
      />
    );
  }
  return (
    <BlindspotOfflineState
      label={props.data.selected_lens.label}
      reason={props.data.selected_lens.unavailable_reason}
    />
  );
};

const BlindspotResultsControls = (
  props: DeepReadonly<
    Pick<
      BlindspotResultsProps,
      "data" | "onLensChange" | "onSortChange" | "selectedLens" | "sortMode"
    >
  >,
): ReactElement => (
  <BlindspotControls
    availableLenses={props.data.available_lenses}
    onLensChange={props.onLensChange}
    onSortChange={props.onSortChange}
    selectedLens={props.selectedLens}
    sortMode={props.sortMode}
  />
);

const BlindspotResults = (props: DeepReadonly<BlindspotResultsProps>): ReactElement => (
  <div className="flex flex-col space-y-10 p-4 sm:p-6 lg:space-y-16 lg:p-10">
    <BlindspotResultsControls
      data={props.data}
      onLensChange={props.onLensChange}
      onSortChange={props.onSortChange}
      selectedLens={props.selectedLens}
      sortMode={props.sortMode}
    />
    <BlindspotLaneContent
      data={props.data}
      expandedLanes={props.expandedLanes}
      laneMap={props.laneMap}
      onExpandLane={props.onExpandLane}
      onOpenCard={props.onOpenCard}
      poleLabels={props.poleLabels}
    />
  </div>
);

const BlindspotView = (props: ReadonlyBlindspotViewProps): ReactElement | null => {
  const { category, services = DEFAULT_BLINDSPOT_VIEW_SERVICES, sources } = props;
  const selection = useBlindspotSelection();
  const { data, error, handleRetry, isLoading, laneMap, poleLabels } = useBlindspotData(
    category,
    selection.selectedLens,
    selection.sortMode,
    sources,
    services,
  );
  if (isLoading && data === undefined) {
    return <BlindspotLoadingState />;
  }
  if (error instanceof Error) {
    return <BlindspotErrorState message={error.message} onRetry={handleRetry} />;
  }
  if (data === undefined) {
    return null;
  }
  return (
    <>
      <BlindspotResults
        data={data}
        expandedLanes={selection.expandedLanes}
        laneMap={laneMap}
        onExpandLane={selection.handleExpandLane}
        onOpenCard={selection.handleOpenCard}
        poleLabels={poleLabels}
        selectedLens={selection.selectedLens}
        sortMode={selection.sortMode}
        onLensChange={selection.handleLensChange}
        onSortChange={selection.handleSortChange}
      />
      <BlindspotClusterModal cluster={selection.selectedCluster} onClose={selection.handleClose} />
    </>
  );
};

export { BlindspotView };
export type { BlindspotViewServices } from "@/components/blindspot-view-types";
