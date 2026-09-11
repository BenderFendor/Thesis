"use client";

import { Newspaper } from "lucide-react";
import { lazy } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import dynamic from "next/dynamic";
import { motion } from "framer-motion";

const ArticleDetailModal = dynamic(
  async () => {
    const articleDetailModule = await import("./article-detail-modal");
    return articleDetailModule.ArticleDetailModal;
  },
  { loading: () => null, ssr: false },
);

const ClusterDetailModal = dynamic(
  async () => {
    const clusterDetailModule = await import("./cluster-detail-modal");
    return clusterDetailModule.ClusterDetailModal;
  },
  { loading: () => null, ssr: false },
);

const VirtualizedGrid = lazy(async () => {
  const virtualizedGridModule = await import("./virtualized-grid");
  return { default: virtualizedGridModule.VirtualizedGrid };
});

const VIRTUALIZED_FALLBACK = <Skeleton className="h-96 w-full opacity-20" />;
const EMPTY_STATE_INITIAL = { opacity: 0 };
const EMPTY_STATE_ANIMATE = { opacity: 1 };

const GridViewNoSignals = () => (
  <motion.div
    initial={EMPTY_STATE_INITIAL}
    animate={EMPTY_STATE_ANIMATE}
    className="flex flex-col items-center justify-center py-32 text-center"
  >
    <Newspaper className="mb-6 h-16 w-16 text-white/10" />
    <h3 className="mb-2 font-serif text-3xl text-foreground/80">No signals detected</h3>
    <p className="max-w-md text-sm text-muted-foreground">
      Adjust your search parameters to find relevant intelligence.
    </p>
  </motion.div>
);

export {
  ArticleDetailModal,
  ClusterDetailModal,
  GridViewNoSignals,
  VIRTUALIZED_FALLBACK,
  VirtualizedGrid,
};
