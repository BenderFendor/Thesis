/**
 * Deterministic force-directed layout for the Atlas graph canvas.
 *
 * This used to run inside a dedicated Web Worker. Under this project's
 * Turbopack dev config the worker was served as raw TypeScript, so the browser
 * rejected it. The same simulation now runs on the main thread in chunks from
 * requestAnimationFrame; see hooks/use-atlas-layout.ts.
 */

import type { AtlasLayoutMode } from "./atlas-query-state"
import type { AtlasEdge, AtlasNode } from "./atlas-schema"

export interface AtlasPosition {
  x: number
  y: number
}

export type AtlasLayoutNodeInput = Pick<AtlasNode, "id" | "entity_type" | "country_code" | "connection_count">
export type AtlasLayoutEdgeInput = Pick<AtlasEdge, "source_id" | "target_id" | "relation_type" | "weight">

export interface AtlasLayoutRequest {
  width: number
  height: number
  layout: AtlasLayoutMode
  selectedId: string | null
  nodes: AtlasLayoutNodeInput[]
  edges: AtlasLayoutEdgeInput[]
}

const HASH_SEED = 2_166_136_261
const HASH_PRIME = 16_777_619
const HASH_BUCKETS = 100_000
const DEGREES_PER_CIRCLE = 360
const RADIANS_PER_CIRCLE = Math.PI * 2
const RADIAL_SALT = 9
const LOCAL_ANGLE_SALT = 3
const LOCAL_RADIUS_SALT = 4
const TARGET_ANGLE_SALT = 11
const RADIAL_BASE_RADIUS = 150
const RADIAL_RING_STEP = 78
const RADIAL_RING_COUNT = 4
const GROUP_RADIUS_RATIO = 0.24
const LOCAL_BASE_RADIUS = 40
const LOCAL_RADIUS_RANGE = 170
const MIN_ITERATIONS = 80
const MAX_ITERATIONS = 180
const ITERATION_BASE = 220
const NODES_PER_ITERATION_STEP = 4
const CANVAS_PADDING = 48
const MIN_DISTANCE_SQUARED = 36
const MAX_REPULSION = 9
const REPULSION_STRENGTH = 1800
const MIN_EDGE_DISTANCE = 1
const OWNERSHIP_EDGE_DISTANCE = 118
const DEFAULT_EDGE_DISTANCE = 145
const SPRING_STRENGTH = 0.006
const MIN_EDGE_WEIGHT = 0.25
const GEOGRAPHY_GROUPING_RADIUS = 0.27
const DEFAULT_GROUPING_RADIUS = 0.18
const DIRECT_NEIGHBOR_RADIUS = 185
const OTHER_NODE_RADIUS = 330
const CENTER_DIVISOR = 2
const ORGANIZATION_X_RATIO = 0.42
const ORGANIZATION_Y_RATIO = 0.48
const OUTLET_X_RATIO = 0.64
const PERSON_X_RATIO = 0.28
const PERSON_Y_RATIO = 0.32
const CENTER_FORCE = 0.0035
const VELOCITY_DAMPING = 0.82

const hashValue = (value: string): number => {
  let hash = HASH_SEED
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, HASH_PRIME)
  }
  return hash >>> 0
}

const seededUnit = (value: string, salt: number): number => (
  (hashValue(`${value}:${salt}`) % HASH_BUCKETS) / HASH_BUCKETS
)

const groupKey = (node: AtlasLayoutNodeInput, layout: AtlasLayoutMode): string => {
  if (layout === "geography") return node.country_code || "Unspecified"
  return node.entity_type
}

const radialInitialPosition = (
  node: AtlasLayoutNodeInput,
  index: number,
  request: AtlasLayoutRequest,
): AtlasPosition => {
  if (node.id === request.selectedId) {
    return { x: request.width / CENTER_DIVISOR, y: request.height / CENTER_DIVISOR }
  }
  const angle = seededUnit(node.id, RADIAL_SALT) * RADIANS_PER_CIRCLE
  const ring = RADIAL_BASE_RADIUS + (index % RADIAL_RING_COUNT) * RADIAL_RING_STEP
  return {
    x: request.width / CENTER_DIVISOR + Math.cos(angle) * ring,
    y: request.height / CENTER_DIVISOR + Math.sin(angle) * ring,
  }
}

const groupedInitialPosition = (
  node: AtlasLayoutNodeInput,
  request: AtlasLayoutRequest,
): AtlasPosition => {
  const groupHash = hashValue(groupKey(node, request.layout))
  const centerAngle = (groupHash % DEGREES_PER_CIRCLE) * (Math.PI / (DEGREES_PER_CIRCLE / CENTER_DIVISOR))
  const groupRadius = Math.min(request.width, request.height) * GROUP_RADIUS_RATIO
  const centerX = request.width / CENTER_DIVISOR + Math.cos(centerAngle) * groupRadius
  const centerY = request.height / CENTER_DIVISOR + Math.sin(centerAngle) * groupRadius
  const localAngle = seededUnit(node.id, LOCAL_ANGLE_SALT) * RADIANS_PER_CIRCLE
  const localRadius = LOCAL_BASE_RADIUS + seededUnit(node.id, LOCAL_RADIUS_SALT) * LOCAL_RADIUS_RANGE
  return {
    x: centerX + Math.cos(localAngle) * localRadius,
    y: centerY + Math.sin(localAngle) * localRadius,
  }
}

