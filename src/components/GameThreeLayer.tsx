import { useEffect, useRef } from 'react'
import { useMap } from '@mapcomponents/react-maplibre'
import * as THREE from 'three'
import { MercatorCoordinate } from 'maplibre-gl'
import type { LngLat, Route, Train, Passenger } from '../types'
import { createStationObject } from '../utils/threeObjectFactories'
import { PERFORMANCE_CONFIG } from '../config/gameConfig'

// Helper function to create metro-style route coordinates
function createMetroRouteCoordinates(start: LngLat, target: LngLat): number[][] {
  const dx = target.lng - start.lng;
  const dy = target.lat - start.lat;
  
  // Start with the starting point
  const coordinates: number[][] = [[start.lng, start.lat]];
  
  // If already aligned horizontally or vertically, go straight
  if (Math.abs(dx) < 0.0001) {
    coordinates.push([start.lng, target.lat]);
    return coordinates;
  }
  if (Math.abs(dy) < 0.0001) {
    coordinates.push([target.lng, start.lat]);
    return coordinates;
  }
  
  // Calculate which direction to go diagonally first
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  
  // Determine the 45-degree direction
  const diagonalDx = dx > 0 ? 1 : -1;
  const diagonalDy = dy > 0 ? 1 : -1;
  
  // Go 45 degrees until we align with target on one axis
  const diagonalDistance = Math.min(absDx, absDy);
  
  // Calculate the corner point
  const cornerLng = start.lng + diagonalDx * diagonalDistance;
  const cornerLat = start.lat + diagonalDy * diagonalDistance;
  
  // Add the corner point
  coordinates.push([cornerLng, cornerLat]);
  
  // Add the final target point
  coordinates.push([target.lng, target.lat]);
  
  return coordinates;
}

// Helper function to get position along metro route
function getTrainPositionOnMetroRoute(routeStations: Array<{ id: string; position: LngLat; color: string }>, trainPosition: number): LngLat {
  if (!routeStations || routeStations.length === 0) {
    return { lng: 0, lat: 0 };
  }
  
  const currentIndex = Math.max(0, Math.min(Math.floor(trainPosition), routeStations.length - 1));
  const nextIndex = Math.min(currentIndex + 1, routeStations.length - 1);
  const t = trainPosition - currentIndex;
  
  const currentStation = routeStations[currentIndex];
  const nextStation = routeStations[nextIndex];
  
  if (!currentStation || !nextStation || currentStation.id === nextStation.id) {
    return currentStation?.position || { lng: 0, lat: 0 };
  }
  
  // Get the metro route coordinates for this segment
  const routeCoords = createMetroRouteCoordinates(currentStation.position, nextStation.position);
  
  // Find position along the route coordinates
  if (routeCoords.length === 2) {
    // Straight line - simple interpolation
    return {
      lng: routeCoords[0][0] + (routeCoords[1][0] - routeCoords[0][0]) * t,
      lat: routeCoords[0][1] + (routeCoords[1][1] - routeCoords[0][1]) * t
    };
  } else if (routeCoords.length === 3) {
    // L-shaped route with corner - need to calculate which segment we're on
    const startCoord = routeCoords[0];
    const cornerCoord = routeCoords[1];
    const endCoord = routeCoords[2];
    
    // Calculate distances of each segment
    const seg1Distance = Math.sqrt(
      Math.pow(cornerCoord[0] - startCoord[0], 2) + 
      Math.pow(cornerCoord[1] - startCoord[1], 2)
    );
    const seg2Distance = Math.sqrt(
      Math.pow(endCoord[0] - cornerCoord[0], 2) + 
      Math.pow(endCoord[1] - cornerCoord[1], 2)
    );
    const totalDistance = seg1Distance + seg2Distance;
    
    const distanceAlongRoute = t * totalDistance;
    
    if (distanceAlongRoute <= seg1Distance) {
      // On first segment (diagonal)
      const segmentT = seg1Distance > 0 ? distanceAlongRoute / seg1Distance : 0;
      return {
        lng: startCoord[0] + (cornerCoord[0] - startCoord[0]) * segmentT,
        lat: startCoord[1] + (cornerCoord[1] - startCoord[1]) * segmentT
      };
    } else {
      // On second segment (straight)
      const remainingDistance = distanceAlongRoute - seg1Distance;
      const segmentT = seg2Distance > 0 ? remainingDistance / seg2Distance : 0;
      return {
        lng: cornerCoord[0] + (endCoord[0] - cornerCoord[0]) * segmentT,
        lat: cornerCoord[1] + (endCoord[1] - cornerCoord[1]) * segmentT
      };
    }
  }
  
  // Fallback to simple interpolation
  return {
    lng: currentStation.position.lng + (nextStation.position.lng - currentStation.position.lng) * t,
    lat: currentStation.position.lat + (nextStation.position.lat - nextStation.position.lat) * t
  };
}

