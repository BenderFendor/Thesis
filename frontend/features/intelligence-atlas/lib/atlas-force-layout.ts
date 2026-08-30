/**
 * Deterministic force-directed layout for the Atlas graph canvas.
 *
 * This used to run inside a dedicated Web Worker (`workers/atlas-layout.worker.ts`,
 * loaded via `new Worker(new URL(...), { type: "module" })`). Under this
 * project's Turbopack dev config that pattern silently fails: Turbopack treats
 * the `.ts` worker file as an opaque static asset rather than compiling it,
 * so the emitted URL serves the raw, un-transpiled TypeScript source with a
 * `video/mp2t` MIME type (a `.ts` extension collision with MPEG transport
 * streams). The browser refuses to execute that as a module worker, so
 * `positions` never populated and the graph canvas rendered nothing but its
 * floating status strip.
 *
 * The fix: run the same algorithm on the main thread, chunked across
 * `requestAnimationFrame` callbacks so it stays interactive instead of
 * blocking. See `hooks/use-atlas-layout.ts`.
 */

import type { AtlasEdge, AtlasNode } from "./atlas-schema";
import type { AtlasLayoutMode } from "./atlas-query-state";

export interface AtlasPosition {
  x: number;
  y: number;
}

export type AtlasLayoutNodeInput = Pick<AtlasNode, "id" | "entity_type" | "country_code" | "connection_count">;
export type AtlasLayoutEdgeInput = Pick<AtlasEdge, "source_id" | "target_id" | "relation_type" | "weight">;

export interface AtlasLayoutRequest {
  width: number;
  height: number;
  layout: AtlasLayoutMode;
  selectedId: string | null;
  nodes: AtlasLayoutNodeInput[];
  edges: AtlasLayoutEdgeInput[];
}

