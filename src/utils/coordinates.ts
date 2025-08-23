import type { LngLat, Position } from '../types'
import { MercatorCoordinate } from 'maplibre-gl'

const EARTH_RADIUS = 6371000

export function lngLatToWorldPosition(lngLat: LngLat): Position {
  const x = (lngLat.lng / 360) * 2 * Math.PI * EARTH_RADIUS
  const y = Math.log(Math.tan((90 + lngLat.lat) * Math.PI / 360)) * EARTH_RADIUS
  return { x, y }
}

export function worldPositionToLngLat(position: Position): LngLat {
  const lng = (position.x / (2 * Math.PI * EARTH_RADIUS)) * 360
  const lat = (Math.atan(Math.exp(position.y / EARTH_RADIUS)) * 360 / Math.PI) - 90
  return { lng, lat }
}

export function calculateDistance(pos1: LngLat, pos2: LngLat): number {
  const dLat = (pos2.lat - pos1.lat) * Math.PI / 180
  const dLng = (pos2.lng - pos1.lng) * Math.PI / 180
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(pos1.lat * Math.PI / 180) * Math.cos(pos2.lat * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return EARTH_RADIUS * c
}

export function interpolatePosition(start: LngLat, end: LngLat, t: number): LngLat {
  return {
    lng: start.lng + (end.lng - start.lng) * t,
    lat: start.lat + (end.lat - start.lat) * t
  }
}

// Web Mercator-based distance calculation for consistency
export function getDistanceInMeters(pos1: LngLat, pos2: LngLat): number {
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