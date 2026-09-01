/**
 * Deterministic force-directed layout for the Atlas graph canvas.
 *
 * This used to run inside a dedicated Web Worker. Under this project's
 * Turbopack dev config the worker was served as raw TypeScript, so the browser
 * rejected it. The same simulation now runs on the main thread in chunks from
 * requestAnimationFrame; see hooks/use-atlas-layout.ts.
 */

import type { AtlasEdge, AtlasNode } from "./atlas-schema"
import type { AtlasLayoutMode } from "./atlas-query-state"

interface AtlasPosition {
  // oxlint-disable-next-line eslint/id-length -- x is the serialized horizontal coordinate key.
  readonly "x": number
  // oxlint-disable-next-line eslint/id-length -- y is the serialized vertical coordinate key.
  readonly "y": number
}

type AtlasLayoutNodeInput = Readonly<Pick<AtlasNode, "id" | "entity_type" | "country_code" | "connection_count">>
type AtlasLayoutEdgeInput = Readonly<Pick<AtlasEdge, "source_id" | "target_id" | "relation_type" | "weight">>

interface AtlasLayoutRequest {
  readonly width: number
  readonly height: number
  readonly layout: AtlasLayoutMode
  readonly selectedId: string | null
  readonly nodes: readonly AtlasLayoutNodeInput[]
  readonly edges: readonly AtlasLayoutEdgeInput[]
}

interface PositionVector {
  readonly add: (horizontalDelta: number, verticalDelta: number) => void
  readonly getHorizontal: () => number
  readonly getVertical: () => number
  readonly set: (horizontal: number, vertical: number) => void
}

