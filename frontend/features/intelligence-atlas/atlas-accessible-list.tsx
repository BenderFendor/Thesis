"use client";

import type { AtlasEdge, AtlasNode } from "./lib/atlas-schema";
import styles from "./atlas.module.css";

interface AtlasAccessibleListProps {
  nodes: AtlasNode[];
  edges: AtlasEdge[];
  selectedId: string | null;
  onSelect: (nodeId: string) => void;
}

export function AtlasAccessibleList({ nodes, edges, selectedId, onSelect }: AtlasAccessibleListProps) {
  const relationCounts = new Map<string, number>();
  edges.forEach((edge) => {
    relationCounts.set(edge.source_id, (relationCounts.get(edge.source_id) ?? 0) + 1);
    relationCounts.set(edge.target_id, (relationCounts.get(edge.target_id) ?? 0) + 1);
  });

  return (
    <div className={styles.accessibleList} aria-label="Accessible Atlas entity list">
      <h2>Atlas entities</h2>
      <ul>
        {nodes.map((node) => (
          <li key={node.id}>
            <button
              type="button"
              aria-pressed={selectedId === node.id}
              onClick={() => onSelect(node.id)}
            >
              {node.label}, {node.entity_type}, {relationCounts.get(node.id) ?? 0} visible connections
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
