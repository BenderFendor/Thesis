"use client";

import type { DeepReadonly } from "@/lib/deep-readonly";
import { FeedViewContent } from "./feed-view-content";
import { useFeedViewController } from "./feed-view-controller";
import type { FeedViewProps } from "./feed-view-controller";

const FeedView = (props: DeepReadonly<FeedViewProps>) => {
  const model = useFeedViewController(props);
  return <FeedViewContent model={model} />;
};

export { FeedView };