const CANVAS_PADDING = 48,
 CENTER_DIVISOR = 2,
 CENTER_FORCE = 0.0035,
 CODE_POINT_START = 0,
 DEFAULT_EDGE_DISTANCE = 145,
 DEFAULT_GROUPING_RADIUS = 0.18,
 DEGREES_PER_CIRCLE = 360,
 DIRECT_NEIGHBOR_RADIUS = 185,
 FULL_TURN_DIVISOR = 2,
 GEOGRAPHY_GROUPING_RADIUS = 0.27,
 GROUP_RADIUS_RATIO = 0.24,
 HASH_BUCKETS = 100_000,
 HASH_PRIME = 16_777_619,
 HASH_SEED = 2_166_136_261,
 HORIZONTAL_KEY = "x",
 INDEX_STEP = 1,
 ITERATION_BASE = 220,
 LOCAL_ANGLE_SALT = 3,
 LOCAL_BASE_RADIUS = 40,
 LOCAL_RADIUS_RANGE = 170,
 LOCAL_RADIUS_SALT = 4,
 MAX_ITERATIONS = 180,
 MAX_REPULSION = 9,
 MIN_DISTANCE_SQUARED = 36,
 MIN_EDGE_DISTANCE = 1,
 MIN_EDGE_WEIGHT = 0.25,
 MIN_ITERATIONS = 80,
 NODES_PER_ITERATION_STEP = 4,
 ORGANIZATION_X_RATIO = 0.42,
 ORGANIZATION_Y_RATIO = 0.48,
 OTHER_NODE_RADIUS = 330,
 OUTLET_X_RATIO = 0.64,
 OWNERSHIP_EDGE_DISTANCE = 118,
 PERSON_X_RATIO = 0.28,
 PERSON_Y_RATIO = 0.32,
 RADIAL_BASE_RADIUS = 150,
 RADIAL_RING_COUNT = 4,
 RADIAL_RING_STEP = 78,
 RADIAL_SALT = 9,
 RADIANS_PER_CIRCLE = Math.PI * FULL_TURN_DIVISOR,
 REPULSION_STRENGTH = 1800,
 SPRING_STRENGTH = 0.006,
 TARGET_ANGLE_SALT = 11,
 VELOCITY_DAMPING = 0.82,
 VERTICAL_KEY = "y",
 ZERO_COORDINATE = 0,

 clampCoordinate = (value: number, maximum: number, padding: number): number => (
  Math.min(maximum - padding, Math.max(padding, value))
),
 createPosition = (horizontal: number, vertical: number): AtlasPosition => ({
  [HORIZONTAL_KEY]: horizontal,
  [VERTICAL_KEY]: vertical,
}),
 createVector = (horizontal: number, vertical: number): PositionVector => {
  let currentHorizontal = horizontal,
    currentVertical = vertical
  return {
    add: (horizontalDelta, verticalDelta) => {
      currentHorizontal += horizontalDelta
      currentVertical += verticalDelta
    },
    getHorizontal: () => currentHorizontal,
    getVertical: () => currentVertical,
    set: (nextHorizontal, nextVertical) => {
      currentHorizontal = nextHorizontal
      currentVertical = nextVertical
    },
  }
},
 edgeDistance = (edge: AtlasLayoutEdgeInput): number => {
  if (edge.relation_type === "ownership") {return OWNERSHIP_EDGE_DISTANCE}
  return DEFAULT_EDGE_DISTANCE
},
 groupKey = (node: AtlasLayoutNodeInput, layout: AtlasLayoutMode): string => {
  if (layout !== "geography") {return node.entity_type}
  const countryCode = node.country_code ?? ""
  if (countryCode === "") {return "Unspecified"}
  return countryCode
},
 groupedInitialPosition = (
  node: AtlasLayoutNodeInput,
  request: AtlasLayoutRequest,
): PositionVector => {
  const centerAngle = (hashValue(groupKey(node, request.layout)) % DEGREES_PER_CIRCLE)
      * (Math.PI / (DEGREES_PER_CIRCLE / CENTER_DIVISOR)),
   centerRadius = Math.min(request.width, request.height) * GROUP_RADIUS_RATIO,
   centerX = request.width / CENTER_DIVISOR + Math.cos(centerAngle) * centerRadius,
   centerY = request.height / CENTER_DIVISOR + Math.sin(centerAngle) * centerRadius,
   localAngle = seededUnit(node.id, LOCAL_ANGLE_SALT) * RADIANS_PER_CIRCLE,
   localRadius = LOCAL_BASE_RADIUS + seededUnit(node.id, LOCAL_RADIUS_SALT) * LOCAL_RADIUS_RANGE
  return createVector(
    centerX + Math.cos(localAngle) * localRadius,
    centerY + Math.sin(localAngle) * localRadius,
  )
},
 groupingRadius = (layout: AtlasLayoutMode): number => {
  if (layout === "geography") {return GEOGRAPHY_GROUPING_RADIUS}
  return DEFAULT_GROUPING_RADIUS
},
 hashValue = (value: string): number => {
  let hash = HASH_SEED
  for (let index = CODE_POINT_START; index < value.length; index += INDEX_STEP) {
    hash ^= value.codePointAt(index) ?? CODE_POINT_START
    hash = Math.imul(hash, HASH_PRIME)
  }
  return hash >>> CODE_POINT_START
},
 initialPosition = (
  node: AtlasLayoutNodeInput,
  index: number,
  request: AtlasLayoutRequest,
): PositionVector => {
  if (request.layout === "radial" && request.selectedId !== null) {
    return radialInitialPosition(node, index, request)
  }
  return groupedInitialPosition(node, request)
},
 radialInitialPosition = (
  node: AtlasLayoutNodeInput,
  index: number,
  request: AtlasLayoutRequest,
): PositionVector => {
  if (node.id === request.selectedId) {
    return createVector(request.width / CENTER_DIVISOR, request.height / CENTER_DIVISOR)
  }
  const angle = seededUnit(node.id, RADIAL_SALT) * RADIANS_PER_CIRCLE,
   ring = RADIAL_BASE_RADIUS + (index % RADIAL_RING_COUNT) * RADIAL_RING_STEP
  return createVector(
    request.width / CENTER_DIVISOR + Math.cos(angle) * ring,
    request.height / CENTER_DIVISOR + Math.sin(angle) * ring,
  )
},
 seededUnit = (value: string, salt: number): number => (
  (hashValue(`${value}:${salt}`) % HASH_BUCKETS) / HASH_BUCKETS
)

/** Steps a force-directed simulation one iteration at a time so a caller
 * can spread the work across animation frames. */
class AtlasForceLayoutRunner {
  readonly totalIterations: number
  private iteration = ZERO_COORDINATE
  private readonly request: AtlasLayoutRequest
  private readonly positions = new Map<string, PositionVector>()
  private readonly velocities = new Map<string, PositionVector>()
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
      this.velocities.set(node.id, createVector(ZERO_COORDINATE, ZERO_COORDINATE))
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

