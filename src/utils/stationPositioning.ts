import type { LngLat } from '../types'
import { GAME_CONFIG } from '../config/gameConfig'

interface Station {
  id: string
  position: LngLat
  color: string
  passengerCount: number
  overloadedSince?: number
  buildingDensity?: number
}

interface GameBounds {
  southwest: LngLat
  northeast: LngLat
}

// Calculate distance between two points using Haversine formula
export function calculateDistance(pos1: LngLat, pos2: LngLat): number {
  const R = 6371000 // Earth's radius in meters
  const dLat = (pos2.lat - pos1.lat) * Math.PI / 180
  const dLng = (pos2.lng - pos1.lng) * Math.PI / 180
  const lat1 = pos1.lat * Math.PI / 180
  const lat2 = pos2.lat * Math.PI / 180

  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1) * Math.cos(lat2) *
    Math.sin(dLng/2) * Math.sin(dLng/2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))

  return R * c // Distance in meters
}

// Calculate the center point of a bounding box
export function calculateBoundsCenter(bounds: GameBounds): LngLat {
  return {
    lng: bounds.southwest.lng + (bounds.northeast.lng - bounds.southwest.lng) / 2,
    lat: bounds.southwest.lat + (bounds.northeast.lat - bounds.southwest.lat) / 2
  }
}

// Generate random position within bounds, respecting distance constraints and avoiding water
export function generateStationPosition(
  existingStations: Station[] = [], 
  bounds: GameBounds,
  waterCheckFn?: (position: LngLat) => boolean,
  isInitialStation: boolean = false
): LngLat {
  const MAX_ATTEMPTS = 50
  const MIN_DISTANCE = GAME_CONFIG.minStationDistance
  const MAX_DISTANCE = isInitialStation 
    ? GAME_CONFIG.maxInitialStationDistance 
    : GAME_CONFIG.maxRegularStationDistance

  const boundsWidth = bounds.northeast.lng - bounds.southwest.lng
  const boundsHeight = bounds.northeast.lat - bounds.southwest.lat
  const mapCenter = calculateBoundsCenter(bounds)

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let candidate: LngLat

    if (isInitialStation) {
      // For initial stations, generate within maxInitialStationDistance of map center
      const radius = Math.random() * (MAX_DISTANCE / 111320) // Convert meters to rough degrees
      const angle = Math.random() * 2 * Math.PI
      candidate = {
        lng: mapCenter.lng + radius * Math.cos(angle),
        lat: mapCenter.lat + radius * Math.sin(angle)
      }
    } else {
      // For regular stations, use full bounds
      candidate = {
        lng: bounds.southwest.lng + Math.random() * boundsWidth,
        lat: bounds.southwest.lat + Math.random() * boundsHeight
      }
    }

    // Check if position is on water (if water check function is provided)
    if (waterCheckFn && waterCheckFn(candidate)) {
      continue // Skip this position, it's on water
    }

    // For initial stations, ensure they're within max distance from map center
    if (isInitialStation) {
      const distanceFromCenter = calculateDistance(candidate, mapCenter)
      if (distanceFromCenter > MAX_DISTANCE) {
        continue // Skip if too far from center
      }
    }

    // If no existing stations, any valid position (non-water, within bounds) is acceptable
    if (existingStations.length === 0) {
      return candidate
    }

    // Check distances to all existing stations
    let tooClose = false
    let tooFar = true

    for (const station of existingStations) {
      const distance = calculateDistance(candidate, station.position)

      if (distance < MIN_DISTANCE) {
        tooClose = true
        break
      }

      if (distance <= MAX_DISTANCE) {
        tooFar = false
      }
    }

    // Valid position: not too close to any station and within range of at least one
    if (!tooClose && !tooFar) {
      return candidate
    }
  }

  // No valid position found after maximum attempts
  throw new Error(`Failed to find valid station position after ${MAX_ATTEMPTS} attempts`)
}