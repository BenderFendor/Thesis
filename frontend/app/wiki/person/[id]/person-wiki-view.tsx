"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchAtlasEntity } from "@/features/intelligence-atlas/lib/atlas-api";
import {
  parseControls,
  parseExternalIds,
  parseOwnershipChain,
  parseRoleBreakdown,
} from "@/features/intelligence-atlas/lib/atlas-schema";
import { renderPersonWiki } from "./person-wiki-shell";
import type {
  PersonWikiViewProps,
  ReadonlyControls,
  ReadonlyExternalIds,
  ReadonlyOwnershipChain,
  ReadonlyPersonEntity,
  ReadonlyRoleBreakdown,
} from "./person-wiki-types";

type PersonWikiDerivedData = Readonly<{
  chain: ReadonlyOwnershipChain | undefined;
  controls: ReadonlyControls | undefined;
  externalIds: ReadonlyExternalIds | undefined;
  roleBreakdown: ReadonlyRoleBreakdown | undefined;
}>;

const getPersonWikiDerivedData = (
  data: ReadonlyPersonEntity | undefined,
): PersonWikiDerivedData => {
  if (data === undefined) {
    return {
      chain: undefined,
      controls: undefined,
      externalIds: undefined,
      roleBreakdown: undefined,
    };
  }
  return {
    chain: parseOwnershipChain(data.details),
    controls: parseControls(data.details),
    externalIds: parseExternalIds(data.details),
    roleBreakdown: parseRoleBreakdown(data.details),
  };
};

const PersonWikiView = (props: PersonWikiViewProps) => {
  const { data, error, isLoading } = useQuery<ReadonlyPersonEntity>({
    enabled: props.entityId.length > 0,
    queryFn: () => fetchAtlasEntity(props.entityId),
    queryKey: ["atlas-entity", props.entityId],
    retry: 1,
  });
  const derived = getPersonWikiDerivedData(data);
  return renderPersonWiki({ data, error, isLoading, ...derived });
};

export { PersonWikiView };