  private applyRepulsion(forces: Readonly<ReadonlyMap<string, Readonly<PositionVector>>>, alpha: number): void {
    for (let leftIndex = ZERO_COORDINATE; leftIndex < this.request.nodes.length; leftIndex += INDEX_STEP) {
      const left = this.request.nodes[leftIndex]
      if (left !== undefined) {
        this.applyRepulsionFromNode(leftIndex, left, forces, alpha)
      }
    }
  }

  private applyRepulsionFromNode(
    leftIndex: number,
    left: AtlasLayoutNodeInput,
    forces: Readonly<ReadonlyMap<string, Readonly<PositionVector>>>,
    alpha: number,
  ): void {
    for (let rightIndex = leftIndex + INDEX_STEP; rightIndex < this.request.nodes.length; rightIndex += INDEX_STEP) {
      const right = this.request.nodes[rightIndex]
      if (right !== undefined) {
        this.applyRepulsionPair(left.id, right.id, forces, alpha)
      }
    }
  }

  private applyRepulsionPair(
    leftId: string,
    rightId: string,
    forces: Readonly<ReadonlyMap<string, Readonly<PositionVector>>>,
    alpha: number,
  ): void {
    const leftForce = forces.get(leftId),
      leftPosition = this.positions.get(leftId),
      rightForce = forces.get(rightId),
      rightPosition = this.positions.get(rightId)
    if (leftForce === undefined || leftPosition === undefined || rightForce === undefined || rightPosition === undefined) {
      return
    }
    {
      const distance = Math.max(Math.hypot(
        rightPosition.getHorizontal() - leftPosition.getHorizontal(),
        rightPosition.getVertical() - leftPosition.getVertical(),
      ), Math.sqrt(MIN_DISTANCE_SQUARED)),
        horizontalDelta = (rightPosition.getHorizontal() - leftPosition.getHorizontal()) / distance,
        repulsion = Math.min(MAX_REPULSION, REPULSION_STRENGTH / (distance * distance)) * alpha,
        verticalDelta = (rightPosition.getVertical() - leftPosition.getVertical()) / distance
      leftForce.add(-horizontalDelta * repulsion, -verticalDelta * repulsion)
      rightForce.add(horizontalDelta * repulsion, verticalDelta * repulsion)
    }
  }

  private applySprings(forces: Readonly<ReadonlyMap<string, Readonly<PositionVector>>>, alpha: number): void {
    for (const edge of this.request.edges) {
      this.applySpring(edge, forces, alpha)
    }
  }

  private applySpring(
    edge: AtlasLayoutEdgeInput,
    forces: Readonly<ReadonlyMap<string, Readonly<PositionVector>>>,
    alpha: number,
  ): void {
    const sourceForce = forces.get(edge.source_id),
      sourcePosition = this.positions.get(edge.source_id),
      targetForce = forces.get(edge.target_id),
      targetPosition = this.positions.get(edge.target_id)
    if (sourceForce === undefined || sourcePosition === undefined || targetForce === undefined || targetPosition === undefined) {
      return
    }
    {
      const distance = Math.max(Math.hypot(
        targetPosition.getHorizontal() - sourcePosition.getHorizontal(),
        targetPosition.getVertical() - sourcePosition.getVertical(),
      ), MIN_EDGE_DISTANCE),
        horizontalDelta = (targetPosition.getHorizontal() - sourcePosition.getHorizontal()) / distance,
        spring = (distance - edgeDistance(edge)) * SPRING_STRENGTH * Math.max(edge.weight, MIN_EDGE_WEIGHT) * alpha,
        verticalDelta = (targetPosition.getVertical() - sourcePosition.getVertical()) / distance
      sourceForce.add(horizontalDelta * spring, verticalDelta * spring)
      targetForce.add(-horizontalDelta * spring, -verticalDelta * spring)
    }
  }

  private groupTarget(node: AtlasLayoutNodeInput): Readonly<PositionVector> {
    const angle = (hashValue(groupKey(node, this.request.layout)) % DEGREES_PER_CIRCLE)
      * (Math.PI / (DEGREES_PER_CIRCLE / CENTER_DIVISOR)),
      radius = groupingRadius(this.request.layout)
    return createVector(
      this.request.width / CENTER_DIVISOR + Math.cos(angle) * this.request.width * radius,
      this.request.height / CENTER_DIVISOR + Math.sin(angle) * this.request.height * radius,
    )
  }

