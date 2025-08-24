import * as THREE from 'three'
import type { LngLat } from '../types'
import type { ThreeJsObject } from '../components/MlThreeJsLayer'

// Shared route materials for performance
let sharedTubeMaterial: THREE.MeshLambertMaterial | null = null
let sharedLineMaterial: THREE.LineBasicMaterial | null = null
let sharedRingMaterial: THREE.MeshLambertMaterial | null = null

// Initialize shared resources once
function initializeSharedResources() {
  if (!sharedTubeMaterial) {
    sharedTubeMaterial = new THREE.MeshLambertMaterial({
      color: 0xffffff, // Will be overridden per route
      transparent: false
    })
  }
  
  if (!sharedLineMaterial) {
    sharedLineMaterial = new THREE.LineBasicMaterial({
      color: 0xffffff, // Will be overridden per route
      linewidth: 4, // Reduced from 8
      transparent: false
    })
  }
  
  if (!sharedRingMaterial) {
    sharedRingMaterial = new THREE.MeshLambertMaterial({
      color: 0xffffff, // Will be overridden per ring
      transparent: true,
      opacity: 0.9
    })
  }
}

export interface RouteRenderData {
  coordinates: LngLat[]
  color: string
  routeId: string
  isParallel?: boolean
  renderPoints?: Array<{ x: number; y: number; z: number }>
}

// Create a route visualization object
export function createRouteObject(routeData: RouteRenderData): ThreeJsObject {
  const group = new THREE.Group()
  
  if (routeData.isParallel && routeData.renderPoints) {
    // Use pre-calculated parallel route points
    createParallelRoute(group, routeData)
  } else {
    // Create simple route
    createSimpleRoute(group, routeData)
  }
  
  group.userData = { 
    type: routeData.isParallel ? 'route' : 'route-simple',
    routeId: routeData.routeId 
  }
  
  return {
    id: routeData.routeId,
    position: routeData.coordinates[0], // Use first coordinate as reference
    altitude: 1, // 1m above ground
    scale: 1, // No scaling for routes
    object3D: group
  }
}

// Create parallel route with sophisticated rendering
function createParallelRoute(group: THREE.Group, routeData: RouteRenderData) {
  if (!routeData.renderPoints || routeData.renderPoints.length < 2) return
  
  const points = routeData.renderPoints.map(p => new THREE.Vector3(p.x, p.y, p.z))
  const curve = new THREE.CatmullRomCurve3(points)
  
  // Create tube geometry for smooth, rounded routes
  const tubeGeometry = new THREE.TubeGeometry(
    curve,
    Math.max(10, Math.floor(points.length * 2)), // segments
    0.05, // radius - thin line
    8, // radial segments
    false // not closed
  )
  
  initializeSharedResources()
  
  // Clone and customize material for this route
  const material = sharedTubeMaterial!.clone()
  material.color.setStyle(routeData.color)
  
  const mesh = new THREE.Mesh(tubeGeometry, material)
  
  group.add(mesh)
}

// Create simple route with basic line geometry
function createSimpleRoute(group: THREE.Group, routeData: RouteRenderData) {
  if (routeData.coordinates.length < 2) return
  
  // Create line segments between coordinates
  for (let i = 0; i < routeData.coordinates.length - 1; i++) {
    const start = routeData.coordinates[i]
    const end = routeData.coordinates[i + 1]
    
    const points = [
      new THREE.Vector3(start.lng, start.lat, 0),
      new THREE.Vector3(end.lng, end.lat, 0)
    ]
    
    initializeSharedResources()
    
    const geometry = new THREE.BufferGeometry().setFromPoints(points)
    // Clone and customize material for this route segment
    const material = sharedLineMaterial!.clone()
    material.color.setStyle(routeData.color)
    
    const line = new THREE.Line(geometry, material)
    line.userData = { type: 'route-simple', routeId: routeData.routeId, segment: i }
    group.add(line)
  }
}

// Create route ring effects for stations
export function createRouteRingObject(config: {
  id: string
  position: LngLat
  color: string
  radius: number
  thickness: number
  opacity?: number
  emissiveIntensity?: number
}): ThreeJsObject {
  initializeSharedResources()
  
  const ringGeometry = new THREE.RingGeometry(
    config.radius, // Inner radius
    config.radius + config.thickness, // Outer radius
    32 // Reduced segment count
  )
  
  // Clone and customize material for this ring
  const ringMaterial = sharedRingMaterial!.clone()
  ringMaterial.color.setStyle(config.color)
  ringMaterial.opacity = config.opacity || 0.9
  
  const ring = new THREE.Mesh(ringGeometry, ringMaterial)
  ring.rotation.x = Math.PI / 2 // Lay flat
  ring.position.z = 0.03 // Slightly above ground
  
  ring.userData = { 
    type: 'selection-ring',
    routeColor: config.color 
  }
  
  return {
    id: config.id,
    position: config.position,
    altitude: 0,
    scale: 50,
    object3D: ring
  }
}

// Dispose shared resources (call on app cleanup)
export function disposeSharedRouteResources() {
  if (sharedTubeMaterial) {
    sharedTubeMaterial.dispose()
    sharedTubeMaterial = null
  }
  if (sharedLineMaterial) {
    sharedLineMaterial.dispose()
    sharedLineMaterial = null
  }
  if (sharedRingMaterial) {
    sharedRingMaterial.dispose()
    sharedRingMaterial = null
  }
}