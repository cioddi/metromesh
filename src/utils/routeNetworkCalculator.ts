import { MercatorCoordinate } from "maplibre-gl";
import type { LngLat, Route } from "../types";
import {
  calculateParallelRouteVisualization,
  type MicroSegment,
  type Corridor,
  type AttachmentPoint,
} from "./parallelRouteVisualizer";
import { getDistanceInMeters } from "./coordinates";

// Get route's corridor information as fallback for points without individual corridor info
// Interface for route corridor info used in visualization
interface RouteCorridorInfo {
  bandIndex: number;
  bandSize: number;
  spacing: number;
  direction: { x: number; y: number };
}

// Comprehensive metro-style route coordinate generation with perfect straight line guarantees
function createMetroRouteCoordinates(
  start: LngLat,
  target: LngLat
): number[][] {
  // Convert to Web Mercator coordinates for true visual calculations
  const startMerc = MercatorCoordinate.fromLngLat([start.lng, start.lat], 0);
  const targetMerc = MercatorCoordinate.fromLngLat([target.lng, target.lat], 0);

  const dx_m = targetMerc.x - startMerc.x;
  const dy_m = targetMerc.y - startMerc.y;

  // Start with the starting point
  const coordinates: number[][] = [[start.lng, start.lat]];

  // Calculate alignment thresholds in Mercator space
  const meterUnit = startMerc.meterInMercatorCoordinateUnits();
  const alignmentThreshold = 10 * meterUnit; // ~10m threshold
  const minStraightSegment = 30 * meterUnit; // Minimum 30m for straight segments

  // If already aligned horizontally or vertically, go straight
  if (Math.abs(dx_m) < alignmentThreshold) {
    coordinates.push([start.lng, target.lat]);
    return coordinates;
  }
  if (Math.abs(dy_m) < alignmentThreshold) {
    coordinates.push([target.lng, start.lat]);
    return coordinates;
  }

  // For dogleg routes, ensure both segments meet minimum length requirements
  const absDx_m = Math.abs(dx_m);
  const absDy_m = Math.abs(dy_m);

  // Determine route orientation and calculate optimal corner position
  let cornerMerc: MercatorCoordinate;
  let finalConnectionPoint: LngLat;

  if (absDx_m < absDy_m) {
    // Route ends with vertical segment
    const availableVertical = absDy_m;
    const diagonalComponent = Math.min(
      absDx_m,
      availableVertical - minStraightSegment
    );

    if (diagonalComponent <= 0) {
      // Not enough space for diagonal - go straight vertical
      coordinates.push([start.lng, target.lat]);
      return coordinates;
    }

    // Calculate corner position ensuring minimum straight segment
    const cornerY = startMerc.y + Math.sign(dy_m) * diagonalComponent;
    cornerMerc = new MercatorCoordinate(targetMerc.x, cornerY, 0);

    // Final connection point ensures perfect vertical alignment
    finalConnectionPoint = target; // Connect to station center for vertical approach
  } else {
    // Route ends with horizontal segment
    const availableHorizontal = absDx_m;
    const diagonalComponent = Math.min(
      absDy_m,
      availableHorizontal - minStraightSegment
    );

    if (diagonalComponent <= 0) {
      // Not enough space for diagonal - go straight horizontal
      coordinates.push([target.lng, start.lat]);
      return coordinates;
    }

    // Calculate corner position ensuring minimum straight segment
    const cornerX = startMerc.x + Math.sign(dx_m) * diagonalComponent;
    cornerMerc = new MercatorCoordinate(cornerX, targetMerc.y, 0);

    // Final connection point ensures perfect horizontal alignment
    finalConnectionPoint = target; // Connect to station center for horizontal approach
  }

  // Convert corner to lng-lat and ensure perfect metro alignment
  const cornerLngLat = cornerMerc.toLngLat();
  let cornerLng = cornerLngLat.lng;
  let cornerLat = cornerLngLat.lat;

  // Force perfect alignment by snapping corner to target's axis
  if (absDx_m < absDy_m) {
    // Vertical final segment - corner must share target's longitude exactly
    cornerLng = finalConnectionPoint.lng;
  } else {
    // Horizontal final segment - corner must share target's latitude exactly
    cornerLat = finalConnectionPoint.lat;
  }

  // Add corner point if it's significantly different from start
  const cornerThreshold = 0.000001;
  const lastCoord = coordinates[coordinates.length - 1];
  if (
    Math.abs(cornerLng - lastCoord[0]) > cornerThreshold ||
    Math.abs(cornerLat - lastCoord[1]) > cornerThreshold
  ) {
    coordinates.push([cornerLng, cornerLat]);
  }

  // Always add the final connection point
  coordinates.push([finalConnectionPoint.lng, finalConnectionPoint.lat]);

  return coordinates;
}

