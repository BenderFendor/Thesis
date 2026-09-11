import { geoCentroid } from "d3-geo";
import type { CountryArticleCounts, NewsArticle } from "@/lib/api";
import type { CountryFeature, CountryFeatureCollection } from "@/lib/globe-country";
import { getCountryIso } from "@/lib/globe-country";
import type { DeepReadonly } from "@/lib/deep-readonly";
import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { CountryCountMap, PolygonHeat } from "./interactive-globe-visuals";
import {
  ANTLARCTICA_USER_ISO,
  CAP_DEFAULT_COLOR,
  CountryCollectionSchema,
  DEFAULT_POLYGON_ALTITUDE,
  DESKTOP_CLICK_ALTITUDE,
  DESKTOP_DESELECT_ALTITUDE,
  DESKTOP_LAT_OFFSET,
  EMPTY_COUNTS,
  EMPTY_COUNTRY_COLLECTION,
  FOCUS_TRANSITION_MS,
  MOBILE_BREAKPOINT,
  MOBILE_CLICK_ALTITUDE,
  MOBILE_LAT_OFFSET,
  MOBILE_OVERVIEW_ALTITUDE,
  LOCAL_COUNTRY_GEOJSON_URL,
  SIDE_DEFAULT_COLOR,
  STROKE_DEFAULT_COLOR,
  UNKNOWN_ISO_LABEL,
  buildCountryLabel,
  chooseSourceCounts,
  computeCapColor,
  computePolygonAltitude,
  computePolygonHeatFast,
  computeSideColor,
  computeStrokeColor,
  countArticleSourceCountries,
  getFeatureCenter,
  maxValue,
  parseCountryFeature,
  remapCountryCounts,
} from "./interactive-globe-visuals";
import type { GlobeInstance, GlobePolygon, InteractiveGlobeProps } from "./interactive-globe-types";

interface CountryCenter {
  readonly lat: number;
  readonly lng: number;
}

interface ReadonlyCountryFeature {
  readonly geometry?: Readonly<{ coordinates?: unknown }> | null;
  readonly properties: Readonly<CountryFeature["properties"]>;
}

interface PolygonContext {
  readonly displayCounts: CountryCountMap;
  readonly maxCount: number;
  readonly maxMentionCount: number;
  readonly mentionCounts: CountryCountMap;
}

interface PolygonPresentationContext extends PolygonContext {
  readonly globeInstance: GlobeInstance | null;
  readonly onCountrySelect: InteractiveGlobeProps["onCountrySelect"];
  readonly selectedCountry: string | null;
}

interface PolygonPresentation {
  readonly handlePolygonClick: (polygon: GlobePolygon) => void;
  readonly handlePolygonHover: (polygon: GlobePolygon | null) => void;
  readonly polygonAltitude: (polygon: GlobePolygon) => number;
  readonly polygonCapColor: (polygon: GlobePolygon) => string;
  readonly polygonLabel: (polygon: GlobePolygon) => string;
  readonly polygonSideColor: (polygon: GlobePolygon) => string;
  readonly polygonStrokeColor: (polygon: GlobePolygon) => string;
}

interface PolygonHeatData {
  readonly feature: CountryFeature;
  readonly heat: PolygonHeat;
}

interface PolygonSelection {
  readonly feature: CountryFeature;
  readonly iso: string;
}

interface GlobeCountryData {
  readonly countryCenters: Readonly<Record<string, CountryCenter>>;
  readonly visibleCountries: CountryFeature[];
}

const useGlobeCounts = (
  articles: readonly DeepReadonly<NewsArticle>[],
  countryMetrics: DeepReadonly<CountryArticleCounts> | null | undefined,
  visibleCountries: readonly ReadonlyCountryFeature[],
): PolygonContext => {
  const fallbackSourceCounts = useMemo(() => countArticleSourceCountries(articles), [articles]);
  const sourceOriginCounts = chooseSourceCounts(
    countryMetrics?.source_counts,
    fallbackSourceCounts,
  );
  const metricMentionCounts = countryMetrics?.counts ?? EMPTY_COUNTS;
  const displayCounts = useMemo(
    () => remapCountryCounts(sourceOriginCounts, visibleCountries),
    [sourceOriginCounts, visibleCountries],
  );
  const mentionCounts = useMemo(
    () => remapCountryCounts(metricMentionCounts, visibleCountries),
    [metricMentionCounts, visibleCountries],
  );
  const maxCount = useMemo(() => maxValue(displayCounts), [displayCounts]);
  const maxMentionCount = useMemo(() => maxValue(mentionCounts), [mentionCounts]);
  return { displayCounts, maxCount, maxMentionCount, mentionCounts };
};

