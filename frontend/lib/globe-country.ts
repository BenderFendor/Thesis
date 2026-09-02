interface CountryFeatureProperties {
  ISO_A2?: string
  ADM0_A3?: string
  NAME?: string
  [key: string]: unknown
}

interface CountryFeature {
  properties: CountryFeatureProperties
  geometry?: { coordinates?: unknown } | null
}

interface CountryFeatureCollection {
  features: CountryFeature[]
}

const GEOJSON_ISO_FALLBACKS: Record<string, string> = {
  FRA: "FR",
  NOR: "NO",
}

function getCountryIso(feature: CountryFeature | null): string | null {
  if (!feature) {return null}
  const iso = feature.properties.ISO_A2?.trim()
  if (iso && iso !== "-99") {return iso}

  const adm0 = feature.properties.ADM0_A3?.trim()
  if (!adm0) {return null}
  return GEOJSON_ISO_FALLBACKS[adm0] ?? null
}
export { getCountryIso };
export type { CountryFeatureProperties, CountryFeature, CountryFeatureCollection };