// Helper function to get position along metro route
function getTrainPositionOnMetroRoute(
  routeStations: Array<{ id: string; position: LngLat; color: string }>,
  trainPosition: number
): LngLat {
  if (routeStations.length < 2) {
    return routeStations[0]?.position || { lng: 0, lat: 0 };
  }

  // Clamp position to valid range
  const clampedPosition = Math.max(
    0,
    Math.min(trainPosition, routeStations.length - 1)
  );
  const segmentIndex = Math.floor(clampedPosition);
  const segmentT = clampedPosition - segmentIndex;

  // Handle edge case where we're at the last station
  if (segmentIndex >= routeStations.length - 1) {
    return routeStations[routeStations.length - 1].position;
  }

  const startStation = routeStations[segmentIndex];
  const endStation = routeStations[segmentIndex + 1];

  // Get the metro route coordinates for this segment
  const metroCoords = createMetroRouteCoordinates(
    startStation.position,
    endStation.position
  );

  if (metroCoords.length === 2) {
    // Direct route - simple interpolation
    const startCoord = metroCoords[0];
    const endCoord = metroCoords[1];
    return {
      lng: startCoord[0] + (endCoord[0] - startCoord[0]) * segmentT,
      lat: startCoord[1] + (endCoord[1] - startCoord[1]) * segmentT,
    };
  } else if (metroCoords.length === 3) {
    // L-shaped route with corner - need to calculate which segment we're on
    const startCoord = metroCoords[0];
    const cornerCoord = metroCoords[1];
    const endCoord = metroCoords[2];

    // Calculate distances of each segment
    const seg1Distance = Math.hypot(
      cornerCoord[0] - startCoord[0],
      cornerCoord[1] - startCoord[1]
    );
    const seg2Distance = Math.hypot(
      endCoord[0] - cornerCoord[0],
      endCoord[1] - cornerCoord[1]
    );
    const totalDistance = seg1Distance + seg2Distance;

    if (totalDistance === 0) {
      return startStation.position;
    }

    const distanceAlongRoute = segmentT * totalDistance;

    if (distanceAlongRoute <= seg1Distance) {
      // On first segment (diagonal)
      const segmentT = seg1Distance > 0 ? distanceAlongRoute / seg1Distance : 0;
      return {
        lng: startCoord[0] + (cornerCoord[0] - startCoord[0]) * segmentT,
        lat: startCoord[1] + (cornerCoord[1] - startCoord[1]) * segmentT,
      };
    } else {
      // On second segment (straight)
      const remainingDistance = distanceAlongRoute - seg1Distance;
      const segmentT = seg2Distance > 0 ? remainingDistance / seg2Distance : 0;
      return {
        lng: cornerCoord[0] + (endCoord[0] - cornerCoord[0]) * segmentT,
        lat: cornerCoord[1] + (endCoord[1] - cornerCoord[1]) * segmentT,
      };
    }
  }

  // Fallback to simple interpolation
  return {
    lng:
      startStation.position.lng +
      (endStation.position.lng - startStation.position.lng) * segmentT,
    lat:
      startStation.position.lat +
      (endStation.position.lat - startStation.position.lat) * segmentT,
  };
}

// Interface definitions for cached route network data

interface RoutePoint {
  pos: LngLat;
  mercator: { x: number; y: number; z: number };
  segmentIndex: number;
  pointIndex: number;
  corridorInfo: {
    bandIndex: number;
    bandSize: number;
    spacing: number;
    direction: { x: number; y: number };
  } | null;
  isStation: boolean;
}