const initialPosition = (
  node: AtlasLayoutNodeInput,
  index: number,
  request: AtlasLayoutRequest,
): AtlasPosition => {
  if (request.layout === "radial" && request.selectedId !== null) {
    return radialInitialPosition(node, index, request)
  }
  return groupedInitialPosition(node, request)
}

const zeroPosition = (): AtlasPosition => ({ x: 0, y: 0 })

const edgeDistance = (edge: AtlasLayoutEdgeInput): number => {
  if (edge.relation_type === "ownership") return OWNERSHIP_EDGE_DISTANCE
  return DEFAULT_EDGE_DISTANCE
}

const groupingRadius = (layout: AtlasLayoutMode): number => {
  if (layout === "geography") return GEOGRAPHY_GROUPING_RADIUS
  return DEFAULT_GROUPING_RADIUS
}

const clampCoordinate = (value: number, maximum: number, padding: number): number => (
  Math.min(maximum - padding, Math.max(padding, value))
)

interface NodeTarget {
  x: number
  y: number
}

/** Steps a force-directed simulation one iteration at a time so a caller
 * can spread the work across animation frames. */
export class AtlasForceLayoutRunner {
  readonly totalIterations: number
  private iteration = 0
  private readonly request: AtlasLayoutRequest
  private readonly positions = new Map<string, AtlasPosition>()
  private readonly velocities = new Map<string, AtlasPosition>()
  private readonly adjacency = new Map<string, Set<string>>()
  private readonly padding = CANVAS_PADDING

  constructor(request: AtlasLayoutRequest) {
    this.request = request
    this.initializeNodes()
    this.initializeEdges()
    const proposedIterations = ITERATION_BASE - Math.floor(request.nodes.length / NODES_PER_ITERATION_STEP)
    this.totalIterations = Math.min(MAX_ITERATIONS, Math.max(MIN_ITERATIONS, proposedIterations))
  }

  private initializeNodes(): void {
    this.request.nodes.forEach((node, index) => {
      this.positions.set(node.id, initialPosition(node, index, this.request))
      this.velocities.set(node.id, zeroPosition())
      this.adjacency.set(node.id, new Set())
    })
  }

  private initializeEdges(): void {
    for (const edge of this.request.edges) {
      this.adjacency.get(edge.source_id)?.add(edge.target_id)
      this.adjacency.get(edge.target_id)?.add(edge.source_id)
    }
  }

  hasNext(): boolean {
    return this.iteration < this.totalIterations
  }

