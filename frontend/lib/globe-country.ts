import { hasText } from "@/lib/utils";
interface CountryFeatureProperties {
  readonly ISO_A2?: string;
  readonly ADM0_A3?: string;
  readonly NAME?: string;
}

interface CountryFeature {
  readonly properties: CountryFeatureProperties;
  readonly geometry?: { readonly coordinates?: unknown } | null;
}

interface CountryFeatureCollection {
  readonly features: readonly CountryFeature[];
}

const getFallbackIso = (adm0: string): string | null => {
  if (adm0 === "FRA") {
    return "FR";
  }
  if (adm0 === "NOR") {
    return "NO";
  }
  return null;
};

const getCountryIso = (feature: CountryFeature | null): string | null => {
  if (!feature) {
    return null;
  }
  const iso = feature.properties.ISO_A2?.trim();
  if (hasText(iso) && iso !== "-99") {
    return iso;
  }

  const adm0 = feature.properties.ADM0_A3?.trim();
  if (!hasText(adm0)) {
    return null;
  }
  return getFallbackIso(adm0);
};
export { getCountryIso };
export type { CountryFeature, CountryFeatureCollection };