interface RouteVisualizationData {
  routeId: string;
  coordinates: LngLat[];
  routePoints: RoutePoint[];
  // Pre-calculated 3D points ready for Three.js rendering
  renderPoints: Array<{ x: number; y: number; z: number }>;
  parallelOffset: number;
  attachmentPoints: Map<string, AttachmentPoint>;
  routeOffsetDirection: { x: number; y: number } | null;
}

// Main cached route network data structure
export interface CachedRouteNetwork {
  routes: RouteVisualizationData[];
  corridors: Corridor[];
  stationAttachmentPoints: Map<string, AttachmentPoint[]>;
  routeAttachmentPoints: Map<string, Map<string, AttachmentPoint>>;
  microSegments: MicroSegment[];
  lastUpdated: number;
}

// Main function to calculate the complete route network
export function calculateRouteNetwork(
  routes: Route[],
  stations: Array<{
    id: string;
    position: LngLat;
    color: string;
    passengerCount: number;
  }>
): CachedRouteNetwork {
  // Quick dictionary for stations
  const ST = new Map<
    string,
    { id: string; position: LngLat; color: string; passengerCount: number }
  >(stations.map((s) => [s.id, s]));

  // Calculate parallel route visualization data using dedicated module
  const parallelData = calculateParallelRouteVisualization(routes, stations);
  const {
    corridors,
    stationAttachmentPoints,
    routeAttachmentPoints,
    microSegments: allMicroSegments,
  } = parallelData;

  // PHASE 7: Generate Route Visualization Data with Pre-calculated Points and Offsets
  const routeVisualizationData: RouteVisualizationData[] = [];

  // Helper function to find corridor info for a position
  const findCorridorInfoForPosition = (
    pos: LngLat,
    routeId: string
  ): {
    bandIndex: number;
    bandSize: number;
    spacing: number;
    direction: { x: number; y: number };
  } | null => {
    // Find nearest micro-segment for this route
    let nearestMicro: MicroSegment | null = null;
    let minDistance = Infinity;

    const routeMicros = allMicroSegments.filter((m) => m.routeId === routeId);

    for (const micro of routeMicros) {
      const distance = getDistanceInMeters(pos, micro.centerPos);
      if (distance < minDistance) {
        minDistance = distance;
        nearestMicro = micro;
      }
    }

    if (!nearestMicro || minDistance > 50) return null; // Within 50m

    const relevantCorridors = corridors.filter((c) =>
      c.microSegments.some((m) => m.id === nearestMicro!.id)
    );
    if (relevantCorridors.length === 0) return null;

    const corridor = relevantCorridors[0];
    const routesInCorridor = Array.from(corridor.routes);
    const bandIndex = routesInCorridor.indexOf(routeId);
    const bandSize = corridor.routes.size;

    const isDiagonal =
      Math.abs(
        Math.abs(corridor.averageDirection.x) -
          Math.abs(corridor.averageDirection.y)
      ) < 0.3;
    const spacing = isDiagonal ? 50 : 25;

    return {
      bandIndex,
      bandSize,
      spacing,
      direction: corridor.averageDirection,
    };
  };

  // Helper function to calculate route offset direction
  const calculateRouteOffsetDirection = (
    routeCorridorInfo: RouteCorridorInfo | null
  ): { x: number; y: number } | null => {
    if (!routeCorridorInfo) return null;

    const direction = routeCorridorInfo.direction;
    // Return perpendicular direction for offset
    return { x: -direction.y, y: direction.x };
  };

  for (const route of routes) {
    if (route.stations.length < 2) continue;

    const routeStations = route.stations
      .map((id) => ST.get(id))
      .filter(Boolean);
    if (routeStations.length < 2) continue;

    // Generate base coordinates for the route
    const coordinates: LngLat[] = [];

    for (let i = 0; i < routeStations.length - 1; i++) {
      const start = routeStations[i]!;
      const end = routeStations[i + 1]!;
      const metroCoords = createMetroRouteCoordinates(
        start.position,
        end.position
      );

      // Add coordinates, avoiding duplication
      if (i === 0) {
        coordinates.push({ lng: metroCoords[0][0], lat: metroCoords[0][1] });
      }

      for (let j = 1; j < metroCoords.length; j++) {
        coordinates.push({ lng: metroCoords[j][0], lat: metroCoords[j][1] });
      }
    }

    // Pre-calculate all route points with corridor information
    const routePoints: RoutePoint[] = [];
    const routeMicros = allMicroSegments.filter((m) => m.routeId === route.id);

    const routeCorridorInfo: RouteCorridorInfo | null =
      routeMicros.length > 0
        ? (() => {
            const firstMicro = routeMicros[0];
            const corridorsForMicro = corridors.filter((c) =>
              c.microSegments.some((m) => m.id === firstMicro.id)
            );
            if (corridorsForMicro.length > 0) {
              const corridor = corridorsForMicro[0];
              const routesInCorridor = Array.from(corridor.routes);
              const bandIndex = routesInCorridor.indexOf(route.id);
              const bandSize = corridor.routes.size;
              const isDiagonal =
                Math.abs(
                  Math.abs(corridor.averageDirection.x) -
                    Math.abs(corridor.averageDirection.y)
                ) < 0.3;
              const spacing = isDiagonal ? 50 : 25;
              return {
                bandIndex,
                bandSize,
                spacing,
                direction: corridor.averageDirection,
              };
            }
            return null;
          })()
        : null;

    for (let i = 0; i < routeStations.length - 1; i++) {
      const a = routeStations[i]!,
        b = routeStations[i + 1]!;
      const coords = createMetroRouteCoordinates(a.position, b.position);

      const startIndex = i === 0 ? 0 : 1;
      for (let j = startIndex; j < coords.length; j++) {
        const [lng, lat] = coords[j];
        const currentPos = { lng, lat };
        const mercatorCoord = MercatorCoordinate.fromLngLat([lng, lat], 0);
        const corridorInfo = findCorridorInfoForPosition(currentPos, route.id);

        routePoints.push({
          pos: currentPos,
          mercator: {
            x: mercatorCoord.x,
            y: mercatorCoord.y,
            z: mercatorCoord.z,
          },
          segmentIndex: i,
          pointIndex: j,
          corridorInfo,
          isStation:
            (j === 0 && i === 0) ||
            (j === coords.length - 1 && i === routeStations.length - 2),
        });
      }
    }

    // Calculate route offset direction
    const routeOffsetDirection =
      calculateRouteOffsetDirection(routeCorridorInfo);

    // Pre-calculate final 3D render points with all offsets applied
    const renderPoints: Array<{ x: number; y: number; z: number }> = [];

    for (const point of routePoints) {
      const merc = point.mercator;
      let offsetX = 0,
        offsetY = 0;

      const corridorInfo = point.corridorInfo;
      if (corridorInfo && routeOffsetDirection) {
        const { bandIndex, bandSize, spacing } = corridorInfo;
        const centeredIdx = bandIndex - (bandSize - 1) / 2;
        const offsetMeters = centeredIdx * spacing;
        const metersToMerc = MercatorCoordinate.fromLngLat(
          [point.pos.lng, point.pos.lat],
          0
        ).meterInMercatorCoordinateUnits();

        // Apply consistent route-wide offset direction
        offsetX = routeOffsetDirection.x * offsetMeters * metersToMerc;
        offsetY = routeOffsetDirection.y * offsetMeters * metersToMerc;
      }

      const z =
        merc.z -
        MercatorCoordinate.fromLngLat(
          [point.pos.lng, point.pos.lat],
          0
        ).meterInMercatorCoordinateUnits() *
          5;
      renderPoints.push({
        x: merc.x + offsetX,
        y: merc.y + offsetY,
        z,
      });
    }

    // Validate and correct station connections for straight lines
    const validateAndCorrectPoints = (
      points: Array<{ x: number; y: number; z: number }>
    ): Array<{ x: number; y: number; z: number }> => {
      if (points.length >= 2) {
        for (let i = 0; i < points.length - 1; i++) {
          const dx = points[i + 1].x - points[i].x;
          const dy = points[i + 1].y - points[i].y;
          const length = Math.hypot(dx, dy);

          if (length > 0.000001) {
            const nx = dx / length;
            const ny = dy / length;

            // Check if this segment is straight
            const isHorizontal = Math.abs(ny) < 0.01;
            const isVertical = Math.abs(nx) < 0.01;
            const isDiagonal = Math.abs(Math.abs(nx) - Math.abs(ny)) < 0.01;

            if (!isHorizontal && !isVertical && !isDiagonal) {
              console.warn(
                `Route ${route.id} segment ${i} corrected to maintain straight line`
              );

              // Force correction by snapping to nearest valid direction
              if (Math.abs(nx) > Math.abs(ny)) {
                // More horizontal - force horizontal
                points[i + 1].y = points[i].y;
              } else {
                // More vertical - force vertical
                points[i + 1].x = points[i].x;
              }
            }
          }
        }
      }

      return points;
    };

    // Apply geometric validation and correction to render points
    const finalRenderPoints = validateAndCorrectPoints(renderPoints);

    // Calculate parallel offset based on corridor membership
    let parallelOffset = 0;
    const relevantCorridors = corridors.filter((c) => c.routes.has(route.id));

    if (relevantCorridors.length > 0) {
      // Use the corridor with the most micro-segments for this route
      const primaryCorridor = relevantCorridors.reduce((a, b) =>
        a.microSegments.filter((m) => m.routeId === route.id).length >
        b.microSegments.filter((m) => m.routeId === route.id).length
          ? a
          : b
      );

      // Calculate offset based on position within corridor
      const routesInCorridor = Array.from(primaryCorridor.routes);
      const routeIndex = routesInCorridor.indexOf(route.id);
      const numRoutesInCorridor = routesInCorridor.length;

      if (numRoutesInCorridor > 1) {
        const PARALLEL_SPACING = 15; // meters between parallel routes
        const centerOffset = (numRoutesInCorridor - 1) / 2;
        parallelOffset = (routeIndex - centerOffset) * PARALLEL_SPACING;
      }
    }

    const attachmentMap = routeAttachmentPoints.get(route.id) || new Map();

    routeVisualizationData.push({
      routeId: route.id,
      coordinates,
      routePoints,
      renderPoints: finalRenderPoints,
      parallelOffset,
      attachmentPoints: attachmentMap,
      routeOffsetDirection,
    });
  }

  return {
    routes: routeVisualizationData,
    corridors,
    stationAttachmentPoints,
    routeAttachmentPoints,
    microSegments: allMicroSegments,
    lastUpdated: Date.now(),
  };
}

