import { MercatorCoordinate } from 'maplibre-gl'
import type { LngLat, Route } from '../types'
import { createMetroRouteCoordinates } from './routeNetworkCalculator'

// Interface definitions for parallel route visualization
export interface MicroSegment {
  id: string;
  routeId: string;
  startPos: LngLat;
  endPos: LngLat;
  centerPos: LngLat;
  direction: { x: number; y: number }; // normalized direction vector
  length: number;
  routeT: number; // parameter along route (0-1)
  segmentIndex: number; // which route segment this micro-segment belongs to
}

export interface Corridor {
  id: string;
  microSegments: MicroSegment[];
  routes: Set<string>;
  centerLine: LngLat[];
  averageDirection: { x: number; y: number };
}

export interface AttachmentPoint {
  id: string
  stationId: string
  position: LngLat
  direction: { x: number; y: number } // Outward direction
  angle: number // In radians
  occupied: boolean
  routeId?: string
}

interface SpatialCell {
  microSegments: MicroSegment[];
}

export interface ParallelRouteData {
  corridors: Corridor[];
  stationAttachmentPoints: Map<string, AttachmentPoint[]>;
  routeAttachmentPoints: Map<string, Map<string, AttachmentPoint>>;
  microSegments: MicroSegment[];
}

// Helper functions for geometric calculations
const interpolatePosition = (start: LngLat, end: LngLat, t: number): LngLat => ({
  lng: start.lng + (end.lng - start.lng) * t,
  lat: start.lat + (end.lat - start.lat) * t
})

const getDistanceInMeters = (pos1: LngLat, pos2: LngLat): number => {
  // Use Web Mercator for accurate distance calculation
  const merc1 = MercatorCoordinate.fromLngLat([pos1.lng, pos1.lat], 0)
  const merc2 = MercatorCoordinate.fromLngLat([pos2.lng, pos2.lat], 0)
  
  const dx_m = merc2.x - merc1.x
  const dy_m = merc2.y - merc1.y
  const distance_m = Math.hypot(dx_m, dy_m)
  
  // Convert from Mercator units to meters
  const meterUnit = merc1.meterInMercatorCoordinateUnits()
  return distance_m / meterUnit
}

