"use client";

import type { ReactNode } from "react";
import type { AtlasGraphProps } from "./atlas-graph-types";
import { AtlasGraphCanvas } from "./atlas-graph-canvas";
import styles from "./atlas.module.css";

const AtlasGraph = (props: Readonly<AtlasGraphProps>): ReactNode => {
  if (props.nodes.length === 0 && !props.loading) {
    return (
      <div className={styles.emptyState}>
        <div>
          <div className={styles.brandTitle}>No entities match this view.</div>
          <p className={styles.contextCopy}>
            Clear a filter or search for a different outlet, organization, or reporter.
          </p>
        </div>
      </div>
    );
  }

  return (
    <AtlasGraphCanvas
      edges={props.edges}
      focus={props.focus}
      graphVersion={props.graphVersion}
      layout={props.layout}
      nodes={props.nodes}
      onSelect={props.onSelect}
      selectedId={props.selectedId}
    />
  );
};

export { AtlasGraph };
