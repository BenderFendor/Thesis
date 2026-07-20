/// <reference lib="webworker" />

import type {
  AtlasLayoutRequest,
  AtlasLayoutResponse,
  AtlasPosition,
  AtlasWorkerRequest,
} from "../features/intelligence-atlas/lib/atlas-layout-protocol";

const cancelled = new Set<number>();

function hashValue(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededUnit(value: string, salt: number): number {
  return (hashValue(`${value}:${salt}`) % 100000) / 100000;
}

function groupKey(node: AtlasLayoutRequest["nodes"][number], layout: AtlasLayoutRequest["layout"]): string {
  if (layout === "geography") return node.country_code || "Unspecified";
  if (layout === "ownership") return node.entity_type;
  return node.entity_type;
}

function initialPosition(
  node: AtlasLayoutRequest["nodes"][number],
  index: number,
  request: AtlasLayoutRequest,
): AtlasPosition {
  if (request.layout === "radial" && request.selectedId) {
    if (node.id === request.selectedId) return { x: request.width / 2, y: request.height / 2 };
    const angle = seededUnit(node.id, 9) * Math.PI * 2;
    const ring = 150 + (index % 4) * 78;
    return {
      x: request.width / 2 + Math.cos(angle) * ring,
      y: request.height / 2 + Math.sin(angle) * ring,
    };
  }

  const key = groupKey(node, request.layout);
  const groupHash = hashValue(key);
  const centerAngle = (groupHash % 360) * (Math.PI / 180);
  const groupRadius = Math.min(request.width, request.height) * 0.24;
  const centerX = request.width / 2 + Math.cos(centerAngle) * groupRadius;
  const centerY = request.height / 2 + Math.sin(centerAngle) * groupRadius;
  const localAngle = seededUnit(node.id, 3) * Math.PI * 2;
  const localRadius = 40 + seededUnit(node.id, 4) * 170;
  return {
    x: centerX + Math.cos(localAngle) * localRadius,
    y: centerY + Math.sin(localAngle) * localRadius,
  };
}

function runLayout(request: AtlasLayoutRequest): void {
  const positions = new Map<string, AtlasPosition>();
  const velocities = new Map<string, AtlasPosition>();
  const adjacency = new Map<string, Set<string>>();

  request.nodes.forEach((node, index) => {
    positions.set(node.id, initialPosition(node, index, request));
    velocities.set(node.id, { x: 0, y: 0 });
    adjacency.set(node.id, new Set());
  });
  request.edges.forEach((edge) => {
    adjacency.get(edge.source_id)?.add(edge.target_id);
    adjacency.get(edge.target_id)?.add(edge.source_id);
  });

  const iterations = Math.min(180, Math.max(80, 220 - Math.floor(request.nodes.length / 4)));
  const padding = 48;
  let lastPosted = 0;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    if (cancelled.has(request.requestId)) return;
    const alpha = 1 - iteration / iterations;
    const forces = new Map(request.nodes.map((node) => [node.id, { x: 0, y: 0 }]));

    for (let leftIndex = 0; leftIndex < request.nodes.length; leftIndex += 1) {
      const left = request.nodes[leftIndex]!;
      const leftPosition = positions.get(left.id)!;
      for (let rightIndex = leftIndex + 1; rightIndex < request.nodes.length; rightIndex += 1) {
        const right = request.nodes[rightIndex]!;
        const rightPosition = positions.get(right.id)!;
        let dx = rightPosition.x - leftPosition.x;
        let dy = rightPosition.y - leftPosition.y;
        const distanceSquared = Math.max(dx * dx + dy * dy, 36);
        const distance = Math.sqrt(distanceSquared);
        dx /= distance;
        dy /= distance;
        const repulsion = Math.min(9, 1800 / distanceSquared) * alpha;
        const leftForce = forces.get(left.id)!;
        const rightForce = forces.get(right.id)!;
        leftForce.x -= dx * repulsion;
        leftForce.y -= dy * repulsion;
        rightForce.x += dx * repulsion;
        rightForce.y += dy * repulsion;
      }
    }

    for (const edge of request.edges) {
      const sourcePosition = positions.get(edge.source_id);
      const targetPosition = positions.get(edge.target_id);
      if (!sourcePosition || !targetPosition) continue;
      let dx = targetPosition.x - sourcePosition.x;
      let dy = targetPosition.y - sourcePosition.y;
      const distance = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      dx /= distance;
      dy /= distance;
      const desiredDistance = edge.relation_type === "ownership" ? 118 : 145;
      const spring = (distance - desiredDistance) * 0.006 * Math.max(edge.weight, 0.25) * alpha;
      const sourceForce = forces.get(edge.source_id)!;
      const targetForce = forces.get(edge.target_id)!;
      sourceForce.x += dx * spring;
      sourceForce.y += dy * spring;
      targetForce.x -= dx * spring;
      targetForce.y -= dy * spring;
    }

    for (const node of request.nodes) {
      const position = positions.get(node.id)!;
      const force = forces.get(node.id)!;
      const velocity = velocities.get(node.id)!;
      const group = groupKey(node, request.layout);
      const groupAngle = (hashValue(group) % 360) * (Math.PI / 180);
      const groupingRadius = request.layout === "geography" ? 0.27 : 0.18;
      let targetX = request.width / 2 + Math.cos(groupAngle) * request.width * groupingRadius;
      let targetY = request.height / 2 + Math.sin(groupAngle) * request.height * groupingRadius;

      if (request.layout === "radial" && request.selectedId) {
        const graphDistance = adjacency.get(request.selectedId)?.has(node.id) ? 185 : 330;
        const angle = seededUnit(node.id, 11) * Math.PI * 2;
        targetX = request.width / 2 + Math.cos(angle) * (node.id === request.selectedId ? 0 : graphDistance);
        targetY = request.height / 2 + Math.sin(angle) * (node.id === request.selectedId ? 0 : graphDistance);
      }
      if (request.layout === "ownership" && node.entity_type === "organization") {
        targetX = request.width * 0.42;
        targetY = request.height * 0.48;
      } else if (request.layout === "ownership" && node.entity_type === "source") {
        targetX = request.width * 0.64;
      }

      force.x += (targetX - position.x) * 0.0035 * alpha;
      force.y += (targetY - position.y) * 0.0035 * alpha;
      velocity.x = (velocity.x + force.x) * 0.82;
      velocity.y = (velocity.y + force.y) * 0.82;
      position.x = Math.min(request.width - padding, Math.max(padding, position.x + velocity.x));
      position.y = Math.min(request.height - padding, Math.max(padding, position.y + velocity.y));
    }

    const now = performance.now();
    if (now - lastPosted > 48 && iteration < iterations - 1) {
      lastPosted = now;
      const response: AtlasLayoutResponse = {
        type: "positions",
        requestId: request.requestId,
        positions: Object.fromEntries(positions),
      };
      self.postMessage(response);
    }
  }

  const response: AtlasLayoutResponse = {
    type: "complete",
    requestId: request.requestId,
    positions: Object.fromEntries(positions),
  };
  self.postMessage(response);
  cancelled.delete(request.requestId);
}

self.addEventListener("message", (event: MessageEvent<AtlasWorkerRequest>) => {
  if (event.data.type === "cancel") {
    cancelled.add(event.data.requestId);
    return;
  }
  runLayout(event.data);
});
