import type { fetchAtlasEntity } from "@/features/intelligence-atlas/lib/atlas-api";
import type {
  parseControls,
  parseFundingAndBias,
  parseOwnershipChain,
} from "@/features/intelligence-atlas/lib/atlas-schema";
import type { DeepReadonly } from "@/lib/deep-readonly";
import type { ReactElement } from "react";

type AtlasEntityRecord = Awaited<ReturnType<typeof fetchAtlasEntity>>;
type AtlasConnectionRecord = AtlasEntityRecord["connections"][number];

type AtlasControlsEntry = ReturnType<typeof parseControls>[number];

type AtlasFundingAndBias = DeepReadonly<NonNullable<ReturnType<typeof parseFundingAndBias>>>;
type AtlasOwnershipChainHop = DeepReadonly<ReturnType<typeof parseOwnershipChain>[number]>;
type DetailValue = AtlasEntityRecord["details"][string];

interface AtlasConnectionView {
  readonly edge: {
    readonly direction: AtlasConnectionRecord["edge"]["direction"];
    readonly evidence_count: number;
    readonly fact_status: AtlasConnectionRecord["edge"]["fact_status"];
    readonly id: string;
    readonly relation_type: AtlasConnectionRecord["edge"]["relation_type"];
  };
  readonly entity: { readonly label: string; readonly profile_path?: string | null };
}
interface AtlasControlView {
  readonly entity_id: string;
  readonly entity_type: AtlasControlsEntry["entity_type"];
  readonly evidence_count: number;
  readonly label: string;
  readonly percentage?: number | null;
  readonly profile_path?: string | null;
}
type AtlasDetailsView = Readonly<Record<string, DetailValue>>;
interface AtlasEvidenceView {
  readonly excerpt?: string | null;
  readonly id: string;
  readonly retrieved_at?: string | null;
  readonly source_name?: string | null;
  readonly source_type: string;
  readonly source_url?: string | null;
}
interface AtlasExternalIdView {
  readonly scheme: string;
  readonly url?: string | null;
  readonly value: string;
}
interface OrganizationDataView {
  readonly confidence_tier?: string | null;
  readonly connections: readonly AtlasConnectionView[];
  readonly details: AtlasDetailsView;
  readonly evidence: readonly AtlasEvidenceView[];
  readonly id: string;
  readonly label: string;
  readonly last_verified_at?: string | null;
  readonly status?: string | null;
  readonly subtitle?: string | null;
}
interface BadgeProps {
  readonly value: string | null | undefined;
}
interface ConnectionRowProps {
  readonly connection: AtlasConnectionView;
}
interface ConnectionStatusProps {
  readonly connection: AtlasConnectionView;
}
interface ConnectionsPanelProps {
  readonly connections: readonly AtlasConnectionView[];
}
interface ControlCardProps {
  readonly entry: AtlasControlView;
}
interface ControlsPanelProps {
  readonly controls: readonly AtlasControlView[];
}
interface ErrorStateProps {
  readonly error: Error | null | undefined;
}
interface EvidenceCardProps {
  readonly item: AtlasEvidenceView;
}
interface EvidenceDateProps {
  readonly value: string | null | undefined;
}
interface EvidenceDetailsProps {
  readonly item: AtlasEvidenceView;
}
interface EvidencePanelProps {
  readonly evidence: readonly AtlasEvidenceView[];
}
interface EvidenceSourceLinkProps {
  readonly value: string | null | undefined;
}
interface ExternalIdentifierProps {
  readonly identifier: AtlasExternalIdView;
}
interface ExternalIdentifiersCardProps {
  readonly externalIds: readonly AtlasExternalIdView[];
}
interface ExternalIdentifierValueProps {
  readonly label: string;
  readonly url: string | undefined;
}
interface FundingAndBiasSectionProps {
  readonly block: AtlasFundingAndBias | undefined;
}
interface OrganizationContentProps {
  readonly data: OrganizationDataView;
}
interface OrganizationLayoutProps {
  readonly children: Readonly<ReactElement> | readonly Readonly<ReactElement>[];
}
interface OrganizationMainProps {
  readonly chain: readonly AtlasOwnershipChainHop[];
  readonly connections: readonly AtlasConnectionView[];
  readonly controls: readonly AtlasControlView[];
  readonly evidence: readonly AtlasEvidenceView[];
  readonly fundingAndBias: AtlasFundingAndBias | undefined;
  readonly entityId: string;
}
interface OrganizationSidebarProps {
  readonly data: OrganizationDataView;
  readonly externalIds: readonly AtlasExternalIdView[];
  readonly roleBreakdown: Readonly<Record<string, number>>;
}
interface OrganizationWikiViewProps {
  readonly entityId: string;
}
interface OwnershipPanelProps {
  readonly chain: readonly AtlasOwnershipChainHop[];
  readonly currentEntityId: string;
}
interface PageShellProps {
  readonly children: Readonly<ReactElement> | readonly Readonly<ReactElement>[];
  readonly contentClassName: string;
}
interface PanelEmptyMessageProps {
  readonly children: string;
  readonly icon?: boolean;
}
interface PercentageProps {
  readonly value: number | null | undefined;
}
interface RoleBreakdownEntryProps {
  readonly count: number;
  readonly role: string;
}
interface RoleBreakdownCardProps {
  readonly roleBreakdown: Readonly<Record<string, number>>;
}
interface OptionalSidebarFactProps {
  readonly label: string;
  readonly value: string | undefined;
}
interface VerifiedDateFactProps {
  readonly value: string | null | undefined;
}

