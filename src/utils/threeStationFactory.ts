import * as THREE from 'three'
import type { LngLat } from '../types'
import type { ThreeJsObject } from '../components/MlThreeJsLayer'

// Accepts full or partial station (id, position, color)
export function createStationObject(station: { id: string; position: LngLat; color: string }): ThreeJsObject {
  // Create a group to hold both the base and the station
  const group = new THREE.Group()
  
  // Create the grey transparent base (larger and lower) with plastic material
  const baseGeometry = new THREE.CylinderGeometry(1.3, 1.3, 0.05, 32) // Larger radius, thinner height
  const baseMaterial = new THREE.MeshStandardMaterial({ 
    color: 0x666666, // Darker grey base
    transparent: true,
    opacity: 0.8,
    roughness: 0.2, // Smooth plastic
    metalness: 0.0, // Non-metallic
    envMapIntensity: 0.5, // Subtle reflections
    side: THREE.DoubleSide // Render both sides
  })
  const baseMesh = new THREE.Mesh(baseGeometry, baseMaterial)
  baseMesh.rotation.x = Math.PI / 2 // Rotate to lay flat
  baseMesh.position.z = -0.25 // Slightly below the main station
  baseMesh.castShadow = true
  baseMesh.receiveShadow = true
  
  // Create the white station disk on top with glossy plastic material
  const geometry = new THREE.CylinderGeometry(1, 1, 0.5, 32) // Flat disk: radius 1, height 0.1
  const material = new THREE.MeshPhysicalMaterial({ 
    color: 0xffffff, // White stations
    roughness: 0.1, // Very smooth plastic
    metalness: 0.0, // Non-metallic
    envMapIntensity: 0.8, // Strong reflections for glossy look
    clearcoat: 0.3, // Add clearcoat for extra glossiness
    clearcoatRoughness: 0.05, // Smooth clearcoat
    side: THREE.DoubleSide // Render both sides
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.rotation.x = Math.PI / 2 // Rotate to lay flat
  mesh.castShadow = true
  mesh.receiveShadow = true
  
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