interface GameData {
  stations: Array<{ id: string; position: LngLat; color: string; passengerCount: number }>
  routes: Route[]
  trains: Train[]
  passengers: Passenger[] // Not used with simple count approach
}

interface GameThreeLayerProps {
  gameData: GameData
  onStationClick?: (stationId: string) => void
  selectedStationId?: string | null
}

const GameThreeLayer = ({ gameData, onStationClick, selectedStationId }: GameThreeLayerProps) => {
  const mapContext = useMap()
  const layerRef = useRef<any>(null) // eslint-disable-line @typescript-eslint/no-explicit-any
  const raycasterRef = useRef<THREE.Raycaster | null>(null)
  const mouseRef = useRef<THREE.Vector2 | null>(null)
  
  // Shared geometries and materials for performance
  const sharedGeometriesRef = useRef<{
    passengerGeometry?: THREE.SphereGeometry
    trainPassengerGeometry?: THREE.SphereGeometry
    passengerMaterial?: THREE.MeshBasicMaterial
    trainPassengerMaterial?: THREE.MeshStandardMaterial
    selectionRingGeometry?: THREE.RingGeometry
    selectionRingMaterial?: THREE.MeshBasicMaterial
    unconnectedRingGeometry?: THREE.RingGeometry
    unconnectedRingMaterial?: THREE.MeshBasicMaterial
    distressParticleGeometry?: THREE.SphereGeometry
    distressParticleMaterial?: THREE.MeshBasicMaterial
  }>({})
  
  // Instanced meshes for passengers
  const instancedMeshesRef = useRef<{
    stationPassengers?: THREE.InstancedMesh
    trainPassengers?: THREE.InstancedMesh
  }>({})
  
  // Initialize the layer once  
  useEffect(() => {
    if (!mapContext?.map) return
    
    const map = mapContext.map
    
    // Don't reinitialize if already done
    if (map.getLayer('stations-3d')) {
      // Get existing layer reference
      const existingLayer = map.getLayer('stations-3d') as any // eslint-disable-line @typescript-eslint/no-explicit-any
      layerRef.current = existingLayer
      return
    }
    
    console.log('Setting up Three.js layer with map:', map)
    
    const customLayer = {
      id: 'stations-3d',
      type: 'custom' as const,
      renderingMode: '3d' as const,
      camera: undefined as THREE.Camera | undefined,
      scene: undefined as THREE.Scene | undefined,
      renderer: undefined as THREE.WebGLRenderer | undefined,
      
      onAdd: function(mapInstance: any, gl: WebGLRenderingContext | WebGL2RenderingContext) { // eslint-disable-line @typescript-eslint/no-explicit-any
        console.log('Three.js layer onAdd called')
        
        this.camera = new THREE.Camera()
        this.scene = new THREE.Scene()
        
        // Multiple directional lights for super bright, saturated plastic look
        
        // Main key light (top-down bright)
        const keyLight = new THREE.DirectionalLight(0xffffff, 2.0)
        keyLight.position.set(0, 500, 200)
        keyLight.castShadow = true
        keyLight.shadow.mapSize.width = 2048
        keyLight.shadow.mapSize.height = 2048
        this.scene.add(keyLight)
        
        // Fill light from opposite side
        const fillLight = new THREE.DirectionalLight(0xffffff, 1.5)
        fillLight.position.set(-200, 300, -100)
        this.scene.add(fillLight)
        
        // Rim light for edge highlighting
        const rimLight = new THREE.DirectionalLight(0xffffff, 1.0)
        rimLight.position.set(300, 100, 300)
        this.scene.add(rimLight)
        
        // Bottom light to eliminate dark shadows
        const bottomLight = new THREE.DirectionalLight(0xffffff, 0.8)
        bottomLight.position.set(0, -200, 100)
        this.scene.add(bottomLight)
        
        // Much brighter ambient light for vibrant saturated colors
        const ambientLight = new THREE.AmbientLight(0xffffff, 2.5)
        this.scene.add(ambientLight)
        
        // Create renderer
        this.renderer = new THREE.WebGLRenderer({
          canvas: mapInstance.getCanvas(),
          context: gl,
          antialias: true
        })
        
        // Enable PBR features with bright, saturated output
        this.renderer.autoClear = false
        this.renderer.shadowMap.enabled = true
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping
        this.renderer.toneMappingExposure = 1.8 // Higher exposure for brighter, more saturated colors
        this.renderer.outputColorSpace = THREE.SRGBColorSpace
        
        // Wait for next frame to ensure renderer is fully initialized
        requestAnimationFrame(() => {
          // Add environment lighting for reflections (after renderer is ready)
          const pmremGenerator = new THREE.PMREMGenerator(this.renderer!)
          pmremGenerator.compileCubemapShader()
          const envTexture = pmremGenerator.fromScene(new THREE.Scene(), 0.04).texture
          this.scene!.environment = envTexture
          pmremGenerator.dispose()
        })
        
        console.log('Three.js renderer created')
        
        // Initialize raycaster and mouse for click detection
        raycasterRef.current = new THREE.Raycaster()
        mouseRef.current = new THREE.Vector2()
        
        // Initialize shared geometries and materials for performance
        sharedGeometriesRef.current.passengerGeometry = new THREE.SphereGeometry(
          0.3, 
          PERFORMANCE_CONFIG.reducedSphereSegments, 
          PERFORMANCE_CONFIG.reducedSphereSegments
        )
        sharedGeometriesRef.current.trainPassengerGeometry = new THREE.SphereGeometry(
          0.2, 
          PERFORMANCE_CONFIG.reducedSphereSegments, 
          PERFORMANCE_CONFIG.reducedSphereSegments
        )
        sharedGeometriesRef.current.passengerMaterial = new THREE.MeshBasicMaterial({ 
          color: 0x555555,
          side: THREE.DoubleSide
        })
        sharedGeometriesRef.current.trainPassengerMaterial = new THREE.MeshStandardMaterial({ 
          color: 0x333333,
          roughness: 0.4,
          metalness: 0.0,
          envMapIntensity: 0.3,
          side: THREE.DoubleSide
        })
        
        // Initialize selection ring geometry and material
        sharedGeometriesRef.current.selectionRingGeometry = new THREE.RingGeometry(
          2.0, // Inner radius (slightly larger than station)
          2.4, // Outer radius
          32   // Segments for smooth circle
        )
        sharedGeometriesRef.current.selectionRingMaterial = new THREE.MeshBasicMaterial({
          color: 0x4A90E2, // Blue color
          transparent: true,
          opacity: 0.9, // 90% opaque
          side: THREE.DoubleSide
        })
        
        // Initialize unconnected station indicator
        sharedGeometriesRef.current.unconnectedRingGeometry = new THREE.RingGeometry(
          2.5, // Inner radius (larger than selection ring)
          3.0, // Outer radius  
          16   // Segments
        )
        sharedGeometriesRef.current.unconnectedRingMaterial = new THREE.MeshBasicMaterial({
          color: 0x6975dd, // Purple color
          transparent: true,
          opacity: 0.8,
          side: THREE.DoubleSide
        })
        
        // Initialize distress particle effects
        sharedGeometriesRef.current.distressParticleGeometry = new THREE.SphereGeometry(0.1, 6, 4)
        sharedGeometriesRef.current.distressParticleMaterial = new THREE.MeshBasicMaterial({
          color: 0xFF6666, // Light red for particles
          transparent: true,
          opacity: 0.7
        })
      },
      
      render: function(_gl: WebGLRenderingContext | WebGL2RenderingContext, matrix: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
        if (!this.renderer || !this.scene || !this.camera) return
        
        // Extract matrix values
        const m = new THREE.Matrix4().fromArray(
          Array.from(matrix.defaultProjectionData?.mainMatrix || Object.values(matrix) || new Array(16).fill(0)) as number[]
        )
        
        this.camera.projectionMatrix = m
        
        this.renderer.resetState()
        this.renderer.render(this.scene, this.camera)
        map.triggerRepaint()
      }
    }
    
    layerRef.current = customLayer
    map.addLayer(customLayer)
    console.log('Three.js layer added to map')
  }, [mapContext?.map])

  // Add click handling
  useEffect(() => {
    if (!mapContext?.map || !onStationClick) return

    const map = mapContext.map

    const handleMapClick = (e: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      if (!layerRef.current?.scene || !layerRef.current?.camera || !raycasterRef.current || !mouseRef.current) return

      // Get click coordinates relative to canvas
      const rect = map.getCanvas().getBoundingClientRect()
      const x = e.originalEvent.clientX - rect.left
      const y = e.originalEvent.clientY - rect.top

      // Normalize to [-1, 1] range
      mouseRef.current.x = (x / rect.width) * 2 - 1
      mouseRef.current.y = -(y / rect.height) * 2 + 1

      // Update camera matrix for raycasting
      const camera = layerRef.current.camera
      if (camera.projectionMatrix) {
        camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert()
      }
      
      // Perform raycasting
      raycasterRef.current.setFromCamera(mouseRef.current, camera)
      const intersects = raycasterRef.current.intersectObjects(layerRef.current.scene.children, true)

      // Sort intersections by distance to get the closest one first
      intersects.sort((a, b) => a.distance - b.distance)
      
      // Find the first station intersection
      for (const intersect of intersects) {
        const object = intersect.object
        
        // Check if this object or any of its parents is a station
        let current = object
        while (current) {
          if (current.userData?.type === 'station' && current.userData?.stationId) {
            onStationClick(current.userData.stationId)
            return // Exit early to prevent further processing
          }
          current = current.parent as THREE.Object3D
        }
      }
    }

    map.on('click', handleMapClick)

    return () => {
      map.off('click', handleMapClick)
    }
  }, [mapContext?.map, onStationClick])

  // Update game objects in the Three.js scene
  useEffect(() => {
    const renderGameObjects = () => {
      if (!layerRef.current?.scene || !layerRef.current?.renderer) {
        setTimeout(renderGameObjects, 100)
        return
      }
      
      const scene = layerRef.current.scene
    
    // Clear existing game objects with proper disposal
    const gameObjects = scene.children.filter((child: THREE.Object3D) => 
      child.userData && ['station', 'route', 'train', 'passenger', 'passengers', 'selection-ring', 'unconnected-ring', 'distress-particle', 'distress-glow'].includes(child.userData.type)
    )
    gameObjects.forEach((obj: THREE.Object3D) => {
      scene.remove(obj)
      // Dispose of geometries and materials for objects that don't use shared resources
      const sharedTypes = ['passenger', 'passengers', 'selection-ring', 'unconnected-ring', 'distress-particle', 'distress-glow']
      if (obj instanceof THREE.Mesh && !sharedTypes.includes(obj.userData.type)) {
        // Only dispose if not using shared geometry/material
        const sharedGeometries = [
          sharedGeometriesRef.current.passengerGeometry,
          sharedGeometriesRef.current.trainPassengerGeometry,
          sharedGeometriesRef.current.selectionRingGeometry,
          sharedGeometriesRef.current.unconnectedRingGeometry,
          sharedGeometriesRef.current.distressParticleGeometry
        ]
        
        if (!sharedGeometries.includes(obj.geometry as any)) { // eslint-disable-line @typescript-eslint/no-explicit-any
          obj.geometry.dispose()
        }
        
        const sharedMaterials = [
          sharedGeometriesRef.current.passengerMaterial,
          sharedGeometriesRef.current.trainPassengerMaterial,
          sharedGeometriesRef.current.selectionRingMaterial,
          sharedGeometriesRef.current.unconnectedRingMaterial,
          sharedGeometriesRef.current.distressParticleMaterial
        ]
        
        if (Array.isArray(obj.material)) {
          obj.material.forEach(mat => {
            if (!sharedMaterials.includes(mat as any)) { // eslint-disable-line @typescript-eslint/no-explicit-any
              mat.dispose()
            }
          })
        } else if (!sharedMaterials.includes(obj.material as any)) { // eslint-disable-line @typescript-eslint/no-explicit-any
          obj.material.dispose()
        }
      }
    })
    
    // Add stations using the factory (geometry/material logic centralized)
    gameData.stations.forEach(station => {
      const stationObj = createStationObject(station)
      if (!stationObj || !stationObj.object3D) return
      
      // Find routes connected to this station
      const connectedRoutes = gameData.routes.filter(route => route.stations.includes(station.id))
      const isUnconnected = connectedRoutes.length === 0
      const isDistressed = station.passengerCount >= 15
      
      // Add colored outlines for connected routes
      if (connectedRoutes.length > 0) {
        connectedRoutes.forEach((route, index) => {
          // Create ring outline with route color using plastic material
          const ringGeometry = new THREE.RingGeometry(
            1.1 + (index * 0.15), // Inner radius - more spacing between rings
            1.25 + (index * 0.15), // Outer radius - much thicker ring
            64 // High segment count for smooth circular appearance
          )
          const ringMaterial = new THREE.MeshPhysicalMaterial({ 
            color: route.color, // Keep original vibrant route color
            emissive: new THREE.Color(route.color).multiplyScalar(0.4), // Moderate emissive glow
            transparent: true,
            opacity: 0.9,
            roughness: 0.15, // Very smooth plastic
            metalness: 0.0, // Non-metallic
            envMapIntensity: 0.8, // Strong reflections
            clearcoat: 0.5, // High clearcoat for glossy look
            clearcoatRoughness: 0.02, // Very smooth clearcoat
            side: THREE.DoubleSide // Render both sides
          })
          const ring = new THREE.Mesh(ringGeometry, ringMaterial)
          // No rotation needed - ring inherits station's rotation since it's added to station group
          ring.position.z = 0.03 // Slightly above the station base
          ring.castShadow = true
          
          stationObj.object3D.add(ring)
        })
      }
      
      const mercator = MercatorCoordinate.fromLngLat([stationObj.position.lng, stationObj.position.lat], 0)
      // Place at correct altitude (center of disk above map)
      const stationHeight = mercator.meterInMercatorCoordinateUnits() * (stationObj.altitude || 0)
      stationObj.object3D.position.set(mercator.x, mercator.y, mercator.z + stationHeight)
      // Scale to meters (factory uses 2m radius, so scale=2)
      const scale = mercator.meterInMercatorCoordinateUnits() * (stationObj.scale || 1)
      stationObj.object3D.scale.setScalar(scale)
      stationObj.object3D.userData = { type: 'station', stationId: station.id }
      
      // Add selection ring if this station is selected
      if (selectedStationId === station.id && 
          sharedGeometriesRef.current.selectionRingGeometry && 
          sharedGeometriesRef.current.selectionRingMaterial) {
        const selectionRing = new THREE.Mesh(
          sharedGeometriesRef.current.selectionRingGeometry,
          sharedGeometriesRef.current.selectionRingMaterial
        )
        selectionRing.position.z = 0.05 // Slightly above the station
        selectionRing.userData = { type: 'selection-ring' }
        stationObj.object3D.add(selectionRing)
      }
      
      // Add unconnected station indicator
      if (isUnconnected && 
          sharedGeometriesRef.current.unconnectedRingGeometry && 
          sharedGeometriesRef.current.unconnectedRingMaterial) {
        const unconnectedRing = new THREE.Mesh(
          sharedGeometriesRef.current.unconnectedRingGeometry,
          sharedGeometriesRef.current.unconnectedRingMaterial
        )
        unconnectedRing.position.z = 0.02 // Below selection ring but above station
        unconnectedRing.userData = { type: 'unconnected-ring' }
        
        // Add pulsing animation for better visibility
        const time = Date.now() * 0.003
        const pulse = 0.8 + Math.sin(time) * 0.2 // Pulse between 0.6 and 1.0
        unconnectedRing.scale.setScalar(pulse)
        
        stationObj.object3D.add(unconnectedRing)
      }
      
      // Add distress effects for stations with 15+ passengers
      if (isDistressed && 
          sharedGeometriesRef.current.distressParticleGeometry && 
          sharedGeometriesRef.current.distressParticleMaterial) {
        
        const time = Date.now() * 0.002
        const distressSeverity = Math.min((station.passengerCount - 15) / 10, 1) // 0 to 1 based on passenger count
        const particleCount = Math.ceil(5 + distressSeverity * 10) // 5-15 particles based on severity
        
        // Create floating distress particles
        for (let i = 0; i < particleCount; i++) {
          const particle = new THREE.Mesh(
            sharedGeometriesRef.current.distressParticleGeometry,
            sharedGeometriesRef.current.distressParticleMaterial
          )
          
          // Animate particles floating around the station
          const angle = (i / particleCount) * Math.PI * 2 + time + i
          const radius = 3 + Math.sin(time * 2 + i) * 1 // Varying radius
          const height = 0.5 + Math.sin(time * 3 + i * 2) * 1.5 // Floating up and down
          
          particle.position.set(
            Math.cos(angle) * radius,
            Math.sin(angle) * radius,
            height
          )
          
          // Scale particles based on severity
          const particleScale = 0.5 + distressSeverity * 1.5
          particle.scale.setScalar(particleScale)
          
          particle.userData = { type: 'distress-particle' }
          stationObj.object3D.add(particle)
        }
        
        // Add pulsing red glow effect to the station itself
        const originalMaterial = stationObj.object3D.children[0] as THREE.Mesh
        if (originalMaterial && originalMaterial.material) {
          const glowIntensity = 0.3 + distressSeverity * 0.7 // More intense glow for higher distress
          const pulseFactor = 0.8 + Math.sin(time * 4) * 0.2 // Fast pulsing
          
          // Create a red emissive overlay
          const distressGlow = originalMaterial.clone()
          if (distressGlow.material instanceof THREE.Material) {
            const glowMaterial = distressGlow.material.clone()
            if ('emissive' in glowMaterial && 'emissiveIntensity' in glowMaterial) {
              (glowMaterial as any).emissive = new THREE.Color(0xFF4444) // eslint-disable-line @typescript-eslint/no-explicit-any
              ;(glowMaterial as any).emissiveIntensity = glowIntensity * pulseFactor // eslint-disable-line @typescript-eslint/no-explicit-any
            }
            distressGlow.material = glowMaterial
            distressGlow.scale.setScalar(1.1) // Slightly larger for glow effect
            distressGlow.userData = { type: 'distress-glow' }
            stationObj.object3D.add(distressGlow)
          }
        }
      }
      
      scene.add(stationObj.object3D)
    })
    
    // Add routes as lines
    gameData.routes.forEach(route => {
      if (route.stations.length < 2) return
      
      const routeStations = route.stations.map(stationId => 
        gameData.stations.find(s => s.id === stationId)
      ).filter(Boolean)
      
      if (routeStations.length < 2) return
      
      // Create metro-style line geometry with corner points
      const points: THREE.Vector3[] = []
      
      for (let i = 0; i < routeStations.length - 1; i++) {
        const currentStation = routeStations[i]!
        const nextStation = routeStations[i + 1]!
        
        // Create metro route between consecutive stations
        const routeCoords = createMetroRouteCoordinates(currentStation.position, nextStation.position)
        
        // Convert to Three.js points (skip first point if not the first segment to avoid duplicates)
        const startIndex = i === 0 ? 0 : 1
        for (let j = startIndex; j < routeCoords.length; j++) {
          const coord = routeCoords[j]
          const mercator = MercatorCoordinate.fromLngLat([coord[0], coord[1]], 0)
          // Place route lines slightly below stations (negative z offset)
          const routeZ = mercator.z - mercator.meterInMercatorCoordinateUnits() * 5 // 5 meters below
          points.push(new THREE.Vector3(mercator.x, mercator.y, routeZ))
        }
      }
      
      // Use simple thick LineBasicMaterial with vibrant color
      const geometry = new THREE.BufferGeometry().setFromPoints(points)
      const material = new THREE.LineBasicMaterial({ 
        color: route.color, // Keep original vibrant route color
        linewidth: 8, // Thick lines (note: linewidth may not work in WebGL)
        opacity: 1.0,
        transparent: false
      })
      const line = new THREE.Line(geometry, material)
      
      line.userData = { type: 'route', routeId: route.id }
      scene.add(line)
    })
    
    // Add trains
    gameData.trains.forEach(train => {
      const route = gameData.routes.find(r => r.id === train.routeId)
      if (!route || route.stations.length < 2) return
      
      const routeStations = route.stations.map(stationId => 
        gameData.stations.find(s => s.id === stationId)
      ).filter((station): station is { id: string; position: LngLat; color: string; passengerCount: number } => 
        station !== undefined
      )
      
      if (routeStations.length < 2) return
      
      // Calculate train position along metro route
      const trainLngLat = getTrainPositionOnMetroRoute(routeStations, train.position)
      const trainMercator = MercatorCoordinate.fromLngLat([trainLngLat.lng, trainLngLat.lat], 0)
      
      const x = trainMercator.x
      const y = trainMercator.y
      const z = trainMercator.z
      
      const geometry = new THREE.BoxGeometry(2, 2, 1)
      const material = new THREE.MeshPhysicalMaterial({ 
        color: route.color, // Keep original vibrant route color
        emissive: new THREE.Color(route.color).multiplyScalar(0.3), // Moderate emissive glow
        roughness: 0.2, // Smooth plastic
        metalness: 0.0, // Non-metallic
        envMapIntensity: 0.7, // Good reflections
        clearcoat: 0.4, // Glossy clearcoat
        clearcoatRoughness: 0.03, // Very smooth clearcoat
        side: THREE.DoubleSide // Render both sides
      })
      const cube = new THREE.Mesh(geometry, material)
      cube.castShadow = true
      cube.receiveShadow = true
      
      // Add passenger indicators as dark grey dots above the train (simplified for performance)
      if (train.passengerCount > 0) {
        // Cap visual passenger display to prevent performance issues
        const maxVisualPassengers = Math.min(train.passengerCount, PERFORMANCE_CONFIG.maxTrainPassengers)
        
        for (let passengerIndex = 0; passengerIndex < maxVisualPassengers; passengerIndex++) {
          // Reuse shared geometry and material
          const dot = new THREE.Mesh(
            sharedGeometriesRef.current.trainPassengerGeometry!,
            sharedGeometriesRef.current.trainPassengerMaterial!
          )
          
          // Position dots in a flat grid pattern above the train
          const dotsPerRow = 3
          const row = Math.floor(passengerIndex / dotsPerRow)
          const col = passengerIndex % dotsPerRow
          
          // Arrange dots in a flat grid above the train (X-Y plane)
          dot.position.set(
            (col - 1) * 0.5,     // X: -0.5, 0, 0.5 for columns 0, 1, 2
            (row - 0.5) * 0.5,   // Y: -0.25, 0.25 for rows 0, 1 (centered)
            1.2                  // Z: Fixed height above the train
          )
          
          cube.add(dot)
        }
        
        // Add a text indicator for high passenger counts
        if (train.passengerCount > PERFORMANCE_CONFIG.maxTrainPassengers) {
          // You could add a sprite or simple text mesh here for counts > maxTrainPassengers
          // For now, we'll just cap at maxTrainPassengers visual passengers
        }
      }
      
      cube.position.set(x, y, z)
      
      const scale = trainMercator.meterInMercatorCoordinateUnits() * 30
      cube.scale.setScalar(scale)
      
      cube.userData = { type: 'train', trainId: train.id }
      scene.add(cube)
    })
    
    // Add passengers around stations using instanced rendering for performance
    const totalPassengers = gameData.stations.reduce((sum, station) => sum + (station.passengerCount || 0), 0)
    
    if (totalPassengers > 0) {
      // Cap total rendered passengers for performance
      const maxRenderPassengers = Math.min(totalPassengers, PERFORMANCE_CONFIG.maxRenderedPassengers)
      
      // Remove old instanced mesh if it exists
      if (instancedMeshesRef.current.stationPassengers) {
        scene.remove(instancedMeshesRef.current.stationPassengers)
      }
      
      // Create instanced mesh for all station passengers
      const instancedMesh = new THREE.InstancedMesh(
        sharedGeometriesRef.current.passengerGeometry!,
        sharedGeometriesRef.current.passengerMaterial!,
        maxRenderPassengers
      )
      
      const matrix = new THREE.Matrix4()
      let instanceIndex = 0
      
      // Place passengers for each station
      gameData.stations.forEach(station => {
        if (station.passengerCount && station.passengerCount > 0 && instanceIndex < maxRenderPassengers) {
          const mercator = MercatorCoordinate.fromLngLat([station.position.lng, station.position.lat], 0)
          const meterUnit = mercator.meterInMercatorCoordinateUnits()
          const scale = meterUnit * 50
          const ringRadius = 80 * meterUnit
          
          // Calculate how many passengers to render for this station
          const passengersToRender = Math.min(
            station.passengerCount,
            maxRenderPassengers - instanceIndex,
            PERFORMANCE_CONFIG.maxPassengersPerStation // Max passengers per station for visual clarity
          )
          
          for (let idx = 0; idx < passengersToRender; idx++) {
            const angle = (idx / Math.max(passengersToRender, 8)) * Math.PI * 2 // Spread around circle
            const offsetX = Math.cos(angle) * ringRadius
            const offsetY = Math.sin(angle) * ringRadius
            
            matrix.makeScale(scale, scale, scale)
            matrix.setPosition(
              mercator.x + offsetX,
              mercator.y + offsetY,
              mercator.z + meterUnit * 5
            )
            
            instancedMesh.setMatrixAt(instanceIndex, matrix)
            instanceIndex++
          }
        }
      })
      
      // Update the instance matrix
      instancedMesh.instanceMatrix.needsUpdate = true
      instancedMesh.userData = { type: 'passengers' }
      scene.add(instancedMesh)
      instancedMeshesRef.current.stationPassengers = instancedMesh
    }
    }
    
    renderGameObjects()
  }, [gameData, selectedStationId])
  
  return null
}

export default GameThreeLayer