import type { DeepReadonly } from "@/lib/deep-readonly";
import type { NewsArticle } from "@/lib/api";
import { CountryFeatureSchema, ZERO_COUNT } from "./interactive-globe-visuals-config";
import { polygonHeat } from "./interactive-globe-visuals-helpers";
import type {
  CountryFeature,
  CountryCountMap,
  GlobePolygon,
  MutableCountryCountMap,
  PolygonContext,
  PolygonHeat,
  ReadonlyCountryFeature,
} from "./interactive-globe-visuals-types";

const parseCountryFeature = (polygon: GlobePolygon | null): CountryFeature | null => {
  if (polygon === null) {
    return null;
  }
  const parsed = CountryFeatureSchema.safeParse(polygon);
  if (!parsed.success) {
    return null;
  }
  return parsed.data;
};

const EMPTY_COUNTS: CountryCountMap = {};

const countArticleSourceCountries = (articles: readonly DeepReadonly<NewsArticle>[]) => {
  const counts: MutableCountryCountMap = {};
  articles.forEach((article) => {
    const sourceCountry = article.source_country ?? article.country;
    if (
      sourceCountry === null ||
      sourceCountry === undefined ||
      sourceCountry === "" ||
      sourceCountry === "International"
    ) {
      return;
    }
    counts[sourceCountry] = (counts[sourceCountry] ?? ZERO_COUNT) + 1;
  });
  return counts satisfies CountryCountMap;
};

const chooseSourceCounts = (
  sourceCounts: CountryCountMap | undefined,
  fallbackCounts: CountryCountMap,
): CountryCountMap => {
  if (sourceCounts !== undefined && Object.keys(sourceCounts).length > ZERO_COUNT) {
    return sourceCounts;
  }
  return fallbackCounts;
};
const computePolygonHeatFast = (
  polygon: ReadonlyCountryFeature,
  context: Readonly<PolygonContext>,
): PolygonHeat | null => {
  const feature = parseCountryFeature(polygon);
  if (feature === null) {
    return null;
  }
  return polygonHeat(
    feature,
    context.displayCounts,
    context.mentionCounts,
    context.maxCount,
    context.maxMentionCount,
  );
};

const maxValue = (counts: CountryCountMap): number => {
  const values = Object.values(counts);
  if (values.length === ZERO_COUNT) {
    return ZERO_COUNT;
  }
  return Math.max(...values);
};
export type * from "./interactive-globe-visuals-types";
export * from "./interactive-globe-visuals-config";
export * from "./interactive-globe-visuals-shaders";
export * from "./interactive-globe-visuals-materials";
export * from "./interactive-globe-visuals-helpers";
export {
  parseCountryFeature,
  countArticleSourceCountries,
  chooseSourceCounts,
  computePolygonHeatFast,
  maxValue,
  EMPTY_COUNTS,
};
