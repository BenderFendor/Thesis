"use client";

import { useCallback, useState } from "react";
import type { ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchWikiSource } from "@/lib/api";
import { fetchAtlasEntity, searchAtlas } from "@/features/intelligence-atlas/lib/atlas-api";
import {
  getAverageScore,
  getFundingAndBias,
  getOwnershipChain,
  runWikiIndex,
  useEmbeddedFlag,
} from "./source-wiki-helpers";
import { renderSourceWikiContent } from "./source-wiki-shell";
import type { ReadonlySourceProfile, SourceWikiViewProps } from "./source-wiki-types";

const SourceWikiView = (props: SourceWikiViewProps): ReactElement | null => {
  const embedded = useEmbeddedFlag();
  const [indexing, setIndexing] = useState(false);
  const { data, error, isLoading, refetch } = useQuery<ReadonlySourceProfile>({
    queryFn: () => fetchWikiSource(props.sourceName),
    queryKey: ["wiki-source", props.sourceName],
    retry: 1,
  });
  const { data: atlasSearch } = useQuery({
    enabled: props.sourceName.length > 0,
    queryFn: () => searchAtlas(props.sourceName),
    queryKey: ["wiki-source-atlas-search", props.sourceName],
    retry: 1,
  });
  const outletEntityId =
    atlasSearch?.outlets.find((item) => item.label.toLowerCase() === props.sourceName.toLowerCase())
      ?.id ?? atlasSearch?.outlets[0]?.id;
  const { data: outletAtlasEntity } = useQuery({
    enabled: outletEntityId !== undefined,
    queryFn: () => fetchAtlasEntity(outletEntityId ?? ""),
    queryKey: ["wiki-source-atlas-entity", outletEntityId],
    retry: 1,
  });
  const handleIndex = useCallback(() => {
    void runWikiIndex({
      refetch: async () => {
        await refetch();
      },
      setIndexing,
      sourceName: props.sourceName,
    });
  }, [props.sourceName, refetch]);

  return renderSourceWikiContent({
    avgScore: getAverageScore(data?.analysis_axes),
    data,
    embedded,
    error,
    fundingAndBias: getFundingAndBias(outletAtlasEntity),
    indexing,
    isLoading,
    onIndex: handleIndex,
    outletEntityId,
    ownershipChain: getOwnershipChain(outletAtlasEntity),
  });
};

export { SourceWikiView };