const loadCountryCollection = async (): Promise<CountryFeatureCollection> => {
  const response = await fetch(LOCAL_COUNTRY_GEOJSON_URL);
  if (!response.ok) {
    return EMPTY_COUNTRY_COLLECTION;
  }
  const parsed = CountryCollectionSchema.safeParse(await response.json());
  if (!parsed.success) {
    return EMPTY_COUNTRY_COLLECTION;
  }
  return parsed.data;
};

const useGlobeCountryData = (): GlobeCountryData => {
  const countriesQuery = useQuery<CountryFeatureCollection>({
    gcTime: Infinity,
    queryFn: loadCountryCollection,
    queryKey: ["globe-countries"],
    refetchOnWindowFocus: false,
    retry: 1,
    staleTime: Infinity,
  });
  const countries = countriesQuery.data ?? EMPTY_COUNTRY_COLLECTION;
  const visibleCountries = useMemo(
    () => countries.features.filter((feature) => getCountryIso(feature) !== ANTLARCTICA_USER_ISO),
    [countries.features],
  );
  const countryCenters = useMemo(() => {
    const centers: Record<string, CountryCenter> = {};
    countries.features.forEach((feature) => {
      const iso = getCountryIso(feature);
      if (iso === null) {
        return;
      }
      const center = getFeatureCenter(feature.geometry);
      if (center) {
        centers[iso] = center;
      }
    });
    return centers;
  }, [countries]);
  return { countryCenters, visibleCountries };
};

const getDeselectAltitude = (): number => {
  if (globalThis.innerWidth < MOBILE_BREAKPOINT) {
    return MOBILE_OVERVIEW_ALTITUDE;
  }
  return DESKTOP_DESELECT_ALTITUDE;
};

const getClickAltitude = (): number => {
  if (globalThis.innerWidth < MOBILE_BREAKPOINT) {
    return MOBILE_CLICK_ALTITUDE;
  }
  return DESKTOP_CLICK_ALTITUDE;
};

const getClickLatitudeOffset = (): number => {
  if (globalThis.innerWidth < MOBILE_BREAKPOINT) {
    return MOBILE_LAT_OFFSET;
  }
  return DESKTOP_LAT_OFFSET;
};

const deselectCountry = (
  globeInstance: GlobeInstance | null,
  onCountrySelect: PolygonPresentationContext["onCountrySelect"],
): void => {
  onCountrySelect(null, null);
  globeInstance?.pointOfView({ altitude: getDeselectAltitude() }, FOCUS_TRANSITION_MS);
};

const focusCountry = (
  globeInstance: GlobeInstance | null,
  feature: ReadonlyCountryFeature,
): void => {
  const [lng, lat] = geoCentroid(feature);
  globeInstance?.pointOfView(
    { altitude: getClickAltitude(), lat: lat + getClickLatitudeOffset(), lng },
    FOCUS_TRANSITION_MS,
  );
};

const createPolygonClickHandler =
  (
    globeInstance: GlobeInstance | null,
    onCountrySelect: PolygonPresentationContext["onCountrySelect"],
    selectedCountry: string | null,
  ): ((polygon: GlobePolygon) => void) =>
  (polygon) => {
    const selection = getPolygonSelection(polygon);
    if (selection === null) {
      return;
    }
    if (selectedCountry === selection.iso) {
      deselectCountry(globeInstance, onCountrySelect);
      return;
    }
    onCountrySelect(selection.iso, selection.feature.properties.NAME);
    focusCountry(globeInstance, selection.feature);
  };

const getPolygonSelection = (polygon: GlobePolygon): PolygonSelection | null => {
  const feature = parseCountryFeature(polygon);
  if (feature === null) {
    return null;
  }
  const iso = getCountryIso(feature);
  if (iso === null) {
    return null;
  }
  return { feature, iso };
};

const getPolygonHeatData = (
  polygon: GlobePolygon,
  context: PolygonContext,
): PolygonHeatData | null => {
  const feature = parseCountryFeature(polygon);
  if (feature === null) {
    return null;
  }
  const heat = computePolygonHeatFast(feature, context);
  if (heat === null) {
    return null;
  }
  return { feature, heat };
};

const getPolygonAltitude = (
  polygon: GlobePolygon,
  context: PolygonContext,
  hoverD: ReadonlyCountryFeature | null,
  selectedCountry: string | null,
): number => {
  const heatData = getPolygonHeatData(polygon, context);
  if (heatData === null) {
    return DEFAULT_POLYGON_ALTITUDE;
  }
  return computePolygonAltitude(heatData.feature, heatData.heat, hoverD, selectedCountry);
};

