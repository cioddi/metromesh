import * as THREE from 'three'
import type { LngLat } from '../types'
import type { ThreeJsObject } from '../components/MlThreeJsLayer'

// Shared train geometries and materials for performance
let sharedTrainGeometry: THREE.BoxGeometry | null = null
let sharedTrainMaterial: THREE.MeshPhysicalMaterial | null = null

// Initialize shared resources once
function initializeSharedResources() {
  if (!sharedTrainGeometry) {
    // Simple box geometry for trains
    sharedTrainGeometry = new THREE.BoxGeometry(0.8, 0.4, 0.3) // length, width, height
  }
  
  if (!sharedTrainMaterial) {
    sharedTrainMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xffffff, // White trains
      roughness: 0.2,
      metalness: 0.1,
      envMapIntensity: 0.5,
      side: THREE.DoubleSide
    })
  }
}

// Create a train object
export function createTrainObject(train: { 
  id: string; 
  position: LngLat; 
  routeColor: string;
  direction?: number; // rotation in radians
  capacity?: number;
  passengerCount?: number;
}): ThreeJsObject {
  initializeSharedResources()
  
  const group = new THREE.Group()
  
  // Create train body
  const trainMesh = new THREE.Mesh(sharedTrainGeometry!, sharedTrainMaterial!)
  trainMesh.castShadow = true
  trainMesh.receiveShadow = true
  
  // Add route color stripe
  const stripeGeometry = new THREE.PlaneGeometry(0.8, 0.1)
  const stripeMaterial = new THREE.MeshBasicMaterial({ 
    color: train.routeColor,
    side: THREE.DoubleSide 
  })
  const stripe = new THREE.Mesh(stripeGeometry, stripeMaterial)
  stripe.position.y = 0.2 // On top of train
  stripe.position.z = 0.01 // Slightly above to avoid z-fighting
  
  group.add(trainMesh)
  group.add(stripe)
  
  // Rotate train based on direction
  if (train.direction !== undefined) {
    group.rotation.z = train.direction
  }
  
  group.userData = { 
    type: 'train',
    trainId: train.id,
    routeColor: train.routeColor,
    capacity: train.capacity || 6,
    passengerCount: train.passengerCount || 0
  }
  
  return {
    id: train.id,
    position: train.position,
    altitude: 3, // 3m above ground
    scale: 50,
    object3D: group
  }
}

// Dispose shared resources (call on app cleanup)
export function disposeSharedTrainResources() {
  if (sharedTrainGeometry) {
    sharedTrainGeometry.dispose()
    sharedTrainGeometry = null
  }
  if (sharedTrainMaterial) {
    sharedTrainMaterial.dispose()
    sharedTrainMaterial = null
  }
}