import * as THREE from 'three'
import type { Station, Route, Train, Passenger, LngLat } from '../types'
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

export function createRouteObject(route: Route, stations: Station[]): ThreeJsObject[] {
  const routeObjects: ThreeJsObject[] = []
  
  if (route.stations.length < 2) return routeObjects
  
  // Create line segments between consecutive stations
  for (let i = 0; i < route.stations.length - 1; i++) {
    const fromStation = stations.find(s => s.id === route.stations[i])
    const toStation = stations.find(s => s.id === route.stations[i + 1])
    
    if (!fromStation || !toStation) continue
    
    // Create a cylinder to represent the route (better than lines for 3D)
    const distance = Math.sqrt(
      Math.pow(toStation.position.lng - fromStation.position.lng, 2) + 
      Math.pow(toStation.position.lat - fromStation.position.lat, 2)
    )
    
    // Convert rough lng/lat distance to meters (very rough approximation)
    const distanceMeters = distance * 111000 // Rough conversion
    
    const geometry = new THREE.CylinderGeometry(2, 2, distanceMeters, 8) // 2m radius tube
    const material = new THREE.MeshBasicMaterial({ 
      color: route.color,
      transparent: true,
      opacity: 0.7
    })
    
    const cylinder = new THREE.Mesh(geometry, material)
    
    // Calculate midpoint
    const midLng = (fromStation.position.lng + toStation.position.lng) / 2
    const midLat = (fromStation.position.lat + toStation.position.lat) / 2
    
    // Calculate rotation to align with direction
    const angle = Math.atan2(
      toStation.position.lat - fromStation.position.lat,
      toStation.position.lng - fromStation.position.lng
    )
    
    routeObjects.push({
      id: `${route.id}-segment-${i}`,
      position: { lng: midLng, lat: midLat },
      altitude: 2,
      rotation: { x: 0, y: 0, z: angle + Math.PI / 2 },
      scale: 1,
      object3D: cylinder
    })
  }
  
  return routeObjects
}

export function createTrainObject(train: Train, route: Route, stations: Station[]): ThreeJsObject | null {
  const routeStations = route.stations.map(id => stations.find(s => s.id === id)).filter(Boolean) as Station[]
  
  if (routeStations.length < 2) return null
  
  // Calculate current position along route
  const currentIndex = Math.floor(train.position)
  const nextIndex = (currentIndex + 1) % routeStations.length
  const t = train.position - currentIndex
  
  const currentStation = routeStations[currentIndex]
  const nextStation = routeStations[nextIndex]
  
  if (!currentStation || !nextStation) return null
  
  // Interpolate position
  const interpolatedPos: LngLat = {
    lng: currentStation.position.lng + (nextStation.position.lng - currentStation.position.lng) * t,
    lat: currentStation.position.lat + (nextStation.position.lat - currentStation.position.lat) * t
  }
  
  // Create train geometry in real-world meters
  const geometry = new THREE.BoxGeometry(40, 20, 10) // 20m x 8m x 4m train
  const material = new THREE.MeshBasicMaterial({ color: 0x333333 })
  const mesh = new THREE.Mesh(geometry, material)
  
  // Note: Passenger rendering now handled directly in GameThreeLayer
  
  return {
    id: train.id,
    position: interpolatedPos,
    altitude: 10,
    scale: 1,
    object3D: mesh
  }
}

// Overload to allow partial station and index/total for ring arrangement
export function createPassengerObject(
  passenger: Passenger,
  stations: Array<{ id: string; position: LngLat }>
): ThreeJsObject | null {
  const station = stations.find(s => s.id === passenger.origin)
  if (!station) return null
  const geometry = new THREE.SphereGeometry(1, 16, 12) // Sphere for passenger
  const material = new THREE.MeshPhysicalMaterial({ 
    color: passenger.color, // Keep original vibrant destination color
    emissive: new THREE.Color(passenger.color).multiplyScalar(0.2), // Moderate emissive
    roughness: 0.3, // Slightly rough plastic
    metalness: 0.0, // Non-metallic
    envMapIntensity: 0.6, // Good reflections
    clearcoat: 0.2, // Light clearcoat
    clearcoatRoughness: 0.1, // Smooth clearcoat
    side: THREE.DoubleSide // Render both sides
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.castShadow = true
  mesh.receiveShadow = true
  return {
    id: passenger.id,
    position: station.position,
    altitude: 0, // At ground level
    scale: 20, // Larger scale to make visible
    object3D: mesh
  }
}