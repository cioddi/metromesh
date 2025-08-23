import { MercatorCoordinate } from "maplibre-gl";
import type { LngLat, Route } from "../types";

// Core train positioning and movement functions

// Comprehensive metro-style route coordinate generation
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

  // Only allow straight or 45-degree diagonal connections
  const absDx_m = Math.abs(dx_m);
  const absDy_m = Math.abs(dy_m);
  const signDx = Math.sign(dx_m);
  const signDy = Math.sign(dy_m);
  const diagThreshold = 0.000001;

  // If aligned horizontally, vertically, or diagonally, draw straight line
  const isHorizontal = absDy_m < alignmentThreshold;
  const isVertical = absDx_m < alignmentThreshold;
  const isDiagonal = Math.abs(absDx_m - absDy_m) < alignmentThreshold;

  if (isHorizontal || isVertical || isDiagonal) {
    coordinates.push([target.lng, target.lat]);
    return coordinates;
  }

  // Use 45-degree diagonal then straight segment
  const diagComponent = Math.min(absDx_m, absDy_m);
  const diagX = startMerc.x + signDx * diagComponent;
  const diagY = startMerc.y + signDy * diagComponent;
  const diagMerc = new MercatorCoordinate(diagX, diagY, 0);
  const diagLngLat = diagMerc.toLngLat();

  // Add diagonal point
  if (
    Math.abs(diagLngLat.lng - start.lng) > diagThreshold ||
    Math.abs(diagLngLat.lat - start.lat) > diagThreshold
  ) {
    coordinates.push([diagLngLat.lng, diagLngLat.lat]);
  }

  // Add final segment to target
  coordinates.push([target.lng, target.lat]);
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

  // Should not reach here - L-shaped routes handled above
  return startStation.position;
}

// Core route network interfaces for train movement

// Train movement network data (unmodified routes for accurate train positioning)
export interface TrainMovementNetwork {
  routes: Map<string, {
    routeId: string;
    stationPositions: LngLat[];  // Original station positions
    routeCoordinates: LngLat[];  // Unmodified route coordinates for train movement
  }>;
  lastUpdated: number;
}

// Main function to calculate the train movement network
export function calculateTrainMovementNetwork(
  routes: Route[],
  stations: Array<{
    id: string;
    position: LngLat;
    color: string;
    passengerCount: number;
  }>
): TrainMovementNetwork {
  // Quick dictionary for stations
  const ST = new Map<
    string,
    { id: string; position: LngLat; color: string; passengerCount: number }
  >(stations.map((s) => [s.id, s]));

  // Generate Train Movement Network (unmodified routes)
  const trainMovementRoutes = new Map<string, {
    routeId: string;
    stationPositions: LngLat[];
    routeCoordinates: LngLat[];
  }>();

  for (const route of routes) {
    if (route.stations.length < 2) continue;

    const routeStations = route.stations.map(id => ST.get(id)).filter(Boolean);
    if (routeStations.length < 2) continue;

    const stationPositions = routeStations.map(s => s!.position);
    const routeCoordinates: LngLat[] = [];

    // Generate unmodified route coordinates for train movement
    for (let i = 0; i < routeStations.length - 1; i++) {
      const start = routeStations[i]!;
      const end = routeStations[i + 1]!;
      const metroCoords = createMetroRouteCoordinates(start.position, end.position);

      // Add coordinates, avoiding duplication
      if (i === 0) {
        routeCoordinates.push({ lng: metroCoords[0][0], lat: metroCoords[0][1] });
      }

      for (let j = 1; j < metroCoords.length; j++) {
        routeCoordinates.push({ lng: metroCoords[j][0], lat: metroCoords[j][1] });
      }
    }

    trainMovementRoutes.set(route.id, {
      routeId: route.id,
      stationPositions,
      routeCoordinates
    });
  }

  return {
    routes: trainMovementRoutes,
    lastUpdated: Date.now(),
  };
}

// Helper function to get train position from train movement network
export function getTrainPositionFromMovementNetwork(
  trainMovementNetwork: TrainMovementNetwork,
  routeId: string,
  trainPosition: number
): LngLat {
  // Find the train movement route data
  const movementRoute = trainMovementNetwork.routes.get(routeId);
  if (!movementRoute || movementRoute.stationPositions.length < 2) {
    return { lng: 0, lat: 0 };
  }

  const stationPositions = movementRoute.stationPositions;
  
  // trainPosition is relative to station segments (e.g., 0.5 = halfway between stations 0 and 1)
  const clampedPosition = Math.max(0, Math.min(trainPosition, stationPositions.length - 1));
  const segmentIndex = Math.floor(clampedPosition);
  const segmentT = clampedPosition - segmentIndex;

  // Handle edge case where we're at the last station
  if (segmentIndex >= stationPositions.length - 1) {
    return stationPositions[stationPositions.length - 1];
  }

  const startStation = stationPositions[segmentIndex];
  const endStation = stationPositions[segmentIndex + 1];

  // Use the original metro route coordinate generation for accurate train positioning
  const metroCoords = createMetroRouteCoordinates(startStation, endStation);

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
      return startStation;
    }

    const distanceAlongRoute = segmentT * totalDistance;

    if (distanceAlongRoute <= seg1Distance) {
      // On first segment (diagonal)
      const subSegmentT = seg1Distance > 0 ? distanceAlongRoute / seg1Distance : 0;
      return {
        lng: startCoord[0] + (cornerCoord[0] - startCoord[0]) * subSegmentT,
        lat: startCoord[1] + (cornerCoord[1] - startCoord[1]) * subSegmentT,
      };
    } else {
      // On second segment (straight)
      const remainingDistance = distanceAlongRoute - seg1Distance;
      const subSegmentT = seg2Distance > 0 ? remainingDistance / seg2Distance : 0;
      return {
        lng: cornerCoord[0] + (endCoord[0] - cornerCoord[0]) * subSegmentT,
        lat: cornerCoord[1] + (endCoord[1] - cornerCoord[1]) * subSegmentT,
      };
    }
  }

  // Should not reach here - L-shaped routes handled above
  return startStation;
}

// Export helper functions that might be needed by other modules
export { createMetroRouteCoordinates, getTrainPositionOnMetroRoute };