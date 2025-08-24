import type { LngLat } from '../types';
import { getCurrentCity, getCityCenter, getCityBounds } from '../utils/cityStorage';

// Get current city for dynamic configuration
const currentCity = getCurrentCity();

// Current city bounding box for station generation
export const CITY_BOUNDS = getCityBounds(currentCity);

// Calculate bounds dimensions
export const BOUNDS_WIDTH = CITY_BOUNDS.northeast.lng - CITY_BOUNDS.southwest.lng;
export const BOUNDS_HEIGHT = CITY_BOUNDS.northeast.lat - CITY_BOUNDS.southwest.lat;

// Game map center (from selected city)
export const MAP_CENTER: LngLat = getCityCenter(currentCity);

// Legacy London bounds for backwards compatibility (if needed)
export const LONDON_BOUNDS = {
  southwest: { lng: -0.16785167250222344, lat: 51.494542306198014 },
  northeast: { lng: -0.07911706882524072, lat: 51.53028184893728 }
} as const;

// Game settings
export const GAME_CONFIG = {
  stationSpawnProbability: 0.0015, // Per game loop cycle (100ms) - half the rate
  passengerSpawnProbability: 0.045, // Balanced spawn rate for optimal gameplay
  maxStations: 33,
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
  maxRenderedPassengers: 400, // Max individual passenger objects
  maxPassengersPerStation: 20, // Max passengers shown per station
  maxTrainPassengers: 9, // Max passenger dots per train
  reducedSphereSegments: 6, // Lower geometry quality for passengers
  enableInstancedRendering: true, // Use instanced meshes
} as const;

// Train settings
export const TRAIN_CONFIG = {
  defaultSpeedKmh: 700, // Speed in km/h
  defaultCapacity: 6,
} as const;

