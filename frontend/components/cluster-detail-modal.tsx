"use client";

import { ClusterDetailModalContent } from "./cluster-detail-modal-content";
import type { ClusterDetailModalProps } from "./cluster-detail-modal-types";

const ClusterDetailModal = ({ cluster, isBreaking, isOpen, onClose }: ClusterDetailModalProps) => {
  if (!isOpen || !cluster) {
    return null;
  }

  return (
    <ClusterDetailModalContent
      key={`${cluster.cluster_id}-${(() => {
        if (isOpen) {
          return "open";
        }
        return "closed";
      })()}`}
      cluster={cluster}
      isBreaking={isBreaking}
      onClose={onClose}
    />
  );
};

export { ClusterDetailModal };
