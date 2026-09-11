import type { DeepReadonly as DeepReadonlyType } from "@/lib/deep-readonly";
import type {
  AtlasEntityRecord,
  parseControls,
  parseExternalIds,
  parseOwnershipChain,
  parseRoleBreakdown,
} from "@/features/intelligence-atlas/lib/atlas-schema";

type DeepReadonly<Value> = DeepReadonlyType<Value>;
type ReadonlyPersonEntity = DeepReadonly<AtlasEntityRecord>;
type ReadonlyOwnershipChain = DeepReadonly<ReturnType<typeof parseOwnershipChain>>;
type ReadonlyControls = DeepReadonly<ReturnType<typeof parseControls>>;
type ReadonlyExternalIds = DeepReadonly<ReturnType<typeof parseExternalIds>>;
type ReadonlyRoleBreakdown = DeepReadonly<ReturnType<typeof parseRoleBreakdown>>;
type PersonWikiViewProps = Readonly<{ entityId: string }>;

interface PersonWikiPanelsProps {
  readonly chain: ReadonlyOwnershipChain;
  readonly controls: ReadonlyControls;
  readonly data: ReadonlyPersonEntity;
}

interface PersonWikiSidebarProps {
  readonly data: ReadonlyPersonEntity;
  readonly externalIds: ReadonlyExternalIds;
  readonly roleBreakdown: ReadonlyRoleBreakdown;
}

export type {
  DeepReadonly,
  PersonWikiPanelsProps,
  PersonWikiSidebarProps,
  PersonWikiViewProps,
  ReadonlyControls,
  ReadonlyExternalIds,
  ReadonlyOwnershipChain,
  ReadonlyPersonEntity,
  ReadonlyRoleBreakdown,
};
