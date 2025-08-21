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
  passengerSpawnProbability: 0.05, // Per game loop cycle (100ms) - half the rate
  maxStations: 8,
  initialZoom: 12,
  gameLoopInterval: 100, // milliseconds
} as const;

// Train settings
export const TRAIN_CONFIG = {
  defaultSpeedKmh: 500, // Speed in km/h
  defaultCapacity: 6,
} as const;

// Generate random position within London bounds
export function generateRandomPosition(): LngLat {
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