  private applyRepulsion(forces: Map<string, AtlasPosition>, alpha: number): void {
    const nodes = this.request.nodes
    for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
      const left = nodes[leftIndex]
      if (left === undefined) continue
      const leftPosition = this.positions.get(left.id)
      if (leftPosition === undefined) continue
      this.applyRepulsionFromNode(leftIndex, left, leftPosition, forces, alpha)
    }
  }

  private applyRepulsionFromNode(
    leftIndex: number,
    left: AtlasLayoutNodeInput,
    leftPosition: AtlasPosition,
    forces: Map<string, AtlasPosition>,
    alpha: number,
  ): void {
    const nodes = this.request.nodes
    for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
      const right = nodes[rightIndex]
      if (right === undefined) continue
      const rightPosition = this.positions.get(right.id)
      const leftForce = forces.get(left.id)
      const rightForce = forces.get(right.id)
      if (rightPosition === undefined || leftForce === undefined || rightForce === undefined) continue
      this.applyRepulsionPair(leftPosition, rightPosition, leftForce, rightForce, alpha)
    }
  }

  private applyRepulsionPair(
    leftPosition: AtlasPosition,
    rightPosition: AtlasPosition,
    leftForce: AtlasPosition,
    rightForce: AtlasPosition,
    alpha: number,
  ): void {
    let dx = rightPosition.x - leftPosition.x
    let dy = rightPosition.y - leftPosition.y
    const distanceSquared = Math.max(dx * dx + dy * dy, MIN_DISTANCE_SQUARED)
    const distance = Math.sqrt(distanceSquared)
    dx /= distance
    dy /= distance
    const repulsion = Math.min(MAX_REPULSION, REPULSION_STRENGTH / distanceSquared) * alpha
    leftForce.x -= dx * repulsion
    leftForce.y -= dy * repulsion
    rightForce.x += dx * repulsion
    rightForce.y += dy * repulsion
  }

  private applySprings(forces: Map<string, AtlasPosition>, alpha: number): void {
    for (const edge of this.request.edges) {
      const sourcePosition = this.positions.get(edge.source_id)
      const targetPosition = this.positions.get(edge.target_id)
      const sourceForce = forces.get(edge.source_id)
      const targetForce = forces.get(edge.target_id)
      if (
        sourcePosition === undefined
        || targetPosition === undefined
        || sourceForce === undefined
        || targetForce === undefined
      ) continue
      this.applySpring(edge, sourcePosition, targetPosition, sourceForce, targetForce, alpha)
    }
  }

  private applySpring(
    edge: AtlasLayoutEdgeInput,
    sourcePosition: AtlasPosition,
    targetPosition: AtlasPosition,
    sourceForce: AtlasPosition,
    targetForce: AtlasPosition,
    alpha: number,
  ): void {
    let dx = targetPosition.x - sourcePosition.x
    let dy = targetPosition.y - sourcePosition.y
    const distance = Math.max(Math.sqrt(dx * dx + dy * dy), MIN_EDGE_DISTANCE)
    dx /= distance
    dy /= distance
    const spring = (
      (distance - edgeDistance(edge))
      * SPRING_STRENGTH
      * Math.max(edge.weight, MIN_EDGE_WEIGHT)
      * alpha
    )
    sourceForce.x += dx * spring
    sourceForce.y += dy * spring
    targetForce.x -= dx * spring
    targetForce.y -= dy * spring
  }

  private groupTarget(node: AtlasLayoutNodeInput): NodeTarget {
    const request = this.request
    const angle = (hashValue(groupKey(node, request.layout)) % DEGREES_PER_CIRCLE)
      * (Math.PI / (DEGREES_PER_CIRCLE / CENTER_DIVISOR))
    const radius = groupingRadius(request.layout)
    return {
      x: request.width / CENTER_DIVISOR + Math.cos(angle) * request.width * radius,
      y: request.height / CENTER_DIVISOR + Math.sin(angle) * request.height * radius,
    }
  }

  private radialTarget(node: AtlasLayoutNodeInput): NodeTarget {
    const request = this.request
    const selectedId = request.selectedId
    if (selectedId === null) return this.groupTarget(node)
    const directNeighbor = this.adjacency.get(selectedId)?.has(node.id) === true
    const graphDistance = directNeighbor ? DIRECT_NEIGHBOR_RADIUS : OTHER_NODE_RADIUS
    const angle = seededUnit(node.id, TARGET_ANGLE_SALT) * RADIANS_PER_CIRCLE
    const radius = node.id === selectedId ? 0 : graphDistance
    return {
      x: request.width / CENTER_DIVISOR + Math.cos(angle) * radius,
      y: request.height / CENTER_DIVISOR + Math.sin(angle) * radius,
    }
  }

  private ownershipTarget(node: AtlasLayoutNodeInput, fallback: NodeTarget): NodeTarget {
    const request = this.request
    if (node.entity_type === "organization") {
      return { x: request.width * ORGANIZATION_X_RATIO, y: request.height * ORGANIZATION_Y_RATIO }
    }
    if (node.entity_type === "outlet") {
      return { x: request.width * OUTLET_X_RATIO, y: fallback.y }
    }
    if (node.entity_type === "person") {
      return { x: request.width * PERSON_X_RATIO, y: request.height * PERSON_Y_RATIO }
    }
    return fallback
  }

  private targetForNode(node: AtlasLayoutNodeInput): NodeTarget {
    const grouped = this.groupTarget(node)
    if (this.request.layout === "radial") return this.radialTarget(node)
    if (this.request.layout === "ownership") return this.ownershipTarget(node, grouped)
    return grouped
  }

  private updateNodes(forces: Map<string, AtlasPosition>, alpha: number): void {
    for (const node of this.request.nodes) {
      const position = this.positions.get(node.id)
      const force = forces.get(node.id)
      const velocity = this.velocities.get(node.id)
      if (position === undefined || force === undefined || velocity === undefined) continue
      this.updateNode(node, position, force, velocity, alpha)
    }
  }

  private updateNode(
    node: AtlasLayoutNodeInput,
    position: AtlasPosition,
    force: AtlasPosition,
    velocity: AtlasPosition,
    alpha: number,
  ): void {
    const request = this.request
    const target = this.targetForNode(node)
    force.x += (target.x - position.x) * CENTER_FORCE * alpha
    force.y += (target.y - position.y) * CENTER_FORCE * alpha
    velocity.x = (velocity.x + force.x) * VELOCITY_DAMPING
    velocity.y = (velocity.y + force.y) * VELOCITY_DAMPING
    position.x = clampCoordinate(position.x + velocity.x, request.width, this.padding)
    position.y = clampCoordinate(position.y + velocity.y, request.height, this.padding)
  }

  step(): void {
    const alpha = 1 - this.iteration / this.totalIterations
    const forces = new Map(this.request.nodes.map((node) => [node.id, zeroPosition()]))
    this.applyRepulsion(forces, alpha)
    this.applySprings(forces, alpha)
    this.updateNodes(forces, alpha)
    this.iteration += 1
  }

  getPositions(): Record<string, AtlasPosition> {
    return Object.fromEntries(this.positions)
  }
}
