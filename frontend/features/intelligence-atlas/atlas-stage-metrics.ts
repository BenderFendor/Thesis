import type { AtlasGraphResponse } from "./lib/atlas-schema"

type AtlasGraphStats = Readonly<Pick<
  AtlasGraphResponse["stats"],
  | "total_organizations"
  | "total_outlets"
  | "total_people"
  | "total_reporters"
  | "visible_organizations"
  | "visible_outlets"
  | "visible_people"
  | "visible_relationships"
  | "visible_reporters"
>>
type VisibleCountKey = "visible_outlets" | "visible_organizations" | "visible_people" | "visible_reporters"
type TotalCountKey = "total_outlets" | "total_organizations" | "total_people" | "total_reporters"

const ZERO_COUNT = 0,
 resolveEntityCount = (
  currentStats: AtlasGraphStats | undefined,
  currentKey: VisibleCountKey,
  totalStats: AtlasGraphStats | undefined,
  totalKey: TotalCountKey,
): number => currentStats?.[currentKey] ?? totalStats?.[totalKey] ?? ZERO_COUNT,

 resolveRelationshipCount = (currentStats: AtlasGraphStats | undefined): number => (
  currentStats?.visible_relationships ?? ZERO_COUNT
)

export { resolveEntityCount, resolveRelationshipCount }
