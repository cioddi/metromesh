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

// Create distress particle effect
export function createDistressParticleObject(config: {
  id: string
  position: LngLat
  particleCount?: number
  spread?: number
}): ThreeJsObject {
  initializeSharedResources()
  
  const group = new THREE.Group()
  const particleCount = config.particleCount || 8
  const spread = config.spread || 2
  
  // Create multiple small particles around the position
  for (let i = 0; i < particleCount; i++) {
    const particle = new THREE.Mesh(sharedDistressGeometry!, sharedDistressMaterial!)
    
    // Random position around the center
    const angle = (i / particleCount) * Math.PI * 2
    const distance = Math.random() * spread
    particle.position.x = Math.cos(angle) * distance
    particle.position.y = Math.sin(angle) * distance
    particle.position.z = Math.random() * 0.5 // Random height variation
    
    // Random rotation
    particle.rotation.x = Math.random() * Math.PI
    particle.rotation.y = Math.random() * Math.PI
    particle.rotation.z = Math.random() * Math.PI
    
    group.add(particle)
  }
  
  group.userData = { 
    type: 'distress-particle',
    stationId: config.id 
  }
  
  return {
    id: config.id,
    position: config.position,
    altitude: 3, // 3m above ground
    scale: 50,
    object3D: group
  }
}

// Create distress glow effect
export function createDistressGlowObject(config: {
  id: string
  position: LngLat
  intensity?: number
}): ThreeJsObject {
  initializeSharedResources()
  
  const glowMesh = new THREE.Mesh(sharedGlowGeometry!, sharedGlowMaterial!)
  glowMesh.scale.setScalar(config.intensity || 1)
  
  glowMesh.userData = { 
    type: 'distress-glow',
    stationId: config.id 
  }
  
  return {
    id: config.id + '-glow',
    position: config.position,
    altitude: 0,
    scale: 50,
    object3D: glowMesh
  }
}

// Create unconnected station ring
export function createUnconnectedRingObject(config: {
  id: string
  position: LngLat
  radius?: number
}): ThreeJsObject {
  const ringGeometry = new THREE.RingGeometry(
    config.radius || 2.2, // Inner radius
    (config.radius || 2.2) + 0.3, // Outer radius
    16 // Segments
  )
  
  const ringMaterial = new THREE.MeshBasicMaterial({
    color: 0x6975dd, // Purple color
    transparent: true,
    opacity: 0.8,
    side: THREE.DoubleSide
  })
  
  const ring = new THREE.Mesh(ringGeometry, ringMaterial)
  ring.rotation.x = Math.PI / 2 // Lay flat
  ring.position.z = 0.02 // Slightly above ground
  
  ring.userData = { 
    type: 'unconnected-ring',
    stationId: config.id 
  }
  
  return {
    id: config.id + '-unconnected',
    position: config.position,
    altitude: 0,
    scale: 50,
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
}