const getPolygonCapColor = (
  polygon: GlobePolygon,
  context: PolygonContext,
  hoverD: ReadonlyCountryFeature | null,
  selectedCountry: string | null,
): string => {
  const heatData = getPolygonHeatData(polygon, context);
  if (heatData === null) {
    return CAP_DEFAULT_COLOR;
  }
  return computeCapColor(heatData.feature, heatData.heat, context, hoverD, selectedCountry);
};

const getPolygonSideColor = (
  polygon: GlobePolygon,
  context: PolygonContext,
  hoverD: ReadonlyCountryFeature | null,
  selectedCountry: string | null,
): string => {
  const heatData = getPolygonHeatData(polygon, context);
  if (heatData === null) {
    return SIDE_DEFAULT_COLOR;
  }
  return computeSideColor(heatData.feature, heatData.heat, hoverD, selectedCountry);
};

const getPolygonStrokeColor = (
  polygon: GlobePolygon,
  context: PolygonContext,
  hoverD: ReadonlyCountryFeature | null,
  selectedCountry: string | null,
): string => {
  const heatData = getPolygonHeatData(polygon, context);
  if (heatData === null) {
    return STROKE_DEFAULT_COLOR;
  }
  return computeStrokeColor(heatData.feature, heatData.heat, hoverD, selectedCountry);
};

const getPolygonLabel = (
  polygon: GlobePolygon,
  context: PolygonContext,
  selectedCountry: string | null,
): string => {
  const feature = parseCountryFeature(polygon);
  if (feature === null) {
    return "";
  }
  const iso = getCountryIso(feature) ?? UNKNOWN_ISO_LABEL;
  if (selectedCountry === iso) {
    return "";
  }
  return buildCountryLabel(feature, context.displayCounts, context.mentionCounts);
};

type PolygonStyleCallbacks = Pick<
  PolygonPresentation,
  "polygonAltitude" | "polygonCapColor" | "polygonLabel" | "polygonSideColor" | "polygonStrokeColor"
>;

const usePolygonStyleCallbacks = (
  polygonStyleContext: PolygonContext,
  hoverD: ReadonlyCountryFeature | null,
  selectedCountry: string | null,
): PolygonStyleCallbacks => {
  const polygonAltitude = useCallback(
    (polygon: GlobePolygon): number =>
      getPolygonAltitude(polygon, polygonStyleContext, hoverD, selectedCountry),
    [hoverD, polygonStyleContext, selectedCountry],
  );
  const polygonCapColor = useCallback(
    (polygon: GlobePolygon): string =>
      getPolygonCapColor(polygon, polygonStyleContext, hoverD, selectedCountry),
    [hoverD, polygonStyleContext, selectedCountry],
  );
  const polygonSideColor = useCallback(
    (polygon: GlobePolygon): string =>
      getPolygonSideColor(polygon, polygonStyleContext, hoverD, selectedCountry),
    [hoverD, polygonStyleContext, selectedCountry],
  );
  const polygonStrokeColor = useCallback(
    (polygon: GlobePolygon): string =>
      getPolygonStrokeColor(polygon, polygonStyleContext, hoverD, selectedCountry),
    [hoverD, polygonStyleContext, selectedCountry],
  );
  const polygonLabel = useCallback(
    (polygon: GlobePolygon): string =>
      getPolygonLabel(polygon, polygonStyleContext, selectedCountry),
    [polygonStyleContext, selectedCountry],
  );
  return {
    polygonAltitude,
    polygonCapColor,
    polygonLabel,
    polygonSideColor,
    polygonStrokeColor,
  };
};

const usePolygonPresentation = (context: PolygonPresentationContext): PolygonPresentation => {
  const {
    displayCounts,
    globeInstance,
    maxCount,
    maxMentionCount,
    mentionCounts,
    onCountrySelect,
    selectedCountry,
  } = context;
  const [hoverD, setHoverD] = useState<CountryFeature | null>(null);
  const polygonStyleContext = useMemo<PolygonContext>(
    () => ({ displayCounts, maxCount, maxMentionCount, mentionCounts }),
    [displayCounts, maxCount, maxMentionCount, mentionCounts],
  );
  const handlePolygonHover = useCallback(
    (polygon: GlobePolygon | null): void => {
      setHoverD(parseCountryFeature(polygon));
    },
    [setHoverD],
  );
  const handlePolygonClick = useMemo(
    () => createPolygonClickHandler(globeInstance, onCountrySelect, selectedCountry),
    [globeInstance, onCountrySelect, selectedCountry],
  );
  const styles = usePolygonStyleCallbacks(polygonStyleContext, hoverD, selectedCountry);
  return {
    handlePolygonClick,
    handlePolygonHover,
    ...styles,
  };
};

export { type GlobeCountryData, useGlobeCounts, useGlobeCountryData, usePolygonPresentation };
