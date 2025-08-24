import * as THREE from 'three'
import type { LngLat } from '../types'
import type { ThreeJsObject } from '../components/MlThreeJsLayer'

// Shared station geometries and materials for performance
let sharedBaseGeometry: THREE.CylinderGeometry | null = null
let sharedBaseMaterial: THREE.MeshLambertMaterial | null = null
let sharedStationGeometry: THREE.CylinderGeometry | null = null
let sharedStationMaterial: THREE.MeshLambertMaterial | null = null

// Initialize shared resources once
function initializeSharedResources() {
  if (!sharedBaseGeometry) {
    sharedBaseGeometry = new THREE.CylinderGeometry(1.3, 1.3, 0.05, 16) // Reduced segments
  }
  
  if (!sharedBaseMaterial) {
    sharedBaseMaterial = new THREE.MeshLambertMaterial({ 
      color: 0x555555, // Darker opaque color instead of transparent
      side: THREE.DoubleSide // Render both front and back faces
    })
  }
  
  if (!sharedStationGeometry) {
    sharedStationGeometry = new THREE.CylinderGeometry(1, 1, 0.5, 16) // Reduced segments
  }
  
  if (!sharedStationMaterial) {
    sharedStationMaterial = new THREE.MeshLambertMaterial({ 
      color: 0xffffff,
      side: THREE.DoubleSide // Render both front and back faces
    })
  }
}

// Accepts full or partial station (id, position, color)
export function createStationObject(station: { id: string; position: LngLat; color: string }): ThreeJsObject {
  initializeSharedResources()
  // Create a group to hold both the base and the station
  const group = new THREE.Group()
  
  // Create the grey transparent base using shared resources
  const baseMesh = new THREE.Mesh(sharedBaseGeometry!, sharedBaseMaterial!)
  baseMesh.rotation.x = Math.PI / 2 // Rotate to lay flat
  baseMesh.position.z = -0.25 // Slightly below the main station
  
  // Create the white station disk on top using shared resources
  const mesh = new THREE.Mesh(sharedStationGeometry!, sharedStationMaterial!)
  mesh.rotation.x = Math.PI / 2 // Rotate to lay flat
  
  // Add both to the group
  group.add(baseMesh)
  group.add(mesh)
  
  return {
    id: station.id,
    position: station.position,
    altitude: 0, // At ground level
    scale: 50, // Larger scale to make visible
    object3D: group
  }
}

// Dispose shared resources (call on app cleanup)
export function disposeSharedStationResources() {
  if (sharedBaseGeometry) {
    sharedBaseGeometry.dispose()
    sharedBaseGeometry = null
  }
  if (sharedBaseMaterial) {
    sharedBaseMaterial.dispose()
    sharedBaseMaterial = null
  }
  if (sharedStationGeometry) {
    sharedStationGeometry.dispose()
    sharedStationGeometry = null
  }
  if (sharedStationMaterial) {
    sharedStationMaterial.dispose()
    sharedStationMaterial = null
  }
}