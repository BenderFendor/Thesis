"use client";

import {
  parseControls,
  parseExternalIds,
  parseFundingAndBias,
  parseOwnershipChain,
  parseRoleBreakdown,
} from "@/features/intelligence-atlas/lib/atlas-schema";
import { fetchAtlasEntity } from "@/features/intelligence-atlas/lib/atlas-api";
import { useQuery } from "@tanstack/react-query";
import type {
  AtlasEntityRecord,
  OrganizationContentProps,
  OrganizationWikiViewProps,
} from "./organization-wiki-view-types";
import { RETRY_COUNT } from "./organization-wiki-view-types";
import {
  OrganizationErrorState,
  OrganizationLayout,
  OrganizationLoadingState,
  OrganizationMain,
  OrganizationPageShell,
} from "./organization-wiki-view-parts";
import { OrganizationSidebar } from "./organization-wiki-view-sidebar";

const OrganizationContent = ({ data }: OrganizationContentProps) => {
    const chain = parseOwnershipChain(data.details),
      controls = parseControls(data.details),
      externalIds = parseExternalIds(data.details),
      fundingAndBias = parseFundingAndBias(data.details) ?? undefined,
      roleBreakdown = parseRoleBreakdown(data.details);

    return (
      <OrganizationPageShell contentClassName="flex-1 overflow-y-auto relative z-10 custom-scrollbar">
        <OrganizationLayout>
          <OrganizationSidebar
            data={data}
            externalIds={externalIds}
            roleBreakdown={roleBreakdown}
          />
          <OrganizationMain
            chain={chain}
            connections={data.connections}
            controls={controls}
            evidence={data.evidence}
            fundingAndBias={fundingAndBias}
            entityId={data.id}
          />
        </OrganizationLayout>
      </OrganizationPageShell>
    );
  };
const OrganizationWikiView = ({ entityId }: OrganizationWikiViewProps) => {
    const { data, error, isLoading } = useQuery<AtlasEntityRecord>({
      enabled: Boolean(entityId),
      queryFn: () => fetchAtlasEntity(entityId),
      queryKey: ["atlas-entity", entityId],
      retry: RETRY_COUNT,
    });

    if (isLoading) {
      return <OrganizationLoadingState />;
    }

    const queryError = error ?? undefined;
    if (queryError !== undefined || data === undefined) {
      return <OrganizationErrorState error={queryError} />;
    }

    return <OrganizationContent data={data} />;
  };
export { OrganizationWikiView };
