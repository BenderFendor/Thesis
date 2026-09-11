"use client";

import { ClusterDetailView } from "./cluster-detail-modal-view";
import { useClusterDetailModel } from "./cluster-detail-modal-model";
import type { ClusterDetailModalContentProps } from "./cluster-detail-modal-types";

const ClusterDetailModalContent = (props: ClusterDetailModalContentProps) => {
  const model = useClusterDetailModel(props);
  return <ClusterDetailView model={model} />;
};

export { ClusterDetailModalContent };