// Main function to calculate parallel route visualization data
export function calculateParallelRouteVisualization(
  routes: Route[],
  stations: Array<{ id: string; position: LngLat; color: string; passengerCount: number }>
): ParallelRouteData {
  
  // Quick dictionary for stations
  const ST = new Map<string, { id: string; position: LngLat; color: string; passengerCount: number }>(
    stations.map(s => [s.id, s])
  )

  // PHASE 1: Ultra-Dense Route Sampling for Precision Detection
  const allMicroSegments: MicroSegment[] = []
  const routeMicroSegments = new Map<string, MicroSegment[]>()
  const SAMPLING_DISTANCE_METERS = 10 // Much smaller for high precision

  let microSegmentCounter = 0

  for (const route of routes) {
    if (route.stations.length < 2) continue
    
    const routeStations = route.stations.map(id => ST.get(id)).filter(Boolean)
    if (routeStations.length < 2) continue

    const routeMicros: MicroSegment[] = []
    let totalRouteLength = 0
    
    // Calculate total route length using schematic paths
    for (let i = 0; i < routeStations.length - 1; i++) {
      const start = routeStations[i]!
      const end = routeStations[i + 1]!
      const schematicCoords = createMetroRouteCoordinates(start.position, end.position)
      
      // Sum lengths of all schematic sub-segments
      for (let j = 0; j < schematicCoords.length - 1; j++) {
        const subStart = { lng: schematicCoords[j][0], lat: schematicCoords[j][1] }
        const subEnd = { lng: schematicCoords[j + 1][0], lat: schematicCoords[j + 1][1] }
        const subSegLength = getDistanceInMeters(subStart, subEnd)
        totalRouteLength += subSegLength
      }
    }

    let currentRouteDistance = 0

    // Sample each segment of the route using schematic paths, smoothing corners
    for (let segIdx = 0; segIdx < routeStations.length - 1; segIdx++) {
      const start = routeStations[segIdx]!
      const end = routeStations[segIdx + 1]!
      const schematicCoords = createMetroRouteCoordinates(start.position, end.position)

      // If the schematic path has a corner (3 points), smooth the join
      if (schematicCoords.length === 3) {
        const [p0, p1, p2] = schematicCoords
        const cornerRadiusMeters = 20 // adjust for more/less smoothing
        // Convert to Mercator for arc calculation
        const m0 = MercatorCoordinate.fromLngLat([p0[0], p0[1]], 0)
        const m1 = MercatorCoordinate.fromLngLat([p1[0], p1[1]], 0)
        const m2 = MercatorCoordinate.fromLngLat([p2[0], p2[1]], 0)

        // Find direction vectors
        const v0 = { x: m1.x - m0.x, y: m1.y - m0.y }
        const v1 = { x: m2.x - m1.x, y: m2.y - m1.y }
        const len0 = Math.hypot(v0.x, v0.y)
        const len1 = Math.hypot(v1.x, v1.y)
        // Shorten the straight segments by the corner radius
        const r0 = Math.min(cornerRadiusMeters * m0.meterInMercatorCoordinateUnits(), len0 / 2)
        const r1 = Math.min(cornerRadiusMeters * m2.meterInMercatorCoordinateUnits(), len1 / 2)
        const arcStart = { x: m1.x - (v0.x / len0) * r0, y: m1.y - (v0.y / len0) * r0 }
        const arcEnd = { x: m1.x + (v1.x / len1) * r1, y: m1.y + (v1.y / len1) * r1 }

        // Convert arc points back to lng/lat
        const arcStartLngLat = MercatorCoordinate.fromLngLat([0,0],0)
        arcStartLngLat.x = arcStart.x; arcStartLngLat.y = arcStart.y;
        const arcStartLL = arcStartLngLat.toLngLat()
        const arcEndLngLat = MercatorCoordinate.fromLngLat([0,0],0)
        arcEndLngLat.x = arcEnd.x; arcEndLngLat.y = arcEnd.y;
        const arcEndLL = arcEndLngLat.toLngLat()

        // Sample first segment (p0 to arcStartLL)
        const seg1Start = { lng: p0[0], lat: p0[1] }
        const seg1End = { lng: arcStartLL.lng, lat: arcStartLL.lat }
        const seg1Length = getDistanceInMeters(seg1Start, seg1End)
        const numSeg1 = Math.max(2, Math.ceil(seg1Length / SAMPLING_DISTANCE_METERS))
        for (let i = 0; i < numSeg1 - 1; i++) {
          const t1 = i / (numSeg1 - 1)
          const t2 = (i + 1) / (numSeg1 - 1)
          const startPos = interpolatePosition(seg1Start, seg1End, t1)
          const endPos = interpolatePosition(seg1Start, seg1End, t2)
          const centerPos = interpolatePosition(startPos, endPos, 0.5)
          const startMerc = MercatorCoordinate.fromLngLat([startPos.lng, startPos.lat], 0)
          const endMerc = MercatorCoordinate.fromLngLat([endPos.lng, endPos.lat], 0)
          const dx_m = endMerc.x - startMerc.x
          const dy_m = endMerc.y - startMerc.y
          const len_m = Math.hypot(dx_m, dy_m)
          const microSeg: MicroSegment = {
            id: `micro-${microSegmentCounter++}`,
            routeId: route.id,
            startPos,
            endPos,
            centerPos,
            direction: len_m > 0 ? { x: dx_m / len_m, y: dy_m / len_m } : { x: 1, y: 0 },
            length: seg1Length,
            routeT: (currentRouteDistance + (i / (numSeg1 - 1)) * seg1Length) / totalRouteLength,
            segmentIndex: segIdx
          }
          routeMicros.push(microSeg)
          allMicroSegments.push(microSeg)
        }
        currentRouteDistance += seg1Length

        // Sample arc (quadratic Bézier from arcStartLL to arcEndLL, control at p1)
        const arcSamples = 5
        for (let i = 0; i < arcSamples - 1; i++) {
          const t1 = i / (arcSamples - 1)
          const t2 = (i + 1) / (arcSamples - 1)
          // Quadratic Bézier interpolation
          const bezier = (a: LngLat, b: LngLat, c: LngLat, t: number) => ({
            lng: (1 - t) * (1 - t) * a.lng + 2 * (1 - t) * t * b.lng + t * t * c.lng,
            lat: (1 - t) * (1 - t) * a.lat + 2 * (1 - t) * t * b.lat + t * t * c.lat
          })
          const startPos = bezier(seg1End, { lng: p1[0], lat: p1[1] }, seg1End, t1)
          const endPos = bezier(seg1End, { lng: p1[0], lat: p1[1] }, seg1End, t2)
          const centerPos = bezier(seg1End, { lng: p1[0], lat: p1[1] }, seg1End, (t1 + t2) / 2)
          const startMerc = MercatorCoordinate.fromLngLat([startPos.lng, startPos.lat], 0)
          const endMerc = MercatorCoordinate.fromLngLat([endPos.lng, endPos.lat], 0)
          const dx_m = endMerc.x - startMerc.x
          const dy_m = endMerc.y - startMerc.y
          const len_m = Math.hypot(dx_m, dy_m)
          const microSeg: MicroSegment = {
            id: `micro-${microSegmentCounter++}`,
            routeId: route.id,
            startPos,
            endPos,
            centerPos,
            direction: len_m > 0 ? { x: dx_m / len_m, y: dy_m / len_m } : { x: 1, y: 0 },
            length: len_m,
            routeT: (currentRouteDistance + (i / (arcSamples - 1)) * len_m) / totalRouteLength,
            segmentIndex: segIdx
          }
          routeMicros.push(microSeg)
          allMicroSegments.push(microSeg)
        }
        currentRouteDistance += getDistanceInMeters(seg1End, arcEndLL)

        // Sample second segment (arcEndLL to p2)
        const seg2Start = { lng: arcEndLL.lng, lat: arcEndLL.lat }
        const seg2End = { lng: p2[0], lat: p2[1] }
        const seg2Length = getDistanceInMeters(seg2Start, seg2End)
        const numSeg2 = Math.max(2, Math.ceil(seg2Length / SAMPLING_DISTANCE_METERS))
        for (let i = 0; i < numSeg2 - 1; i++) {
          const t1 = i / (numSeg2 - 1)
          const t2 = (i + 1) / (numSeg2 - 1)
          const startPos = interpolatePosition(seg2Start, seg2End, t1)
          const endPos = interpolatePosition(seg2Start, seg2End, t2)
          const centerPos = interpolatePosition(startPos, endPos, 0.5)
          const startMerc = MercatorCoordinate.fromLngLat([startPos.lng, startPos.lat], 0)
          const endMerc = MercatorCoordinate.fromLngLat([endPos.lng, endPos.lat], 0)
          const dx_m = endMerc.x - startMerc.x
          const dy_m = endMerc.y - startMerc.y
          const len_m = Math.hypot(dx_m, dy_m)
          const microSeg: MicroSegment = {
            id: `micro-${microSegmentCounter++}`,
            routeId: route.id,
            startPos,
            endPos,
            centerPos,
            direction: len_m > 0 ? { x: dx_m / len_m, y: dy_m / len_m } : { x: 1, y: 0 },
            length: seg2Length,
            routeT: (currentRouteDistance + (i / (numSeg2 - 1)) * seg2Length) / totalRouteLength,
            segmentIndex: segIdx
          }
          routeMicros.push(microSeg)
          allMicroSegments.push(microSeg)
        }
        currentRouteDistance += seg2Length
      } else {
        // No corner, just sample as before
        for (let subSegIdx = 0; subSegIdx < schematicCoords.length - 1; subSegIdx++) {
          const subStart = { lng: schematicCoords[subSegIdx][0], lat: schematicCoords[subSegIdx][1] }
          const subEnd = { lng: schematicCoords[subSegIdx + 1][0], lat: schematicCoords[subSegIdx + 1][1] }
          const subSegLength = getDistanceInMeters(subStart, subEnd)
          if (subSegLength < 1) continue
          const numSamples = Math.max(2, Math.ceil(subSegLength / SAMPLING_DISTANCE_METERS))
          for (let sampleIdx = 0; sampleIdx < numSamples - 1; sampleIdx++) {
            const t1 = sampleIdx / (numSamples - 1)
            const t2 = (sampleIdx + 1) / (numSamples - 1)
            const startPos = interpolatePosition(subStart, subEnd, t1)
            const endPos = interpolatePosition(subStart, subEnd, t2)
            const centerPos = interpolatePosition(startPos, endPos, 0.5)
            const startMerc = MercatorCoordinate.fromLngLat([startPos.lng, startPos.lat], 0)
            const endMerc = MercatorCoordinate.fromLngLat([endPos.lng, endPos.lat], 0)
            const dx_m = endMerc.x - startMerc.x
            const dy_m = endMerc.y - startMerc.y
            const len_m = Math.hypot(dx_m, dy_m)
            const microSeg: MicroSegment = {
              id: `micro-${microSegmentCounter++}`,
              routeId: route.id,
              startPos,
              endPos,
              centerPos,
              direction: len_m > 0 ? { x: dx_m / len_m, y: dy_m / len_m } : { x: 1, y: 0 },
              length: subSegLength,
              routeT: (currentRouteDistance + (sampleIdx / (numSamples - 1)) * subSegLength) / totalRouteLength,
              segmentIndex: segIdx
            }
            routeMicros.push(microSeg)
            allMicroSegments.push(microSeg)
          }
          currentRouteDistance += subSegLength
        }
      }
    }
    
    routeMicroSegments.set(route.id, routeMicros)
  }

  // PHASE 2: Multi-Scale Spatial Indexing for Complex Route Networks
  const FINE_GRID_SIZE = 0.0005 // ~50m fine-grained cells
  const COARSE_GRID_SIZE = 0.002 // ~200m coarse cells for large-scale patterns
  const spatialGrid = new Map<string, SpatialCell>()
  const coarseSpatialGrid = new Map<string, SpatialCell>()

  const getGridKey = (pos: LngLat, gridSize: number) => {
    const x = Math.floor(pos.lng / gridSize)
    const y = Math.floor(pos.lat / gridSize) 
    return `${x},${y}`
  }

  const getNeighborGridKeys = (pos: LngLat, gridSize: number, radius: number = 1) => {
    const cx = Math.floor(pos.lng / gridSize)
    const cy = Math.floor(pos.lat / gridSize)
    const keys: string[] = []
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        keys.push(`${cx + dx},${cy + dy}`)
      }
    }
    return keys
  }

  // Index in both fine and coarse grids
  for (const micro of allMicroSegments) {
    // Fine grid for precise detection
    const fineKey = getGridKey(micro.centerPos, FINE_GRID_SIZE)
    if (!spatialGrid.has(fineKey)) {
      spatialGrid.set(fineKey, { microSegments: [] })
    }
    spatialGrid.get(fineKey)!.microSegments.push(micro)
    
    // Coarse grid for pattern detection
    const coarseKey = getGridKey(micro.centerPos, COARSE_GRID_SIZE)
    if (!coarseSpatialGrid.has(coarseKey)) {
      coarseSpatialGrid.set(coarseKey, { microSegments: [] })
    }
    coarseSpatialGrid.get(coarseKey)!.microSegments.push(micro)
  }

  // PHASE 3: Advanced Multi-Layer Parallelism Detection for 8+ Routes
  const CLOSE_PROXIMITY_METERS = 75 // First layer: very close routes  
  const MEDIUM_PROXIMITY_METERS = 150 // Second layer: medium distance
  const FAR_PROXIMITY_METERS = 300 // Third layer: larger patterns
  const STRICT_PARALLEL_THRESHOLD = Math.PI / 12 // ~15 degrees for strict parallelism
  const LOOSE_PARALLEL_THRESHOLD = Math.PI / 6 // ~30 degrees for loose parallelism
  
  const parallelPairs: Array<{ a: MicroSegment; b: MicroSegment; distance: number; similarity: number; strength: number }> = []

  // Multi-layer detection with different thresholds
  const detectParallelism = (proximityThreshold: number, angleThreshold: number, strength: number) => {
    const gridSize = proximityThreshold < 100 ? FINE_GRID_SIZE : COARSE_GRID_SIZE
    const searchGrid = proximityThreshold < 100 ? spatialGrid : coarseSpatialGrid
    const searchRadius = proximityThreshold < 100 ? 1 : 2
    
    for (const microA of allMicroSegments) {
      const nearbyKeys = getNeighborGridKeys(microA.centerPos, gridSize, searchRadius)
      
      for (const key of nearbyKeys) {
        const cell = searchGrid.get(key)
        if (!cell) continue
        
        for (const microB of cell.microSegments) {
          // Skip same route and same micro-segment
          if (microA.routeId === microB.routeId || microA.id === microB.id) continue
          
          // Check if we already processed this pair
          if (microA.id > microB.id) continue
          
          const distance = getDistanceInMeters(microA.centerPos, microB.centerPos)
          if (distance > proximityThreshold) continue
          
          // Enhanced parallelism check with direction consistency
          const dotProduct = microA.direction.x * microB.direction.x + microA.direction.y * microB.direction.y
          const angleDiff = Math.acos(Math.min(1, Math.max(-1, Math.abs(dotProduct))))
          
          // Require same general direction (not anti-parallel) and within angle threshold
          if (angleDiff < angleThreshold && dotProduct > 0.3) {
            const similarity = Math.abs(dotProduct)
            // Boost similarity for truly co-directional segments
            const adjustedSimilarity = dotProduct > 0.8 ? similarity * 1.2 : similarity
            parallelPairs.push({ a: microA, b: microB, distance, similarity: adjustedSimilarity, strength })
          }
        }
      }
    }
  }
  
  // Three-layer detection for different scales
  detectParallelism(CLOSE_PROXIMITY_METERS, STRICT_PARALLEL_THRESHOLD, 3) // High confidence
  detectParallelism(MEDIUM_PROXIMITY_METERS, STRICT_PARALLEL_THRESHOLD, 2) // Medium confidence  
  detectParallelism(FAR_PROXIMITY_METERS, LOOSE_PARALLEL_THRESHOLD, 1) // Low confidence

  // PHASE 4: Revolutionary Station Attachment Grid System
  const stationAttachmentPoints = new Map<string, AttachmentPoint[]>()
  const ATTACHMENT_DISTANCE_METERS = 40 // Distance from station center
  
  // Generate attachment grids for each station
  for (const station of stations) {
    const points: AttachmentPoint[] = []
    let pointId = 0
    
    // Primary grid: 8 cardinal and ordinal directions (0°, 45°, 90°, 135°, 180°, 225°, 270°, 315°)
    for (let i = 0; i < 8; i++) {
      const angle = (i * Math.PI) / 4 // 45-degree increments
      const direction = { x: Math.cos(angle), y: Math.sin(angle) }
      
      // Convert to geographic coordinates
      const stationMerc = MercatorCoordinate.fromLngLat([station.position.lng, station.position.lat], 0)
      const offsetMeters = ATTACHMENT_DISTANCE_METERS * stationMerc.meterInMercatorCoordinateUnits()
      const attachmentMerc = new MercatorCoordinate(
        stationMerc.x + direction.x * offsetMeters,
        stationMerc.y + direction.y * offsetMeters,
        0
      )
      const attachmentPos = attachmentMerc.toLngLat()
      
      points.push({
        id: `${station.id}-attach-${pointId++}`,
        stationId: station.id,
        position: { lng: attachmentPos.lng, lat: attachmentPos.lat },
        direction,
        angle,
        occupied: false
      })
    }
    
    // Secondary grid: 16 more precise directions (22.5-degree increments)
    for (let i = 0; i < 16; i++) {
      const angle = (i * Math.PI) / 8 // 22.5-degree increments  
      // Skip angles already covered by primary grid
      if (i % 2 === 0) continue
      
      const direction = { x: Math.cos(angle), y: Math.sin(angle) }
      
      const stationMerc = MercatorCoordinate.fromLngLat([station.position.lng, station.position.lat], 0)
      const offsetMeters = ATTACHMENT_DISTANCE_METERS * stationMerc.meterInMercatorCoordinateUnits()
      const attachmentMerc = new MercatorCoordinate(
        stationMerc.x + direction.x * offsetMeters,
        stationMerc.y + direction.y * offsetMeters,
        0
      )
      const attachmentPos = attachmentMerc.toLngLat()
      
      points.push({
        id: `${station.id}-attach-${pointId++}`,
        stationId: station.id,
        position: { lng: attachmentPos.lng, lat: attachmentPos.lat },
        direction,
        angle,
        occupied: false
      })
    }
    
    // Sort by angle for easier access
    points.sort((a, b) => a.angle - b.angle)
    stationAttachmentPoints.set(station.id, points)
  }

  // PHASE 5: Intelligent Route-to-Attachment-Point Mapping
  const routeAttachmentPoints = new Map<string, Map<string, AttachmentPoint>>() // routeId -> stationId -> attachmentPoint
  
  // Assign optimal attachment points for each route
  for (const route of routes) {
    if (route.stations.length < 2) continue
    
    const routeStations = route.stations.map(id => ST.get(id)).filter(Boolean)
    if (routeStations.length < 2) continue
    
    const routeMap = new Map<string, AttachmentPoint>()
    
    // For each station in the route, find the best attachment point
    for (let i = 0; i < routeStations.length; i++) {
      const station = routeStations[i]!
      const attachmentPoints = stationAttachmentPoints.get(station.id) || []
      
      let bestPoint: AttachmentPoint | null = null
      let bestScore = -Infinity
      
      // Determine preferred direction based on route geometry
      let preferredDirection: { x: number; y: number } | null = null
      
      if (i > 0 && i < routeStations.length - 1) {
        // Middle station - consider both neighbors
        const prev = routeStations[i - 1]!
        const next = routeStations[i + 1]!
        
        const prevDir = {
          x: prev.position.lng - station.position.lng,
          y: prev.position.lat - station.position.lat
        }
        const nextDir = {
          x: next.position.lng - station.position.lng,
          y: next.position.lat - station.position.lat
        }
        
        // Average direction
        const avgX = (prevDir.x + nextDir.x) / 2
        const avgY = (prevDir.y + nextDir.y) / 2
        const len = Math.hypot(avgX, avgY)
        preferredDirection = len > 0 ? { x: avgX / len, y: avgY / len } : null
      } else if (i === 0 && routeStations.length > 1) {
        // First station - look towards second
        const next = routeStations[1]!
        const dx = next.position.lng - station.position.lng
        const dy = next.position.lat - station.position.lat
        const len = Math.hypot(dx, dy)
        preferredDirection = len > 0 ? { x: dx / len, y: dy / len } : null
      } else if (i === routeStations.length - 1 && routeStations.length > 1) {
        // Last station - look towards previous
        const prev = routeStations[i - 1]!
        const dx = prev.position.lng - station.position.lng
        const dy = prev.position.lat - station.position.lat
        const len = Math.hypot(dx, dy)
        preferredDirection = len > 0 ? { x: dx / len, y: dy / len } : null
      }
      
      // Score attachment points based on alignment and availability
      for (const point of attachmentPoints) {
        let score = 0
        
        // Prefer unoccupied points
        if (!point.occupied) score += 100
        
        // Prefer points aligned with route direction
        if (preferredDirection) {
          const alignment = point.direction.x * preferredDirection.x + point.direction.y * preferredDirection.y
          score += alignment * 50 // Up to 50 bonus points for perfect alignment
        }
        
        // Prefer standard metro directions (cardinal + ordinal)
        const standardAngles = [0, Math.PI/4, Math.PI/2, 3*Math.PI/4, Math.PI, 5*Math.PI/4, 3*Math.PI/2, 7*Math.PI/4]
        const isStandardAngle = standardAngles.some(angle => Math.abs(point.angle - angle) < 0.01)
        if (isStandardAngle) score += 25
        
        if (score > bestScore) {
          bestScore = score
          bestPoint = point
        }
      }
      
      if (bestPoint) {
        bestPoint.occupied = true
        bestPoint.routeId = route.id
        routeMap.set(station.id, bestPoint)
      }
    }
    
    routeAttachmentPoints.set(route.id, routeMap)
  }

  // PHASE 6: Advanced Corridor Construction
  const corridors: Corridor[] = []
  let corridorIdCounter = 0

  // Weighted Union-Find for stronger parallel connections
  const corridorGroups = new Map<string, Set<MicroSegment>>()
  const parent = new Map<string, string>()
  const weight = new Map<string, number>()
  
  const find = (id: string): string => {
    if (!parent.has(id)) {
      parent.set(id, id)
      weight.set(id, 1)
      return id
    }
    if (parent.get(id) !== id) {
      parent.set(id, find(parent.get(id)!))
    }
    return parent.get(id)!
  }

  const union = (a: string, b: string, connectionStrength: number = 1) => {
    const rootA = find(a)
    const rootB = find(b)
    if (rootA !== rootB) {
      const weightA = weight.get(rootA) || 1
      const weightB = weight.get(rootB) || 1
      
      // Union by weighted strength
      if (weightA >= weightB) {
        parent.set(rootB, rootA)
        weight.set(rootA, weightA + weightB + connectionStrength)
      } else {
        parent.set(rootA, rootB)
        weight.set(rootB, weightA + weightB + connectionStrength)
      }
    }
  }

  // Group parallel micro-segments with strength weighting
  for (const pair of parallelPairs) {
    union(pair.a.id, pair.b.id, pair.strength)
  }

  // Collect groups
  for (const micro of allMicroSegments) {
    const root = find(micro.id)
    if (!corridorGroups.has(root)) {
      corridorGroups.set(root, new Set())
    }
    corridorGroups.get(root)!.add(micro)
  }

  // Create sophisticated corridors from groups (supporting 8+ routes)
  for (const [, microSet] of corridorGroups) {
    const micros = Array.from(microSet)
    const routeSet = new Set(micros.map(m => m.routeId))
    
    // Create corridors for multi-route groups (2+ routes)
    if (routeSet.size >= 2) {
      const corridor: Corridor = {
        id: `corridor-${corridorIdCounter++}`,
        microSegments: micros,
        routes: routeSet,
        centerLine: [],
        averageDirection: { x: 0, y: 0 }
      }
      
      // Compute weighted average direction with attachment point influence
      let avgDx = 0
      let avgDy = 0
      let len = 0
      
      for (const micro of micros) {
        const weight = micro.length || 1
        avgDx += micro.direction.x * weight
        avgDy += micro.direction.y * weight
        len += weight
      }
      
      // Also consider attachment point directions for this corridor
      for (const routeId of routeSet) {
        const attachmentMap = routeAttachmentPoints.get(routeId)
        if (attachmentMap) {
          for (const [, attachment] of attachmentMap) {
            avgDx += attachment.direction.x * 0.5 // Lower weight for attachment points
            avgDy += attachment.direction.y * 0.5
            len += 0.5
          }
        }
      }
      
      corridor.averageDirection = len > 0 ? { x: avgDx / len, y: avgDy / len } : { x: 1, y: 0 }
      
      // Sort micro-segments along the corridor using geometric centroid
      const centroidLng = micros.reduce((sum, m) => sum + m.centerPos.lng, 0) / micros.length
      const centroidLat = micros.reduce((sum, m) => sum + m.centerPos.lat, 0) / micros.length
      
      micros.sort((a, b) => {
        const projA = (a.centerPos.lng - centroidLng) * corridor.averageDirection.x + 
                     (a.centerPos.lat - centroidLat) * corridor.averageDirection.y
        const projB = (b.centerPos.lng - centroidLng) * corridor.averageDirection.x + 
                     (b.centerPos.lat - centroidLat) * corridor.averageDirection.y
        return projA - projB
      })
      corridor.microSegments = micros
      
      corridors.push(corridor)
    }
  }

  return {
    corridors,
    stationAttachmentPoints,
    routeAttachmentPoints,
    microSegments: allMicroSegments
  }
}