// Helper function to get train position from cached route data
export function getTrainPositionFromCache(
  cachedNetwork: CachedRouteNetwork,
  routeId: string,
  trainPosition: number
): LngLat {
  // Find the cached route data
  const routeData = cachedNetwork.routes.find((r) => r.routeId === routeId);
  if (!routeData || routeData.coordinates.length === 0) {
    return { lng: 0, lat: 0 };
  }

  // Use the pre-calculated coordinates for position interpolation
  const coordinates = routeData.coordinates;
  const clampedPosition = Math.max(
    0,
    Math.min(trainPosition, coordinates.length - 1)
  );

  if (coordinates.length <= 1) {
    return coordinates[0] || { lng: 0, lat: 0 };
  }

  const segmentIndex = Math.floor(clampedPosition);
  const segmentT = clampedPosition - segmentIndex;

  if (segmentIndex >= coordinates.length - 1) {
    return coordinates[coordinates.length - 1];
  }

  const startCoord = coordinates[segmentIndex];
  const endCoord = coordinates[segmentIndex + 1];

  return {
    lng: startCoord.lng + (endCoord.lng - startCoord.lng) * segmentT,
    lat: startCoord.lat + (endCoord.lat - startCoord.lat) * segmentT,
  };
}

// Export helper functions that might be needed by the rendering layer
export { createMetroRouteCoordinates, getTrainPositionOnMetroRoute };