  private radialTarget(node: AtlasLayoutNodeInput): Readonly<PositionVector> {
    const angle = seededUnit(node.id, TARGET_ANGLE_SALT) * RADIANS_PER_CIRCLE,
      directNeighbor = this.adjacency.get(this.request.selectedId ?? "")?.has(node.id) === true
    if (this.request.selectedId === null) {return this.groupTarget(node)}
    let radius = OTHER_NODE_RADIUS
    if (directNeighbor) {radius = DIRECT_NEIGHBOR_RADIUS}
    if (node.id === this.request.selectedId) {radius = ZERO_COORDINATE}
    return createVector(
      this.request.width / CENTER_DIVISOR + Math.cos(angle) * radius,
      this.request.height / CENTER_DIVISOR + Math.sin(angle) * radius,
    )
  }

  private ownershipTarget(node: AtlasLayoutNodeInput, fallback: Readonly<PositionVector>): Readonly<PositionVector> {
    if (node.entity_type === "organization") {
      return createVector(this.request.width * ORGANIZATION_X_RATIO, this.request.height * ORGANIZATION_Y_RATIO)
    }
    if (node.entity_type === "outlet") {
      return createVector(this.request.width * OUTLET_X_RATIO, fallback.getVertical())
    }
    if (node.entity_type === "person") {
      return createVector(this.request.width * PERSON_X_RATIO, this.request.height * PERSON_Y_RATIO)
    }
    return fallback
  }

  private targetForNode(node: AtlasLayoutNodeInput): Readonly<PositionVector> {
    const grouped = this.groupTarget(node)
    if (this.request.layout === "radial") {return this.radialTarget(node)}
    if (this.request.layout === "ownership") {return this.ownershipTarget(node, grouped)}
    return grouped
  }

  private updateNodes(forces: Readonly<ReadonlyMap<string, Readonly<PositionVector>>>, alpha: number): void {
    for (const node of this.request.nodes) {
      this.updateNode(node, forces, alpha)
    }
  }

  private updateNode(
    node: AtlasLayoutNodeInput,
    forces: Readonly<ReadonlyMap<string, Readonly<PositionVector>>>,
    alpha: number,
  ): void {
    const force = forces.get(node.id),
      position = this.positions.get(node.id),
      target = this.targetForNode(node),
      velocity = this.velocities.get(node.id)
    if (force === undefined || position === undefined || velocity === undefined) {
      return
    }
    force.add(
      (target.getHorizontal() - position.getHorizontal()) * CENTER_FORCE * alpha,
      (target.getVertical() - position.getVertical()) * CENTER_FORCE * alpha,
    )
    velocity.set(
      (velocity.getHorizontal() + force.getHorizontal()) * VELOCITY_DAMPING,
      (velocity.getVertical() + force.getVertical()) * VELOCITY_DAMPING,
    )
    position.set(
      clampCoordinate(position.getHorizontal() + velocity.getHorizontal(), this.request.width, this.padding),
      clampCoordinate(position.getVertical() + velocity.getVertical(), this.request.height, this.padding),
    )
  }

  step(): void {
    const alpha = INDEX_STEP - this.iteration / this.totalIterations,
      forces = new Map(this.request.nodes.map((node) => [node.id, createVector(ZERO_COORDINATE, ZERO_COORDINATE)]))
    this.applyRepulsion(forces, alpha)
    this.applySprings(forces, alpha)
    this.updateNodes(forces, alpha)
    this.iteration += INDEX_STEP
  }

  getPositions() {
    return Object.fromEntries(
      [...this.positions.entries()].map(
        ([nodeId, position]: readonly [string, PositionVector]): readonly [string, AtlasPosition] => [
          nodeId,
          createPosition(position.getHorizontal(), position.getVertical()),
        ],
      ),
    )
  }
}

export {
  AtlasForceLayoutRunner,
  type AtlasLayoutEdgeInput,
  type AtlasLayoutNodeInput,
  type AtlasLayoutRequest,
  type AtlasPosition,
}
