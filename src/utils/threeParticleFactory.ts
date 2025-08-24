import * as THREE from 'three'
import type { LngLat } from '../types'
import type { ThreeJsObject } from '../components/MlThreeJsLayer'

// Shared particle geometries and materials for performance
let sharedDistressGeometry: THREE.CylinderGeometry | null = null
let sharedDistressMaterial: THREE.MeshBasicMaterial | null = null
let sharedGlowGeometry: THREE.SphereGeometry | null = null
let sharedGlowMaterial: THREE.MeshBasicMaterial | null = null

// Initialize shared resources once
function initializeSharedResources() {
  if (!sharedDistressGeometry) {
    sharedDistressGeometry = new THREE.CylinderGeometry(
      0.05, // radiusTop
      0.05, // radiusBottom
      0.1,  // height
      4,    // radialSegments (minimal for particles)
      1     // heightSegments
    )
  }
  
  if (!sharedDistressMaterial) {
    sharedDistressMaterial = new THREE.MeshBasicMaterial({
      color: 0xFF6666, // Light red for distress particles
      transparent: true,
      opacity: 0.7
    })
  }
  
  if (!sharedGlowGeometry) {
    sharedGlowGeometry = new THREE.SphereGeometry(1.8, 32, 16)
  }
  
  if (!sharedGlowMaterial) {
    sharedGlowMaterial = new THREE.MeshBasicMaterial({
      color: 0xFF3333, // Red glow
      transparent: true,
      opacity: 0.15 // Very transparent glow
    })
  }
}

// Simplified distress particle effect (single particle instead of multiple)
export function createDistressParticleObject(config: {
  id: string
  position: LngLat
  particleCount?: number
  spread?: number
}): ThreeJsObject {
  initializeSharedResources()
  
  // Create single small particle instead of multiple particles
  const particle = new THREE.Mesh(sharedDistressGeometry!, sharedDistressMaterial!)
  particle.userData = { 
    type: 'distress-particle',
    stationId: config.id 
  }
  
  return {
    id: config.id,
    position: config.position,
    altitude: 3, // 3m above ground
    scale: 30, // Smaller scale
    object3D: particle
  }
}

// Minimal distress glow effect (much smaller and subtle)
export function createDistressGlowObject(config: {
  id: string
  position: LngLat
  intensity?: number
}): ThreeJsObject {
  initializeSharedResources()
  
  const glowMesh = new THREE.Mesh(sharedGlowGeometry!, sharedGlowMaterial!)
  glowMesh.scale.setScalar((config.intensity || 1) * 0.3) // Much smaller
  
  glowMesh.userData = { 
    type: 'distress-glow',
    stationId: config.id 
  }
  
  return {
    id: config.id + '-glow',
    position: config.position,
    altitude: 0,
    scale: 25, // Smaller scale
    object3D: glowMesh
  }
}

// Shared unconnected ring resources
let sharedUnconnectedGeometry: THREE.RingGeometry | null = null
let sharedUnconnectedMaterial: THREE.MeshBasicMaterial | null = null

// Initialize unconnected ring resources
function initializeUnconnectedResources() {
  if (!sharedUnconnectedGeometry) {
    sharedUnconnectedGeometry = new THREE.RingGeometry(
      2.2, // Inner radius
      2.5, // Outer radius
      16 // Segments
    )
  }
  
  if (!sharedUnconnectedMaterial) {
    sharedUnconnectedMaterial = new THREE.MeshBasicMaterial({
      color: 0x6975dd, // Purple color
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide
    })
  }
}

// Subtle unconnected station ring (smaller and less prominent)
export function createUnconnectedRingObject(config: {
  id: string
  position: LngLat
  radius?: number
}): ThreeJsObject {
  initializeUnconnectedResources()
  
  const ring = new THREE.Mesh(sharedUnconnectedGeometry!, sharedUnconnectedMaterial!)
  ring.rotation.x = Math.PI / 2 // Lay flat
  ring.position.z = 0.02 // Slightly above ground
  ring.scale.setScalar(0.6) // Make smaller and more subtle
  
  ring.userData = { 
    type: 'unconnected-ring',
    stationId: config.id 
  }
  
  return {
    id: config.id + '-unconnected',
    position: config.position,
    altitude: 0,
    scale: 35, // Smaller scale
    object3D: ring
  }
}

// Dispose shared resources (call on app cleanup)
export function disposeSharedParticleResources() {
  if (sharedDistressGeometry) {
    sharedDistressGeometry.dispose()
    sharedDistressGeometry = null
  }
  if (sharedDistressMaterial) {
    sharedDistressMaterial.dispose()
    sharedDistressMaterial = null
  }
  if (sharedGlowGeometry) {
    sharedGlowGeometry.dispose()
    sharedGlowGeometry = null
  }
  if (sharedGlowMaterial) {
    sharedGlowMaterial.dispose()
    sharedGlowMaterial = null
  }
  if (sharedUnconnectedGeometry) {
    sharedUnconnectedGeometry.dispose()
    sharedUnconnectedGeometry = null
  }
  if (sharedUnconnectedMaterial) {
    sharedUnconnectedMaterial.dispose()
    sharedUnconnectedMaterial = null
  }
}