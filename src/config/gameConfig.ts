import type { LngLat } from '../types';

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
  passengerSpawnProbability: 0.065, // Balanced spawn rate for optimal gameplay
  maxStations: 12,
  initialZoom: 13,
  maxZoom: 16,
  gameLoopInterval: 100, // milliseconds
  minStationSpawnDelay: 15000, // Minimum time (ms) between station spawns - prevents too frequent spawning
  maxStationSpawnDelay: 20000, // Maximum time (ms) between station spawns - guarantees station every 20s
  // Station distance constraints
  minStationDistance: 500, // Minimum distance between stations in meters
  maxInitialStationDistance: 1500, // Maximum distance for initial stations in meters
  maxRegularStationDistance: 1500, // Maximum distance for regular stations in meters
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
  defaultSpeedKmh: 700, // Speed in km/h
  defaultCapacity: 6,
} as const;

