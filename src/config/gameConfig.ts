import type { LngLat } from '../types';

// Define Station interface for distance calculations
interface Station {
  position: LngLat;
}

// London central area bounding box for station generation
export const LONDON_BOUNDS = {
  southwest: { lng: -0.16785167250222344, lat: 51.494542306198014 },
  northeast: { lng: -0.07911706882524072, lat: 51.53028184893728 }
} as const;

// Calculate bounds dimensions
export const BOUNDS_WIDTH = LONDON_BOUNDS.northeast.lng - LONDON_BOUNDS.southwest.lng;
export const BOUNDS_HEIGHT = LONDON_BOUNDS.northeast.lat - LONDON_BOUNDS.southwest.lat;

// Game map center (middle of bounding box)
export const MAP_CENTER: LngLat = {
  lng: LONDON_BOUNDS.southwest.lng + BOUNDS_WIDTH / 2,
  lat: LONDON_BOUNDS.southwest.lat + BOUNDS_HEIGHT / 2
};

// Game settings
export const GAME_CONFIG = {
  stationSpawnProbability: 0.0015, // Per game loop cycle (100ms) - half the rate
  passengerSpawnProbability: 0.045, // Increased by 1.5x from 0.03
  maxStations: 8,
  initialZoom: 13,
  gameLoopInterval: 100, // milliseconds
} as const;

// Performance settings
export const PERFORMANCE_CONFIG = {
  maxRenderedPassengers: 100, // Max individual passenger objects
  maxPassengersPerStation: 10, // Max passengers shown per station
  maxTrainPassengers: 9, // Max passenger dots per train
  reducedSphereSegments: 6, // Lower geometry quality for passengers
  enableInstancedRendering: true, // Use instanced meshes
} as const;

// Train settings
export const TRAIN_CONFIG = {
  defaultSpeedKmh: 500, // Speed in km/h
  defaultCapacity: 6,
} as const;

// Calculate distance between two points in meters (approximate)
export function calculateDistance(pos1: LngLat, pos2: LngLat): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = (pos2.lat - pos1.lat) * Math.PI / 180;
  const dLng = (pos2.lng - pos1.lng) * Math.PI / 180;
  const lat1 = pos1.lat * Math.PI / 180;
  const lat2 = pos2.lat * Math.PI / 180;

  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1) * Math.cos(lat2) *
    Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c; // Distance in meters
}

// Generate random position within London bounds, respecting distance constraints and avoiding water
export function generateRandomPosition(
  existingStations: Station[] = [], 
  waterCheckFn?: (position: LngLat) => boolean
): LngLat {
  const MAX_ATTEMPTS = 50;
  const MIN_DISTANCE = 500; // 500 meters
  const MAX_DISTANCE = 1500; // 1500 meters
  
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const candidate: LngLat = {
      lng: LONDON_BOUNDS.southwest.lng + Math.random() * BOUNDS_WIDTH,
      lat: LONDON_BOUNDS.southwest.lat + Math.random() * BOUNDS_HEIGHT
    };
    
    // Check if position is on water (if water check function is provided)
    if (waterCheckFn && waterCheckFn(candidate)) {
      continue; // Skip this position, it's on water
    }
    
    // If no existing stations, any non-water position is valid
    if (existingStations.length === 0) {
      return candidate;
    }
    
    // Check distances to all existing stations
    let tooClose = false;
    let tooFar = true;
    
    for (const station of existingStations) {
      const distance = calculateDistance(candidate, station.position);
      
      if (distance < MIN_DISTANCE) {
        tooClose = true;
        break;
      }
      
      if (distance <= MAX_DISTANCE) {
        tooFar = false;
      }
    }
    
    // Valid position: not too close to any station and within range of at least one
    if (!tooClose && !tooFar) {
      return candidate;
    }
  }
  
  // Fallback: return a random position (better than no station)
  return {
    lng: LONDON_BOUNDS.southwest.lng + Math.random() * BOUNDS_WIDTH,
    lat: LONDON_BOUNDS.southwest.lat + Math.random() * BOUNDS_HEIGHT
  };
}

// Initial station positions within bounds
export const INITIAL_STATIONS: LngLat[] = [
  { lng: -0.1278, lat: 51.5074 }, // Near London Bridge
  { lng: -0.1000, lat: 51.5155 }, // Near Bank
];