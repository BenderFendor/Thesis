"use client";

import styles from "./atlas.module.css";
import { useCallback } from "react";

interface AtlasAccessibleListProps {
  readonly nodes: readonly AtlasNodeView[];
  readonly edges: readonly AtlasEdgeView[];
  readonly selectedId: string | null;
  readonly onSelect: (nodeId: string) => void;
}

interface AtlasEntityButtonProps {
  readonly node: AtlasNodeView;
  readonly relationCount: number;
  readonly selected: boolean;
}

interface AtlasEntityListProps {
  readonly nodes: readonly AtlasNodeView[];
  readonly onSelect: (event: Readonly<AtlasButtonClickEvent>) => void;
  readonly relationCounts: AtlasRelationCounts;
  readonly selectedId: string | null;
}

interface AtlasEntityButtonWithHandlerProps extends AtlasEntityButtonProps {
  readonly onSelect: (event: Readonly<AtlasButtonClickEvent>) => void;
}

interface AtlasEdgeView {
  readonly source_id: string;
  readonly target_id: string;
}

interface AtlasNodeView {
  readonly entity_type: string;
  readonly id: string;
  readonly label: string;
}

interface AtlasRelationCounts {
  readonly get: (nodeId: string) => number | undefined;
}

interface AtlasButtonClickEvent {
  readonly currentTarget: AtlasButtonClickTarget;
}

interface AtlasButtonClickTarget {
  readonly dataset: AtlasDataset;
}

interface AtlasDataset {
  readonly nodeId?: string;
}

const AtlasAccessibleList = (props: Readonly<AtlasAccessibleListProps>) => {
    const { edges, nodes, onSelect, selectedId } = props,
      handleSelect = useCallback(
        (event: Readonly<AtlasButtonClickEvent>) => {
          const { currentTarget } = event,
            { nodeId } = currentTarget.dataset;
          if (nodeId !== undefined) {
            onSelect(nodeId);
          }
        },
        [onSelect],
      ),
      relationCounts = new Map<string, number>();

    edges.forEach((edge) => {
      relationCounts.set(edge.source_id, (relationCounts.get(edge.source_id) ?? EMPTY_COUNT) + CONNECTION_INCREMENT);
      relationCounts.set(edge.target_id, (relationCounts.get(edge.target_id) ?? EMPTY_COUNT) + CONNECTION_INCREMENT);
    });

    return (
      <div className={styles.accessibleList} aria-label="Accessible Atlas entity list">
        <h2>Atlas entities</h2>
        <AtlasEntityList
          nodes={nodes}
          onSelect={handleSelect}
          relationCounts={relationCounts}
          selectedId={selectedId}
        />
      </div>
    );
  },
  AtlasEntityButton = (props: Readonly<AtlasEntityButtonWithHandlerProps>) => (
    <button
      type="button"
      aria-pressed={props.selected}
      data-node-id={props.node.id}
      onClick={props.onSelect}
    >
      {props.node.label}, {props.node.entity_type}, {props.relationCount} visible connections
    </button>
  ),
  AtlasEntityList = (props: Readonly<AtlasEntityListProps>) => (
    <ul>
      {props.nodes.map((node) => (
        <li key={node.id}>
          <AtlasEntityButton
            node={node}
            onSelect={props.onSelect}
            relationCount={props.relationCounts.get(node.id) ?? EMPTY_COUNT}
            selected={props.selectedId === node.id}
          />
        </li>
      ))}
    </ul>
  ),
  CONNECTION_INCREMENT = 1,
  EMPTY_COUNT = 0;

export { AtlasAccessibleList };