function hashValue(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function seededUnit(value: string, salt: number): number {
  return (hashValue(`${value}:${salt}`) % 100_000) / 100_000;
}

function groupKey(node: AtlasLayoutNodeInput, layout: AtlasLayoutMode): string {
  if (layout === "geography") {return node.country_code || "Unspecified";}
  return node.entity_type;
}

function initialPosition(node: AtlasLayoutNodeInput, index: number, request: AtlasLayoutRequest): AtlasPosition {
  if (request.layout === "radial" && request.selectedId) {
    if (node.id === request.selectedId) {return { x: request.width / 2, y: request.height / 2 };}
    const angle = seededUnit(node.id, 9) * Math.PI * 2,
     ring = 150 + (index % 4) * 78;
    return {
      x: request.width / 2 + Math.cos(angle) * ring,
      y: request.height / 2 + Math.sin(angle) * ring,
    };
  }

  const key = groupKey(node, request.layout),
   groupHash = hashValue(key),
   centerAngle = (groupHash % 360) * (Math.PI / 180),
   groupRadius = Math.min(request.width, request.height) * 0.24,
   centerX = request.width / 2 + Math.cos(centerAngle) * groupRadius,
   centerY = request.height / 2 + Math.sin(centerAngle) * groupRadius,
   localAngle = seededUnit(node.id, 3) * Math.PI * 2,
   localRadius = 40 + seededUnit(node.id, 4) * 170;
  return {
    x: centerX + Math.cos(localAngle) * localRadius,
    y: centerY + Math.sin(localAngle) * localRadius,
  };
}

/** Steps a force-directed simulation one iteration at a time so a caller
 * (e.g. a `requestAnimationFrame` loop) can spread the work across frames. */
export class AtlasForceLayoutRunner {
  readonly totalIterations: number;
  private iteration = 0;
  private readonly request: AtlasLayoutRequest;
  private readonly positions: Map<string, AtlasPosition>;
  private readonly velocities: Map<string, AtlasPosition>;
  private readonly adjacency: Map<string, Set<string>>;
  private readonly padding = 48;

  constructor(request: AtlasLayoutRequest) {
    this.request = request;
    this.positions = new Map();
    this.velocities = new Map();
    this.adjacency = new Map();
    request.nodes.forEach((node, index) => {
      this.positions.set(node.id, initialPosition(node, index, request));
      this.velocities.set(node.id, { x: 0, y: 0 });
      this.adjacency.set(node.id, new Set());
    });
    request.edges.forEach((edge) => {
      this.adjacency.get(edge.source_id)?.add(edge.target_id);
      this.adjacency.get(edge.target_id)?.add(edge.source_id);
    });
    this.totalIterations = Math.min(180, Math.max(80, 220 - Math.floor(request.nodes.length / 4)));
  }

  hasNext(): boolean {
    return this.iteration < this.totalIterations;
  }

  step(): void {
    const {request} = this,
     alpha = 1 - this.iteration / this.totalIterations,
     forces = new Map(request.nodes.map((node) => [node.id, { x: 0, y: 0 }]));

    for (let leftIndex = 0; leftIndex < request.nodes.length; leftIndex += 1) {
      const left = request.nodes[leftIndex]!,
       leftPosition = this.positions.get(left.id)!;
      for (let rightIndex = leftIndex + 1; rightIndex < request.nodes.length; rightIndex += 1) {
        const right = request.nodes[rightIndex]!,
         rightPosition = this.positions.get(right.id)!;
        let dx = rightPosition.x - leftPosition.x,
         dy = rightPosition.y - leftPosition.y;
        const distanceSquared = Math.max(dx * dx + dy * dy, 36),
         distance = Math.sqrt(distanceSquared);
        dx /= distance;
        dy /= distance;
        const repulsion = Math.min(9, 1800 / distanceSquared) * alpha,
         leftForce = forces.get(left.id)!,
         rightForce = forces.get(right.id)!;
        leftForce.x -= dx * repulsion;
        leftForce.y -= dy * repulsion;
        rightForce.x += dx * repulsion;
        rightForce.y += dy * repulsion;
      }
    }

    for (const edge of request.edges) {
      const sourcePosition = this.positions.get(edge.source_id),
       targetPosition = this.positions.get(edge.target_id);
      if (!sourcePosition || !targetPosition) {continue;}
      let dx = targetPosition.x - sourcePosition.x,
       dy = targetPosition.y - sourcePosition.y;
      const distance = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      dx /= distance;
      dy /= distance;
      const desiredDistance = edge.relation_type === "ownership" ? 118 : 145,
       spring = (distance - desiredDistance) * 0.006 * Math.max(edge.weight, 0.25) * alpha,
       sourceForce = forces.get(edge.source_id)!,
       targetForce = forces.get(edge.target_id)!;
      sourceForce.x += dx * spring;
      sourceForce.y += dy * spring;
      targetForce.x -= dx * spring;
      targetForce.y -= dy * spring;
    }

    for (const node of request.nodes) {
      const position = this.positions.get(node.id)!,
       force = forces.get(node.id)!,
       velocity = this.velocities.get(node.id)!,
       group = groupKey(node, request.layout),
       groupAngle = (hashValue(group) % 360) * (Math.PI / 180),
       groupingRadius = request.layout === "geography" ? 0.27 : 0.18;
      let targetX = request.width / 2 + Math.cos(groupAngle) * request.width * groupingRadius,
       targetY = request.height / 2 + Math.sin(groupAngle) * request.height * groupingRadius;

      if (request.layout === "radial" && request.selectedId) {
        const graphDistance = this.adjacency.get(request.selectedId)?.has(node.id) ? 185 : 330,
         angle = seededUnit(node.id, 11) * Math.PI * 2;
        targetX = request.width / 2 + Math.cos(angle) * (node.id === request.selectedId ? 0 : graphDistance);
        targetY = request.height / 2 + Math.sin(angle) * (node.id === request.selectedId ? 0 : graphDistance);
      }
      if (request.layout === "ownership" && node.entity_type === "organization") {
        targetX = request.width * 0.42;
        targetY = request.height * 0.48;
      } else if (request.layout === "ownership" && node.entity_type === "outlet") {
        targetX = request.width * 0.64;
      } else if (request.layout === "ownership" && node.entity_type === "person") {
        targetX = request.width * 0.28;
        targetY = request.height * 0.32;
      }

      force.x += (targetX - position.x) * 0.0035 * alpha;
      force.y += (targetY - position.y) * 0.0035 * alpha;
      velocity.x = (velocity.x + force.x) * 0.82;
      velocity.y = (velocity.y + force.y) * 0.82;
      position.x = Math.min(request.width - this.padding, Math.max(this.padding, position.x + velocity.x));
      position.y = Math.min(request.height - this.padding, Math.max(this.padding, position.y + velocity.y));
    }

    this.iteration += 1;
  }

  getPositions(): Record<string, AtlasPosition> {
    return Object.fromEntries(this.positions);
  }
}