const ATLAS_HREF = "/wiki/ownership";
const DECIMAL_PLACES = 1;
const EMPTY_COUNT = 0;
const RETRY_COUNT = 1;
const SINGLE_ITEM_COUNT = 1;
const getErrorMessage = (error: Error | null | undefined): string => {
    if (error instanceof Error) {
      return error.message;
    }

    return "Organization not found";
  };
const getEvidenceSourceLabel = (item: AtlasEvidenceView): string => {
    const sourceName = getNonEmptyText(item.source_name);
    if (sourceName !== undefined) {
      return sourceName;
    }

    return item.source_type;
  };
const getNonEmptyText = (value: string | null | undefined): string | undefined => {
    const text = value ?? undefined;
    if (text !== undefined && text.length > EMPTY_COUNT) {
  return text;
}
return void 0;
  };
const getStringDetail = (value: DetailValue): string | undefined =>
    (() => {
  if (isStringDetail(value)) {
    return value;
  }
  return void 0;
})();
const isStringDetail = (value: DetailValue): value is string => typeof value === "string";

export type {
  AtlasConnectionView,
  AtlasControlView,
  AtlasEntityRecord,
  AtlasEvidenceView,
  AtlasExternalIdView,
  BadgeProps,
  ConnectionRowProps,
  ConnectionStatusProps,
  ConnectionsPanelProps,
  ControlCardProps,
  ControlsPanelProps,
  ErrorStateProps,
  EvidenceCardProps,
  EvidenceDateProps,
  EvidenceDetailsProps,
  EvidencePanelProps,
  EvidenceSourceLinkProps,
  ExternalIdentifierProps,
  ExternalIdentifiersCardProps,
  ExternalIdentifierValueProps,
  FundingAndBiasSectionProps,
  OrganizationContentProps,
  OrganizationLayoutProps,
  OrganizationMainProps,
  OrganizationSidebarProps,
  OrganizationWikiViewProps,
  OptionalSidebarFactProps,
  OwnershipPanelProps,
  PageShellProps,
  PanelEmptyMessageProps,
  PercentageProps,
  RoleBreakdownCardProps,
  RoleBreakdownEntryProps,
  VerifiedDateFactProps,
};

export {
  ATLAS_HREF,
  DECIMAL_PLACES,
  EMPTY_COUNT,
  RETRY_COUNT,
  SINGLE_ITEM_COUNT,
  getErrorMessage,
  getEvidenceSourceLabel,
  getNonEmptyText,
  getStringDetail,
};
