import * as THREE from 'three'
import type { LngLat } from '../types'
import type { ThreeJsObject } from '../components/MlThreeJsLayer'

// Shared passenger geometries and materials for performance
let sharedPassengerGeometry: THREE.CylinderGeometry | null = null
let sharedPassengerMaterial: THREE.MeshBasicMaterial | null = null
let sharedTrainPassengerGeometry: THREE.CylinderGeometry | null = null
let sharedTrainPassengerMaterial: THREE.MeshBasicMaterial | null = null

// Initialize shared resources once
function initializeSharedResources() {
  if (!sharedPassengerGeometry) {
    sharedPassengerGeometry = new THREE.CylinderGeometry(
      0.15, // radiusTop
      0.15, // radiusBottom  
      0.3,  // height
      6,    // radialSegments (very low for performance)
      1     // heightSegments
    )
  }
  
  if (!sharedPassengerMaterial) {
    sharedPassengerMaterial = new THREE.MeshBasicMaterial({ 
      color: 0x555555, // Grey passengers
    })
  }
  
  if (!sharedTrainPassengerGeometry) {
    sharedTrainPassengerGeometry = new THREE.CylinderGeometry(
      0.1,  // radiusTop
      0.1,  // radiusBottom
      0.2,  // height  
      6,    // radialSegments (very low for performance)
      1     // heightSegments
    )
  }
  
  if (!sharedTrainPassengerMaterial) {
    sharedTrainPassengerMaterial = new THREE.MeshBasicMaterial({ 
      color: 0x333333, // Darker grey for train passengers
    })
  }
}

// Create a single passenger object
export function createPassengerObject(passenger: { 
  id: string; 
  position: LngLat; 
  isOnTrain?: boolean 
}): ThreeJsObject {
  initializeSharedResources()
  
  const geometry = passenger.isOnTrain ? sharedTrainPassengerGeometry! : sharedPassengerGeometry!
  const material = passenger.isOnTrain ? sharedTrainPassengerMaterial! : sharedPassengerMaterial!
  
  const mesh = new THREE.Mesh(geometry, material)
  mesh.userData = { 
    type: passenger.isOnTrain ? 'train-passenger' : 'passenger',
    passengerId: passenger.id 
  }
  
  return {
    id: passenger.id,
    position: passenger.position,
    altitude: 5, // 5m above ground
    scale: 50, // Scale to make visible on map
    object3D: mesh
  }
}

// Create an instanced mesh for multiple passengers at a station
export function createPassengerInstancedMesh(
  passengers: Array<{ id: string; position: LngLat; stationId: string }>,
  maxInstances: number = 1000
): THREE.InstancedMesh | null {
  if (passengers.length === 0) return null
  
  initializeSharedResources()
  
  const instancedMesh = new THREE.InstancedMesh(
    sharedPassengerGeometry!,
    sharedPassengerMaterial!,
    Math.min(passengers.length, maxInstances)
  )
  
  instancedMesh.userData = { type: 'passengers' }
  return instancedMesh
}

// Dispose shared resources (call on app cleanup)
export function disposeSharedPassengerResources() {
  if (sharedPassengerGeometry) {
    sharedPassengerGeometry.dispose()
    sharedPassengerGeometry = null
  }
  if (sharedPassengerMaterial) {
    sharedPassengerMaterial.dispose()
    sharedPassengerMaterial = null
  }
  if (sharedTrainPassengerGeometry) {
    sharedTrainPassengerGeometry.dispose()
    sharedTrainPassengerGeometry = null
  }
  if (sharedTrainPassengerMaterial) {
    sharedTrainPassengerMaterial.dispose()
    sharedTrainPassengerMaterial = null
  }
}