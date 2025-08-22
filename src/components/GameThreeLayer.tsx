import { useEffect, useRef } from 'react'
import { useMap } from '@mapcomponents/react-maplibre'
import * as THREE from 'three'
import { MercatorCoordinate } from 'maplibre-gl'
import type { LngLat, Route, Train, Passenger } from '../types'
import { createStationObject } from '../utils/threeObjectFactories'
import { PERFORMANCE_CONFIG } from '../config/gameConfig'

// Comprehensive metro-style route coordinate generation with perfect straight line guarantees
function createMetroRouteCoordinates(start: LngLat, target: LngLat): number[][] {
  // Convert to Web Mercator coordinates for true visual calculations
  const startMerc = MercatorCoordinate.fromLngLat([start.lng, start.lat], 0);
  const targetMerc = MercatorCoordinate.fromLngLat([target.lng, target.lat], 0);
  
  const dx_m = targetMerc.x - startMerc.x;
  const dy_m = targetMerc.y - startMerc.y;
  
  // Start with the starting point
  const coordinates: number[][] = [[start.lng, start.lat]];
  
  // Calculate alignment thresholds in Mercator space
  const meterUnit = startMerc.meterInMercatorCoordinateUnits();
  const alignmentThreshold = 10 * meterUnit; // ~10m threshold
  const minStraightSegment = 30 * meterUnit;  // Minimum 30m for straight segments
  
  // If already aligned horizontally or vertically, go straight
  if (Math.abs(dx_m) < alignmentThreshold) {
    coordinates.push([start.lng, target.lat]);
    return coordinates;
  }
  if (Math.abs(dy_m) < alignmentThreshold) {
    coordinates.push([target.lng, start.lat]);
    return coordinates;
  }
  
  // For dogleg routes, ensure both segments meet minimum length requirements
  const absDx_m = Math.abs(dx_m);
  const absDy_m = Math.abs(dy_m);
  
  // Determine route orientation and calculate optimal corner position
  let cornerMerc: MercatorCoordinate;
  let finalConnectionPoint: LngLat;
  
  if (absDx_m < absDy_m) {
    // Route ends with vertical segment
    const availableVertical = absDy_m;
    const diagonalComponent = Math.min(absDx_m, availableVertical - minStraightSegment);
    
    if (diagonalComponent <= 0) {
      // Not enough space for diagonal - go straight vertical
      coordinates.push([start.lng, target.lat]);
      return coordinates;
    }
    
    // Calculate corner position ensuring minimum straight segment
    const cornerY = startMerc.y + Math.sign(dy_m) * diagonalComponent;
    cornerMerc = new MercatorCoordinate(targetMerc.x, cornerY, 0);
    
    // Final connection point ensures perfect vertical alignment
    finalConnectionPoint = target; // Connect to station center for vertical approach
    
  } else {
    // Route ends with horizontal segment
    const availableHorizontal = absDx_m;
    const diagonalComponent = Math.min(absDy_m, availableHorizontal - minStraightSegment);
    
    if (diagonalComponent <= 0) {
      // Not enough space for diagonal - go straight horizontal
      coordinates.push([target.lng, start.lat]);
      return coordinates;
    }
    
    // Calculate corner position ensuring minimum straight segment
    const cornerX = startMerc.x + Math.sign(dx_m) * diagonalComponent;
    cornerMerc = new MercatorCoordinate(cornerX, targetMerc.y, 0);
    
    // Final connection point ensures perfect horizontal alignment
    finalConnectionPoint = target; // Connect to station center for horizontal approach
  }
  
  // Convert corner to lng-lat and ensure perfect metro alignment
  const cornerLngLat = cornerMerc.toLngLat();
  let cornerLng = cornerLngLat.lng;
  let cornerLat = cornerLngLat.lat;
  
  // Force perfect alignment by snapping corner to target's axis
  if (absDx_m < absDy_m) {
    // Vertical final segment - corner must share target's longitude exactly
    cornerLng = finalConnectionPoint.lng;
  } else {
    // Horizontal final segment - corner must share target's latitude exactly  
    cornerLat = finalConnectionPoint.lat;
  }
  
  // Add corner point if it's significantly different from start
  const cornerThreshold = 0.000001;
  const lastCoord = coordinates[coordinates.length - 1];
  if (Math.abs(cornerLng - lastCoord[0]) > cornerThreshold || 
      Math.abs(cornerLat - lastCoord[1]) > cornerThreshold) {
    coordinates.push([cornerLng, cornerLat]);
  }
  
  // Add final connection point if different from corner
  const currentLastCoord = coordinates[coordinates.length - 1];
  if (Math.abs(finalConnectionPoint.lng - currentLastCoord[0]) > cornerThreshold || 
      Math.abs(finalConnectionPoint.lat - currentLastCoord[1]) > cornerThreshold) {
    coordinates.push([finalConnectionPoint.lng, finalConnectionPoint.lat]);
  }
  
  // Validate that all generated segments are truly straight (horizontal, vertical, or 45°)
  const validatedCoordinates = validateStraightLines(coordinates);
  return validatedCoordinates;
}

// Validation function to ensure all segments are perfectly straight in Web Mercator space
function validateStraightLines(coordinates: number[][]): number[][] {
  if (coordinates.length < 2) return coordinates;
  
  for (let i = 0; i < coordinates.length - 1; i++) {
    const start = { lng: coordinates[i][0], lat: coordinates[i][1] };
    const end = { lng: coordinates[i + 1][0], lat: coordinates[i + 1][1] };
    
    // Convert to Mercator for accurate angle validation
    const startMerc = MercatorCoordinate.fromLngLat([start.lng, start.lat], 0);
    const endMerc = MercatorCoordinate.fromLngLat([end.lng, end.lat], 0);
    
    const dx_m = endMerc.x - startMerc.x;
    const dy_m = endMerc.y - startMerc.y;
    const length_m = Math.hypot(dx_m, dy_m);
    
    if (length_m < 0.000001) continue; // Skip zero-length segments
    
    const nx = dx_m / length_m;
    const ny = dy_m / length_m;
    
    // Check if segment is truly horizontal, vertical, or 45° diagonal
    const isHorizontal = Math.abs(ny) < 0.01; // Very strict tolerance
    const isVertical = Math.abs(nx) < 0.01;
    const isDiagonal = Math.abs(Math.abs(nx) - Math.abs(ny)) < 0.01;
    
    if (!isHorizontal && !isVertical && !isDiagonal) {
      console.warn(`Non-straight segment detected: ${start.lng},${start.lat} to ${end.lng},${end.lat} (angle: ${Math.atan2(ny, nx) * 180 / Math.PI}°)`);
      
      // Force correction by snapping to nearest valid direction
      if (Math.abs(nx) > Math.abs(ny)) {
        // More horizontal - force horizontal
        coordinates[i + 1][1] = coordinates[i][1];
      } else {
        // More vertical - force vertical
        coordinates[i + 1][0] = coordinates[i][0];
      }
    }
  }
  
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
          color: 0xffae00, // Blue color
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

  // Handle resize events to prevent Three.js distortion
  useEffect(() => {
    if (!mapContext?.map) return

    const map = mapContext.map
    const canvas = map.getCanvas()

    const handleResize = () => {
      if (layerRef.current?.renderer) {
        const renderer = layerRef.current.renderer
        // Get the current canvas size
        const width = canvas.clientWidth
        const height = canvas.clientHeight
        
        // Update the Three.js renderer size
        renderer.setSize(width, height, false) // false prevents setting CSS size
        
        // Force a repaint
        map.triggerRepaint()
      }
    }

    // Listen to map resize events
    map.on('resize', handleResize)

    // Also listen to window resize for additional safety
    window.addEventListener('resize', handleResize)

    return () => {
      map.off('resize', handleResize)
      window.removeEventListener('resize', handleResize)
    }
  }, [mapContext?.map])

  // Add click and touch handling for station selection
  useEffect(() => {
    if (!mapContext?.map || !onStationClick) return

    const map = mapContext.map

    const handleMapInteraction = (e: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      // MapLibre's click event already handles both mouse and touch
      // and provides normalized coordinates in e.point
      const pointLngLat = e.lngLat
      
      // Find closest station within reasonable distance (same as StationDragHandler)
      const closestStation = findClosestStation(pointLngLat, gameData.stations, 150) // 150m radius
      
      if (closestStation) {
        console.log('✅ Station selected:', closestStation.id)
        onStationClick(closestStation.id)
      } else {
        console.log('❌ No station found within 150m')
      }
    }

    // Handle both mouse clicks and touch taps separately
    map.on('click', handleMapInteraction)
    map.on('touchend', handleMapInteraction)

    return () => {
      map.off('click', handleMapInteraction)
      map.off('touchend', handleMapInteraction)
    }
  }, [mapContext?.map, onStationClick, gameData.stations])

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
      
      // Ensure all children also have the station userData for raycasting
      stationObj.object3D.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.userData = { type: 'station', stationId: station.id }
        }
      })
      
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
      
      // 🔥 STUNNING MATERIAL-BASED DISTRESS EFFECTS 🔥
      if (isDistressed) {
        const time = Date.now() * 0.001;
        
        // ✨ TRANSFORM THE STATION WITH PASSENGER-COUNT-BASED RED INTENSITY ✨
        const stationMesh = stationObj.object3D.children[1] as THREE.Mesh;
        if (stationMesh && stationMesh.material) {
          // Calculate intensity based on passenger count (0-20 scale)
          const passengerCount = station.passengerCount || 0;
          const distressIntensity = Math.min(passengerCount / 20, 1.0); // Normalize to 0-1
          
          // Pulsing animation gets faster and more intense as passenger count increases
          const pulseSpeed = 3 + distressIntensity * 7; // From 3 to 10 Hz
          const pulseIntensity = 0.3 + distressIntensity * 0.5; // From 0.3 to 0.8
          const heatPulse = pulseIntensity * Math.sin(time * pulseSpeed);
          
          // Color shifts from orange (0.08 HSL) to pure red (0.0 HSL) based on passenger count
          const redHue = 0.08 * (1 - distressIntensity); // Goes from 0.08 (orange) to 0.0 (red)
          const saturation = 0.8 + 0.2 * distressIntensity; // Gets more saturated
          const lightness = 0.4 + 0.2 * (1 + heatPulse); // Pulses brightness
          
          const distressMaterial = new THREE.MeshBasicMaterial({
            color: new THREE.Color().setHSL(redHue, saturation, lightness),
            transparent: true,
            opacity: 0.85 + 0.15 * distressIntensity, // Gets more opaque with more passengers
            side: THREE.DoubleSide
          });
          
          stationMesh.material = distressMaterial;
        }

        // 🌊 ELEGANT ENERGY RINGS - SUBTLE BUT STUNNING 🌊
        const primaryRingGeometry = new THREE.RingGeometry(2.2, 2.6, 64);
        const ringIntensity = 0.7 + 0.3 * Math.sin(time * 6);
        const primaryRingMaterial = new THREE.MeshBasicMaterial({
          color: new THREE.Color().setHSL(0.05, 0.9, 0.6), // Orange color
          transparent: true,
          opacity: 0.7 + 0.2 * ringIntensity,
          side: THREE.DoubleSide,
          blending: THREE.NormalBlending // Changed from additive to normal
        });
        const primaryRing = new THREE.Mesh(primaryRingGeometry, primaryRingMaterial);
        // No rotation needed - ring is already flat like the station
        primaryRing.position.z = 0.4;
        primaryRing.scale.setScalar(1 + 0.2 * Math.sin(time * 4));
        primaryRing.userData = { type: 'distress-glow' };
        stationObj.object3D.add(primaryRing);

        // 💎 CRYSTAL-LIKE OUTER RING WITH REFRACTION 💎
        const outerRingGeometry = new THREE.RingGeometry(3.0, 3.2, 64);
        const outerRingMaterial = new THREE.MeshBasicMaterial({
          color: new THREE.Color().setHSL(0.95, 0.8, 0.6), // Red-pink color
          transparent: true,
          opacity: 0.5 + 0.2 * Math.sin(time * 5 + Math.PI),
          side: THREE.DoubleSide,
          blending: THREE.NormalBlending
        });
        const outerRing = new THREE.Mesh(outerRingGeometry, outerRingMaterial);
        // No rotation needed - ring is already flat like the station
        outerRing.position.z = 0.3;
        outerRing.scale.setScalar(1 + 0.15 * Math.sin(time * 3 + Math.PI/2));
        outerRing.userData = { type: 'distress-glow' };
        stationObj.object3D.add(outerRing);

        // ⭐ SUBTLE AURORA-LIKE GLOW SPHERE ⭐
        const auraGeometry = new THREE.SphereGeometry(1.8, 32, 16);
        const auraMaterial = new THREE.MeshBasicMaterial({
          color: new THREE.Color().setHSL(0.08, 0.8, 0.4), // Orange glow
          transparent: true,
          opacity: 0.2 + 0.1 * Math.sin(time * 8),
          side: THREE.BackSide, // Render from inside
          blending: THREE.NormalBlending
        });
        const auraSphere = new THREE.Mesh(auraGeometry, auraMaterial);
        auraSphere.position.z = 0.5;
        auraSphere.scale.setScalar(1 + 0.3 * Math.sin(time * 3));
        auraSphere.userData = { type: 'distress-glow' };
        stationObj.object3D.add(auraSphere);

        // 🎆 IRIDESCENT SHIMMER LAYER 🎆
        const shimmerGeometry = new THREE.CylinderGeometry(1.1, 1.1, 0.1, 32);
        const shimmerMaterial = new THREE.MeshBasicMaterial({
          color: new THREE.Color().setHSL(0.12, 0.9, 0.5 + 0.2 * Math.sin(time * 12)), // Yellow-orange with animation
          transparent: true,
          opacity: 0.4 + 0.2 * Math.sin(time * 8),
          side: THREE.DoubleSide,
          blending: THREE.NormalBlending
        });
        const shimmerLayer = new THREE.Mesh(shimmerGeometry, shimmerMaterial);
        // No rotation needed - cylinder is already oriented correctly for flat appearance
        shimmerLayer.position.z = 0.6;
        shimmerLayer.scale.setScalar(1 + 0.1 * Math.sin(time * 10));
        shimmerLayer.userData = { type: 'distress-glow' };
        stationObj.object3D.add(shimmerLayer);
      }
      
      scene.add(stationObj.object3D)
    })
    
    // Advanced Geometric Corridor System - No longer using simple segment keys

    // Helper functions for geometric calculations
    const interpolatePosition = (start: LngLat, end: LngLat, t: number): LngLat => ({
      lng: start.lng + (end.lng - start.lng) * t,
      lat: start.lat + (end.lat - start.lat) * t
    })

    const getDistanceInMeters = (pos1: LngLat, pos2: LngLat): number => {
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

    // Advanced Geometric Corridor Detection System for Sophisticated Parallel Route Visualization
    
    interface MicroSegment {
      id: string;
      routeId: string;
      startPos: LngLat;
      endPos: LngLat;
      centerPos: LngLat;
      direction: { x: number; y: number }; // normalized direction vector
      length: number;
      routeT: number; // parameter along route (0-1)
      segmentIndex: number; // which route segment this micro-segment belongs to
    }

    interface Corridor {
      id: string;
      microSegments: MicroSegment[];
      routes: Set<string>;
      centerLine: LngLat[];
      averageDirection: { x: number; y: number };
    }

    interface SpatialCell {
      microSegments: MicroSegment[];
    }

    const buildAdvancedRouteCorridors = (
      routes: Route[],
      stations: Array<{ id: string; position: LngLat; color: string; passengerCount: number }>
    ) => {
      // Quick dictionary for stations
      const ST = new Map<string, { id: string; position: LngLat; color: string; passengerCount: number }>(
        stations.map(s => [s.id, s])
      )

      // 🚀 SOPHISTICATED MULTI-ROUTE CORRIDOR SYSTEM FOR 8+ ROUTES 🚀
      // PHASE 1: Ultra-Dense Route Sampling for Precision Detection
      const allMicroSegments: MicroSegment[] = []
      const routeMicroSegments = new Map<string, MicroSegment[]>()
      const SAMPLING_DISTANCE_METERS = 10 // Much smaller for high precision

      let microSegmentCounter = 0

      for (const route of routes) {
        if (route.stations.length < 2) continue
        
        const routeStations = route.stations.map(id => ST.get(id)).filter(Boolean)
        if (routeStations.length < 2) continue

        const routeMicros: MicroSegment[] = []
        let totalRouteLength = 0
        
        // Calculate total route length using schematic paths
        for (let i = 0; i < routeStations.length - 1; i++) {
          const start = routeStations[i]!
          const end = routeStations[i + 1]!
          const schematicCoords = createMetroRouteCoordinates(start.position, end.position)
          
          // Sum lengths of all schematic sub-segments
          for (let j = 0; j < schematicCoords.length - 1; j++) {
            const subStart = { lng: schematicCoords[j][0], lat: schematicCoords[j][1] }
            const subEnd = { lng: schematicCoords[j + 1][0], lat: schematicCoords[j + 1][1] }
            const subSegLength = getDistanceInMeters(subStart, subEnd)
            totalRouteLength += subSegLength
          }
        }

        let currentRouteDistance = 0

        // Sample each segment of the route using schematic paths
        for (let segIdx = 0; segIdx < routeStations.length - 1; segIdx++) {
          const start = routeStations[segIdx]!
          const end = routeStations[segIdx + 1]!
          
          // Get schematic coordinates for this segment
          const schematicCoords = createMetroRouteCoordinates(start.position, end.position)
          
          // Sample along each sub-segment of the schematic path
          for (let subSegIdx = 0; subSegIdx < schematicCoords.length - 1; subSegIdx++) {
            const subStart = { lng: schematicCoords[subSegIdx][0], lat: schematicCoords[subSegIdx][1] }
            const subEnd = { lng: schematicCoords[subSegIdx + 1][0], lat: schematicCoords[subSegIdx + 1][1] }
            const subSegLength = getDistanceInMeters(subStart, subEnd)
            
            if (subSegLength < 1) continue // Skip very short sub-segments
            
            const numSamples = Math.max(2, Math.ceil(subSegLength / SAMPLING_DISTANCE_METERS))
            
            for (let sampleIdx = 0; sampleIdx < numSamples - 1; sampleIdx++) {
              const t1 = sampleIdx / (numSamples - 1)
              const t2 = (sampleIdx + 1) / (numSamples - 1)
              
              const startPos = interpolatePosition(subStart, subEnd, t1)
              const endPos = interpolatePosition(subStart, subEnd, t2)
              const centerPos = interpolatePosition(startPos, endPos, 0.5)
              
              // Convert to Mercator for true visual direction calculation
              const startMerc = MercatorCoordinate.fromLngLat([startPos.lng, startPos.lat], 0)
              const endMerc = MercatorCoordinate.fromLngLat([endPos.lng, endPos.lat], 0)
              const dx_m = endMerc.x - startMerc.x
              const dy_m = endMerc.y - startMerc.y
              const len_m = Math.hypot(dx_m, dy_m)
              
              const microSeg: MicroSegment = {
                id: `micro-${microSegmentCounter++}`,
                routeId: route.id,
                startPos,
                endPos,
                centerPos,
                direction: len_m > 0 ? { x: dx_m / len_m, y: dy_m / len_m } : { x: 1, y: 0 },
                length: subSegLength,
                routeT: (currentRouteDistance + (sampleIdx / (numSamples - 1)) * subSegLength) / totalRouteLength,
                segmentIndex: segIdx
              }
              
              routeMicros.push(microSeg)
              allMicroSegments.push(microSeg)
            }
            
            currentRouteDistance += subSegLength
          }
        }
        
        routeMicroSegments.set(route.id, routeMicros)
      }

      // PHASE 2: Multi-Scale Spatial Indexing for Complex Route Networks
      const FINE_GRID_SIZE = 0.0005 // ~50m fine-grained cells
      const COARSE_GRID_SIZE = 0.002 // ~200m coarse cells for large-scale patterns
      const spatialGrid = new Map<string, SpatialCell>()
      const coarseSpatialGrid = new Map<string, SpatialCell>()

      const getGridKey = (pos: LngLat, gridSize: number) => {
        const x = Math.floor(pos.lng / gridSize)
        const y = Math.floor(pos.lat / gridSize) 
        return `${x},${y}`
      }

      const getNeighborGridKeys = (pos: LngLat, gridSize: number, radius: number = 1) => {
        const cx = Math.floor(pos.lng / gridSize)
        const cy = Math.floor(pos.lat / gridSize)
        const keys: string[] = []
        for (let dx = -radius; dx <= radius; dx++) {
          for (let dy = -radius; dy <= radius; dy++) {
            keys.push(`${cx + dx},${cy + dy}`)
          }
        }
        return keys
      }

      // Index in both fine and coarse grids
      for (const micro of allMicroSegments) {
        // Fine grid for precise detection
        const fineKey = getGridKey(micro.centerPos, FINE_GRID_SIZE)
        if (!spatialGrid.has(fineKey)) {
          spatialGrid.set(fineKey, { microSegments: [] })
        }
        spatialGrid.get(fineKey)!.microSegments.push(micro)
        
        // Coarse grid for pattern detection
        const coarseKey = getGridKey(micro.centerPos, COARSE_GRID_SIZE)
        if (!coarseSpatialGrid.has(coarseKey)) {
          coarseSpatialGrid.set(coarseKey, { microSegments: [] })
        }
        coarseSpatialGrid.get(coarseKey)!.microSegments.push(micro)
      }

      // PHASE 3: Advanced Multi-Layer Parallelism Detection for 8+ Routes
      const CLOSE_PROXIMITY_METERS = 75 // First layer: very close routes  
      const MEDIUM_PROXIMITY_METERS = 150 // Second layer: medium distance
      const FAR_PROXIMITY_METERS = 300 // Third layer: larger patterns
      const STRICT_PARALLEL_THRESHOLD = Math.PI / 12 // ~15 degrees for strict parallelism
      const LOOSE_PARALLEL_THRESHOLD = Math.PI / 6 // ~30 degrees for loose parallelism
      
      const parallelPairs: Array<{ a: MicroSegment; b: MicroSegment; distance: number; similarity: number; strength: number }> = []

      // Multi-layer detection with different thresholds
      const detectParallelism = (proximityThreshold: number, angleThreshold: number, strength: number) => {
        const gridSize = proximityThreshold < 100 ? FINE_GRID_SIZE : COARSE_GRID_SIZE
        const searchGrid = proximityThreshold < 100 ? spatialGrid : coarseSpatialGrid
        const searchRadius = proximityThreshold < 100 ? 1 : 2
        
        for (const microA of allMicroSegments) {
          const nearbyKeys = getNeighborGridKeys(microA.centerPos, gridSize, searchRadius)
          
          for (const key of nearbyKeys) {
            const cell = searchGrid.get(key)
            if (!cell) continue
            
            for (const microB of cell.microSegments) {
              // Skip same route and same micro-segment
              if (microA.routeId === microB.routeId || microA.id === microB.id) continue
              
              // Check if we already processed this pair
              if (microA.id > microB.id) continue
              
              const distance = getDistanceInMeters(microA.centerPos, microB.centerPos)
              if (distance > proximityThreshold) continue
              
              // Enhanced parallelism check with direction consistency
              const dotProduct = microA.direction.x * microB.direction.x + microA.direction.y * microB.direction.y
              const angleDiff = Math.acos(Math.min(1, Math.max(-1, Math.abs(dotProduct))))
              
              // Require same general direction (not anti-parallel) and within angle threshold
              if (angleDiff < angleThreshold && dotProduct > 0.3) {
                const similarity = Math.abs(dotProduct)
                // Boost similarity for truly co-directional segments
                const adjustedSimilarity = dotProduct > 0.8 ? similarity * 1.2 : similarity
                parallelPairs.push({ a: microA, b: microB, distance, similarity: adjustedSimilarity, strength })
              }
            }
          }
        }
      }
      
      // Three-layer detection for different scales
      detectParallelism(CLOSE_PROXIMITY_METERS, STRICT_PARALLEL_THRESHOLD, 3) // High confidence
      detectParallelism(MEDIUM_PROXIMITY_METERS, STRICT_PARALLEL_THRESHOLD, 2) // Medium confidence  
      detectParallelism(FAR_PROXIMITY_METERS, LOOSE_PARALLEL_THRESHOLD, 1) // Low confidence

      // 🎯 REVOLUTIONARY STATION ATTACHMENT GRID SYSTEM 🎯
      // Create discrete attachment points for each station to handle 8+ routes
      interface AttachmentPoint {
        id: string
        stationId: string
        position: LngLat
        direction: { x: number; y: number } // Outward direction
        angle: number // In radians
        occupied: boolean
        routeId?: string
      }
      
      const stationAttachmentPoints = new Map<string, AttachmentPoint[]>()
      const ATTACHMENT_DISTANCE_METERS = 40 // Distance from station center
      
      // Generate attachment grids for each station
      for (const station of stations) {
        const points: AttachmentPoint[] = []
        let pointId = 0
        
        // Primary grid: 8 cardinal and ordinal directions (0°, 45°, 90°, 135°, 180°, 225°, 270°, 315°)
        for (let i = 0; i < 8; i++) {
          const angle = (i * Math.PI) / 4 // 45-degree increments
          const direction = { x: Math.cos(angle), y: Math.sin(angle) }
          
          // Convert to geographic coordinates
          const stationMerc = MercatorCoordinate.fromLngLat([station.position.lng, station.position.lat], 0)
          const offsetMeters = ATTACHMENT_DISTANCE_METERS * stationMerc.meterInMercatorCoordinateUnits()
          const attachmentMerc = new MercatorCoordinate(
            stationMerc.x + direction.x * offsetMeters,
            stationMerc.y + direction.y * offsetMeters,
            0
          )
          const attachmentPos = attachmentMerc.toLngLat()
          
          points.push({
            id: `${station.id}-attach-${pointId++}`,
            stationId: station.id,
            position: { lng: attachmentPos.lng, lat: attachmentPos.lat },
            direction,
            angle,
            occupied: false
          })
        }
        
        // Secondary grid: 16 more precise directions (22.5-degree increments)
        for (let i = 0; i < 16; i++) {
          const angle = (i * Math.PI) / 8 // 22.5-degree increments  
          // Skip angles already covered by primary grid
          if (i % 2 === 0) continue
          
          const direction = { x: Math.cos(angle), y: Math.sin(angle) }
          
          const stationMerc = MercatorCoordinate.fromLngLat([station.position.lng, station.position.lat], 0)
          const offsetMeters = ATTACHMENT_DISTANCE_METERS * stationMerc.meterInMercatorCoordinateUnits()
          const attachmentMerc = new MercatorCoordinate(
            stationMerc.x + direction.x * offsetMeters,
            stationMerc.y + direction.y * offsetMeters,
            0
          )
          const attachmentPos = attachmentMerc.toLngLat()
          
          points.push({
            id: `${station.id}-attach-${pointId++}`,
            stationId: station.id,
            position: { lng: attachmentPos.lng, lat: attachmentPos.lat },
            direction,
            angle,
            occupied: false
          })
        }
        
        // Sort by angle for easier access
        points.sort((a, b) => a.angle - b.angle)
        stationAttachmentPoints.set(station.id, points)
      }
      
      // PHASE 4: Intelligent Route-to-Attachment-Point Mapping
      const routeAttachmentPoints = new Map<string, Map<string, AttachmentPoint>>() // routeId -> stationId -> attachmentPoint
      
      // Assign optimal attachment points for each route
      for (const route of routes) {
        if (route.stations.length < 2) continue
        
        const routeStations = route.stations.map(id => ST.get(id)).filter(Boolean)
        if (routeStations.length < 2) continue
        
        const routeMap = new Map<string, AttachmentPoint>()
        
        // For each station in the route, find the best attachment point
        for (let i = 0; i < routeStations.length; i++) {
          const station = routeStations[i]!
          const attachmentPoints = stationAttachmentPoints.get(station.id) || []
          
          let bestPoint: AttachmentPoint | null = null
          let bestScore = -Infinity
          
          // Determine preferred direction based on route geometry
          let preferredDirection: { x: number; y: number } | null = null
          
          if (i > 0 && i < routeStations.length - 1) {
            // Middle station - consider both neighbors
            const prev = routeStations[i - 1]!
            const next = routeStations[i + 1]!
            
            const prevDir = {
              x: prev.position.lng - station.position.lng,
              y: prev.position.lat - station.position.lat
            }
            const nextDir = {
              x: next.position.lng - station.position.lng,
              y: next.position.lat - station.position.lat
            }
            
            // Average direction
            const avgX = (prevDir.x + nextDir.x) / 2
            const avgY = (prevDir.y + nextDir.y) / 2
            const len = Math.hypot(avgX, avgY)
            preferredDirection = len > 0 ? { x: avgX / len, y: avgY / len } : null
          } else if (i === 0 && routeStations.length > 1) {
            // First station - look towards second
            const next = routeStations[1]!
            const dx = next.position.lng - station.position.lng
            const dy = next.position.lat - station.position.lat
            const len = Math.hypot(dx, dy)
            preferredDirection = len > 0 ? { x: dx / len, y: dy / len } : null
          } else if (i === routeStations.length - 1 && routeStations.length > 1) {
            // Last station - look towards previous
            const prev = routeStations[i - 1]!
            const dx = prev.position.lng - station.position.lng
            const dy = prev.position.lat - station.position.lat
            const len = Math.hypot(dx, dy)
            preferredDirection = len > 0 ? { x: dx / len, y: dy / len } : null
          }
          
          // Score attachment points based on alignment and availability
          for (const point of attachmentPoints) {
            let score = 0
            
            // Prefer unoccupied points
            if (!point.occupied) score += 100
            
            // Prefer points aligned with route direction
            if (preferredDirection) {
              const alignment = point.direction.x * preferredDirection.x + point.direction.y * preferredDirection.y
              score += alignment * 50 // Up to 50 bonus points for perfect alignment
            }
            
            // Prefer standard metro directions (cardinal + ordinal)
            const standardAngles = [0, Math.PI/4, Math.PI/2, 3*Math.PI/4, Math.PI, 5*Math.PI/4, 3*Math.PI/2, 7*Math.PI/4]
            const isStandardAngle = standardAngles.some(angle => Math.abs(point.angle - angle) < 0.01)
            if (isStandardAngle) score += 25
            
            if (score > bestScore) {
              bestScore = score
              bestPoint = point
            }
          }
          
          if (bestPoint) {
            bestPoint.occupied = true
            bestPoint.routeId = route.id
            routeMap.set(station.id, bestPoint)
          }
        }
        
        routeAttachmentPoints.set(route.id, routeMap)
      }
      
      // PHASE 5: Advanced Corridor Construction Using Attachment Points
      const corridors: Corridor[] = []
      const microToCorridors = new Map<string, Corridor[]>()
      let corridorIdCounter = 0

      // Weighted Union-Find for stronger parallel connections
      const corridorGroups = new Map<string, Set<MicroSegment>>()
      const parent = new Map<string, string>()
      const weight = new Map<string, number>()
      
      const find = (id: string): string => {
        if (!parent.has(id)) {
          parent.set(id, id)
          weight.set(id, 1)
          return id
        }
        if (parent.get(id) !== id) {
          parent.set(id, find(parent.get(id)!))
        }
        return parent.get(id)!
      }

      const union = (a: string, b: string, connectionStrength: number = 1) => {
        const rootA = find(a)
        const rootB = find(b)
        if (rootA !== rootB) {
          const weightA = weight.get(rootA) || 1
          const weightB = weight.get(rootB) || 1
          
          // Union by weighted strength
          if (weightA >= weightB) {
            parent.set(rootB, rootA)
            weight.set(rootA, weightA + weightB + connectionStrength)
          } else {
            parent.set(rootA, rootB)
            weight.set(rootB, weightA + weightB + connectionStrength)
          }
        }
      }

      // Group parallel micro-segments with strength weighting
      for (const pair of parallelPairs) {
        union(pair.a.id, pair.b.id, pair.strength)
      }

      // Collect groups
      for (const micro of allMicroSegments) {
        const root = find(micro.id)
        if (!corridorGroups.has(root)) {
          corridorGroups.set(root, new Set())
        }
        corridorGroups.get(root)!.add(micro)
      }

      // Create sophisticated corridors from groups (supporting 8+ routes)
      for (const [, microSet] of corridorGroups) {
        const micros = Array.from(microSet)
        const routes = new Set(micros.map(m => m.routeId))
        
        // Create corridors for multi-route groups (2+ routes)
        if (routes.size > 1) {
          const corridor: Corridor = {
            id: `corridor-${corridorIdCounter++}`,
            microSegments: micros,
            routes,
            centerLine: [], // Will be computed
            averageDirection: { x: 0, y: 0 } // Will be computed
          }

          // Compute weighted average direction with attachment point influence
          let avgDx = 0, avgDy = 0, totalWeight = 0
          
          // Weight by micro-segment length and strength
          for (const micro of micros) {
            const microWeight = micro.length * (weight.get(find(micro.id)) || 1)
            avgDx += micro.direction.x * microWeight
            avgDy += micro.direction.y * microWeight
            totalWeight += microWeight
          }
          
          // Also consider attachment point directions for this corridor
          for (const routeId of routes) {
            const routeAttachments = routeAttachmentPoints.get(routeId)
            if (routeAttachments) {
              for (const [, attachment] of routeAttachments) {
                avgDx += attachment.direction.x * 10 // Moderate influence
                avgDy += attachment.direction.y * 10
                totalWeight += 10
              }
            }
          }
          
          const len = totalWeight > 0 ? Math.hypot(avgDx, avgDy) : 0
          corridor.averageDirection = len > 0 ? { x: avgDx / len, y: avgDy / len } : { x: 1, y: 0 }
          
          // Sort micro-segments along the corridor using geometric centroid
          const centroidLng = micros.reduce((sum, m) => sum + m.centerPos.lng, 0) / micros.length
          const centroidLat = micros.reduce((sum, m) => sum + m.centerPos.lat, 0) / micros.length
          
          micros.sort((a, b) => {
            const projA = (a.centerPos.lng - centroidLng) * corridor.averageDirection.x + 
                         (a.centerPos.lat - centroidLat) * corridor.averageDirection.y
            const projB = (b.centerPos.lng - centroidLng) * corridor.averageDirection.x + 
                         (b.centerPos.lat - centroidLat) * corridor.averageDirection.y
            return projA - projB
          })
          corridor.microSegments = micros

          corridors.push(corridor)

          // Index micro-segments to corridors
          for (const micro of micros) {
            if (!microToCorridors.has(micro.id)) {
              microToCorridors.set(micro.id, [])
            }
            microToCorridors.get(micro.id)!.push(corridor)
          }
        }
      }

      // PHASE 6: Sophisticated Band Assignment for 8+ Routes using Attachment Points
      interface RouteScore {
        routeId: string
        geometricScore: number // Based on position relative to corridor
        attachmentScore: number // Based on attachment point alignment
        crossoverPenalty: number // Penalty for potential crossovers
        totalScore: number
      }
      const routeCorridorBands = new Map<string, Map<string, number>>() // corridorId -> routeId -> bandIndex

      for (const corridor of corridors) {
        const routeList = Array.from(corridor.routes)
        const numRoutes = routeList.length
        
        if (corridor.microSegments.length === 0 || numRoutes === 0) continue
        
        // 🎨 ADVANCED MULTI-CRITERIA ROUTE SCORING FOR 8+ ROUTES
        const routeScores: RouteScore[] = []
        
        // Calculate comprehensive scores for each route
        for (const routeId of routeList) {
          const route = routes.find(r => r.id === routeId)!
          const attachments = routeAttachmentPoints.get(routeId) || new Map()
          
          // 1. Geometric Score: Average signed distance to corridor centerline
          let geometricSum = 0, geometricCount = 0
          const corridorCenter = {
            lng: corridor.microSegments.reduce((sum, m) => sum + m.centerPos.lng, 0) / corridor.microSegments.length,
            lat: corridor.microSegments.reduce((sum, m) => sum + m.centerPos.lat, 0) / corridor.microSegments.length
          }
          
          for (const stationId of route.stations) {
            const station = ST.get(stationId)
            if (!station) continue
            
            const attachment = attachments.get(stationId)
            const referencePos = attachment ? attachment.position : station.position
            
            // Calculate signed distance using corridor direction
            const dx = referencePos.lng - corridorCenter.lng
            const dy = referencePos.lat - corridorCenter.lat
            
            // Project onto perpendicular to corridor direction
            const perpX = -corridor.averageDirection.y
            const perpY = corridor.averageDirection.x
            const signedDistance = dx * perpX + dy * perpY
            
            geometricSum += signedDistance
            geometricCount++
          }
          const geometricScore = geometricCount > 0 ? geometricSum / geometricCount : 0
          
          // 2. Attachment Score: How well aligned are attachment points
          let attachmentScore = 0
          let attachmentCount = 0
          for (const [, attachment] of attachments) {
            const alignment = attachment.direction.x * corridor.averageDirection.x + 
                            attachment.direction.y * corridor.averageDirection.y
            attachmentScore += Math.abs(alignment) // Prefer aligned attachment points
            attachmentCount++
          }
          attachmentScore = attachmentCount > 0 ? attachmentScore / attachmentCount : 0
          
          // 3. Initial crossover penalty (will be refined later)
          const crossoverPenalty = 0 // Calculated in optimization phase
          
          const totalScore = geometricScore + attachmentScore * 0.2 - crossoverPenalty
          
          routeScores.push({
            routeId,
            geometricScore,
            attachmentScore,
            crossoverPenalty,
            totalScore
          })
        }
        
        // Sort by total score for initial ordering
        routeScores.sort((a, b) => a.totalScore - b.totalScore)
        
        // 🤖 INTELLIGENT OPTIMIZATION FOR 8+ ROUTES
        const optimizeRouteOrdering = (initialScores: RouteScore[]): RouteScore[] => {
          if (initialScores.length <= 4) {
            // For smaller sets, test multiple permutations
            return findBestRouteOrdering(initialScores.map(rs => ({routeId: rs.routeId, score: rs.totalScore})), routes, ST, corridor)
              .map(item => initialScores.find(rs => rs.routeId === item.routeId)!)
          }
          
          // For large sets (5+ routes), use smart heuristics
          let bestOrdering = [...initialScores]
          let bestPenalty = calculateTotalPenalty(bestOrdering)
          
          // Try local improvements: swap adjacent pairs
          for (let iterations = 0; iterations < Math.min(50, numRoutes * 2); iterations++) {
            let improved = false
            
            for (let i = 0; i < bestOrdering.length - 1; i++) {
              // Try swapping adjacent routes
              const testOrdering = [...bestOrdering]
              ;[testOrdering[i], testOrdering[i + 1]] = [testOrdering[i + 1], testOrdering[i]]
              
              const testPenalty = calculateTotalPenalty(testOrdering)
              if (testPenalty < bestPenalty) {
                bestOrdering = testOrdering
                bestPenalty = testPenalty
                improved = true
              }
            }
            
            // Try moving routes to different positions
            for (let i = 0; i < bestOrdering.length; i++) {
              for (let j = 0; j < bestOrdering.length; j++) {
                if (i === j) continue
                
                const testOrdering = [...bestOrdering]
                const moved = testOrdering.splice(i, 1)[0]
                testOrdering.splice(j, 0, moved)
                
                const testPenalty = calculateTotalPenalty(testOrdering)
                if (testPenalty < bestPenalty) {
                  bestOrdering = testOrdering
                  bestPenalty = testPenalty
                  improved = true
                  break
                }
              }
            }
            
            if (!improved) break // Local optimum reached
          }
          
          return bestOrdering
        }
        
        // Calculate total penalty for an ordering
        const calculateTotalPenalty = (ordering: RouteScore[]): number => {
          let penalty = 0
          
          // Crossover penalty
          penalty += detectAdvancedCrossovers(ordering, routes) * 1000
          
          // Geometric constraint penalty  
          penalty += checkAdvancedGeometricConstraints(ordering, routes, ST) * 500
          
          // Attachment misalignment penalty
          for (let i = 0; i < ordering.length; i++) {
            const bandIndex = i
            const routeId = ordering[i].routeId
            const attachments = routeAttachmentPoints.get(routeId) || new Map()
            
            for (const [, attachment] of attachments) {
              // Penalize if attachment point doesn't align well with assigned band position
              const expectedDirection = getBandDirection(bandIndex, ordering.length, corridor.averageDirection)
              const alignment = attachment.direction.x * expectedDirection.x + attachment.direction.y * expectedDirection.y
              penalty += Math.max(0, (1 - Math.abs(alignment)) * 10) // Up to 10 penalty per misaligned attachment
            }
          }
          
          return penalty
        }
        
        // Get expected direction for a band position
        const getBandDirection = (bandIndex: number, totalBands: number, corridorDirection: { x: number; y: number }) => {
          // Calculate perpendicular offset direction
          const perpX = -corridorDirection.y
          const perpY = corridorDirection.x
          
          // For bands: negative index = left side, positive = right side
          const centeredIndex = bandIndex - (totalBands - 1) / 2
          const offsetSign = Math.sign(centeredIndex)
          
          return { x: perpX * offsetSign, y: perpY * offsetSign }
        }
        
        // Apply optimization
        const optimizedOrdering = optimizeRouteOrdering(routeScores)
        
        // Assign optimized band indices
        if (!routeCorridorBands.has(corridor.id)) {
          routeCorridorBands.set(corridor.id, new Map())
        }
        
        optimizedOrdering.forEach((routeScore, index) => {
          routeCorridorBands.get(corridor.id)!.set(routeScore.routeId, index)
        })
      }

      // 📊 ADVANCED CROSSOVER DETECTION FOR COMPLEX ROUTE NETWORKS
      function detectAdvancedCrossovers(
        ordering: RouteScore[],
        allRoutes: Route[],
      ): number {
        let crossoverCount = 0
        
        for (let i = 0; i < ordering.length - 1; i++) {
          for (let j = i + 1; j < ordering.length; j++) {
            const route1 = allRoutes.find(r => r.id === ordering[i].routeId)
            const route2 = allRoutes.find(r => r.id === ordering[j].routeId)
            
            if (!route1 || !route2) continue
            
            // Get attachment points for both routes
            const attachments1 = routeAttachmentPoints.get(route1.id) || new Map()
            const attachments2 = routeAttachmentPoints.get(route2.id) || new Map()
            
            // Check for crossovers at each station where both routes meet
            const commonStations = route1.stations.filter(id => route2.stations.includes(id))
            
            for (const stationId of commonStations) {
              const attach1 = attachments1.get(stationId)
              const attach2 = attachments2.get(stationId)
              
              if (attach1 && attach2) {
                // Check if attachment point ordering is inconsistent with band ordering
                const angleDiff = attach2.angle - attach1.angle
                const normalizedAngleDiff = ((angleDiff % (2 * Math.PI)) + (2 * Math.PI)) % (2 * Math.PI)
                
                // If route1 should be on left (lower band index) but attach2 is counter-clockwise from attach1
                if (normalizedAngleDiff > Math.PI) {
                  crossoverCount += 1
                }
              }
            }
          }
        }
        
        return crossoverCount
      }
      
      // 📌 ADVANCED GEOMETRIC CONSTRAINT CHECKING
      function checkAdvancedGeometricConstraints(
        ordering: RouteScore[],
        allRoutes: Route[],
        stationMap: Map<string, { id: string; position: LngLat; color: string; passengerCount: number }>
      ): number {
        let violations = 0
        
        for (const routeScore of ordering) {
          const route = allRoutes.find(r => r.id === routeScore.routeId)
          if (!route) continue
          
          const stations = route.stations.map(id => stationMap.get(id)).filter(Boolean)
          const attachments = routeAttachmentPoints.get(route.id) || new Map()
          
          // Check each segment using attachment points where available
          for (let segIdx = 0; segIdx < stations.length - 1; segIdx++) {
            const startStation = stations[segIdx]!
            const endStation = stations[segIdx + 1]!
            
            const startAttach = attachments.get(startStation.id)
            const endAttach = attachments.get(endStation.id)
            
            const startPos = startAttach ? startAttach.position : startStation.position
            const endPos = endAttach ? endAttach.position : endStation.position
            
            if (!isValidMetroSegment(startPos, endPos)) {
              violations++
            }
          }
        }
        
        return violations
      }
      
      // Enhanced route ordering function for small sets
      function findBestRouteOrdering(
        scored: { routeId: string; score: number }[],
        allRoutes: Route[],
        stationMap: Map<string, { id: string; position: LngLat; color: string; passengerCount: number }>,
        corridor: Corridor
      ): { routeId: string; score: number }[] {
        if (scored.length <= 1) return scored
        
        const orderings: { routeId: string; score: number }[][] = []
        
        if (scored.length <= 4) {
          // Test all permutations for small sets (up to 4 routes = 24 permutations)
          orderings.push(...getAllPermutations(scored))
        } else {
          // For larger sets, use heuristic approaches
          orderings.push([...scored]) // Original
          orderings.push([...scored].reverse()) // Reversed
          
          // Test systematic swaps
          for (let i = 0; i < scored.length - 1; i++) {
            const swapped = [...scored]
            ;[swapped[i], swapped[i + 1]] = [swapped[i + 1], swapped[i]]
            orderings.push(swapped)
          }
        }
        
        let bestOrdering = scored
        let bestScore = Infinity
        
        for (const ordering of orderings) {
          const score = evaluateOrdering(ordering, allRoutes, stationMap, corridor)
          if (score < bestScore) {
            bestScore = score
            bestOrdering = ordering
          }
        }
        
        return bestOrdering
      }

      // Helper function to get all permutations of a small array
      function getAllPermutations<T>(arr: T[]): T[][] {
        if (arr.length <= 1) return [arr]
        
        const result: T[][] = []
        for (let i = 0; i < arr.length; i++) {
          const rest = [...arr.slice(0, i), ...arr.slice(i + 1)]
          const restPerms = getAllPermutations(rest)
          for (const perm of restPerms) {
            result.push([arr[i], ...perm])
          }
        }
        return result
      }

      // Comprehensive evaluation function that considers crossovers AND geometric constraints
      function evaluateOrdering(
        ordering: { routeId: string; score: number }[],
        allRoutes: Route[],
        stationMap: Map<string, { id: string; position: LngLat; color: string; passengerCount: number }>,
        corridor: Corridor
      ): number {
        let penalty = 0
        
        // 1. Check for crossovers (high penalty)
        penalty += detectCrossovers(ordering, allRoutes, stationMap, corridor) * 100
        
        // 2. Check for geometric constraint violations (very high penalty)
        penalty += checkGeometricConstraints(ordering, allRoutes, stationMap) * 1000
        
        // 3. Prefer orderings that maintain original score-based relationships (low penalty)
        penalty += calculateScoreDisorder(ordering) * 1
        
        return penalty
      }

      // Detect actual crossovers using a more robust method
      function detectCrossovers(
        ordering: { routeId: string; score: number }[],
        allRoutes: Route[],
        stationMap: Map<string, { id: string; position: LngLat; color: string; passengerCount: number }>,
        corridor: Corridor
      ): number {
        let crossoverCount = 0
        
        // Simple crossover check - compare relative positions at route endpoints
        for (let i = 0; i < ordering.length - 1; i++) {
          for (let j = i + 1; j < ordering.length; j++) {
            const route1 = allRoutes.find(r => r.id === ordering[i].routeId)
            const route2 = allRoutes.find(r => r.id === ordering[j].routeId)
            
            if (!route1 || !route2) continue
            
            const stations1 = route1.stations.map(id => stationMap.get(id)).filter(Boolean)
            const stations2 = route2.stations.map(id => stationMap.get(id)).filter(Boolean)
            
            if (stations1.length < 2 || stations2.length < 2) continue
            
            // Compare relative positions at start and end
            const start1 = stations1[0]!.position
            const end1 = stations1[stations1.length - 1]!.position
            const start2 = stations2[0]!.position
            const end2 = stations2[stations2.length - 1]!.position
            
            const startRelPos = getRelativePosition(start1, start2, corridor.averageDirection)
            const endRelPos = getRelativePosition(end1, end2, corridor.averageDirection)
            
            // If relative positions are inverted between start and end, there's a crossover
            if (startRelPos * endRelPos < 0) {
              crossoverCount++
            }
          }
        }
        
        return crossoverCount
      }

      // Check if the ordering would violate geometric constraints (straight lines, 45° angles)
      function checkGeometricConstraints(
        ordering: { routeId: string; score: number }[],
        allRoutes: Route[],
        stationMap: Map<string, { id: string; position: LngLat; color: string; passengerCount: number }>
      ): number {
        let violations = 0
        
        // For each route, check if applying the offset would create non-standard angles
        for (let i = 0; i < ordering.length; i++) {
          const route = allRoutes.find(r => r.id === ordering[i].routeId)
          if (!route) continue
          
          const stations = route.stations.map(id => stationMap.get(id)).filter(Boolean)
          if (stations.length < 2) continue
          
          // Check each segment of the route maintains valid metro angles
          for (let segIdx = 0; segIdx < stations.length - 1; segIdx++) {
            const start = stations[segIdx]!.position
            const end = stations[segIdx + 1]!.position
            
            // Get schematic coordinates and validate each sub-segment
            const coords = createMetroRouteCoordinates(start, end)
            
            for (let j = 0; j < coords.length - 1; j++) {
              const segStart = { lng: coords[j][0], lat: coords[j][1] }
              const segEnd = { lng: coords[j + 1][0], lat: coords[j + 1][1] }
              
              if (!isValidMetroSegment(segStart, segEnd)) {
                violations++
              }
            }
          }
        }
        
        return violations
      }

      // Helper function to check if a segment maintains valid metro angles
      function isValidMetroSegment(start: LngLat, end: LngLat): boolean {
        // Convert to Mercator for accurate angle calculation
        const startMerc = MercatorCoordinate.fromLngLat([start.lng, start.lat], 0)
        const endMerc = MercatorCoordinate.fromLngLat([end.lng, end.lat], 0)
        
        const dx_m = endMerc.x - startMerc.x
        const dy_m = endMerc.y - startMerc.y
        const length_m = Math.hypot(dx_m, dy_m)
        
        if (length_m === 0) return true
        
        const nx = dx_m / length_m
        const ny = dy_m / length_m
        
        // Check if this is close to a valid metro direction (horizontal, vertical, or 45°)
        const isHorizontal = Math.abs(ny) < 0.15
        const isVertical = Math.abs(nx) < 0.15
        const isDiagonal = Math.abs(Math.abs(nx) - Math.abs(ny)) < 0.15
        
        return isHorizontal || isVertical || isDiagonal
      }

      // Calculate penalty for deviating from original score-based order
      function calculateScoreDisorder(ordering: { routeId: string; score: number }[]): number {
        let disorder = 0
        for (let i = 0; i < ordering.length - 1; i++) {
          if (ordering[i].score > ordering[i + 1].score) {
            disorder += Math.abs(ordering[i].score - ordering[i + 1].score)
          }
        }
        return disorder
      }

      // Helper function to get relative position between two points along a direction
      function getRelativePosition(pos1: LngLat, pos2: LngLat, direction: { x: number; y: number }): number {
        const dx = pos2.lng - pos1.lng
        const dy = pos2.lat - pos1.lat
        
        // Project onto perpendicular direction (rotate 90 degrees)
        const perpX = -direction.y
        const perpY = direction.x
        
        return dx * perpX + dy * perpY
      }

      // 🎆 RETURN SOPHISTICATED TOPOLOGY WITH ATTACHMENT GRID SYSTEM
      return {
        routeMicroSegments,
        corridors,
        microToCorridors,
        routeCorridorBands,
        stationAttachmentPoints, // New: attachment point grid system
        routeAttachmentPoints, // New: route-to-attachment mappings
        // Enhanced compatibility with attachment-aware spacing
        perRouteSegInfo: new Map<string, Map<string, { bandIndex: number; bandSize: number; spacing: number }>>()
      }
    }
    
    // Build advanced corridor-based topology
    const advancedTopo = buildAdvancedRouteCorridors(gameData.routes, gameData.stations)

    // Advanced Corridor-Aware Route Rendering with Sophisticated Parallel Detection
    gameData.routes.forEach(route => {
      if (route.stations.length < 2) return

      const routeStations = route.stations
        .map(id => gameData.stations.find(s => s.id === id))
        .filter((s): s is typeof gameData.stations[0] => !!s)

      const points: THREE.Vector3[] = []
      const routeMicros = advancedTopo.routeMicroSegments.get(route.id) || []
      
      // Get route's corridor information as fallback for points without individual corridor info
      const routeCorridorInfo = routeMicros.length > 0 ? (() => {
        const firstMicro = routeMicros[0]
        const corridorsForMicro = advancedTopo.microToCorridors.get(firstMicro.id) || []
        if (corridorsForMicro.length > 0) {
          const corridor = corridorsForMicro[0]
          const bandIndex = advancedTopo.routeCorridorBands.get(corridor.id)?.get(route.id) ?? 0
          const bandSize = corridor.routes.size
          const isDiagonal = Math.abs(Math.abs(corridor.averageDirection.x) - Math.abs(corridor.averageDirection.y)) < 0.3
          const spacing = isDiagonal ? 50 : 25
          return { bandIndex, bandSize, spacing, direction: corridor.averageDirection }
        }
        return null
      })() : null

      // Helper function to find the nearest micro-segment to a given position
      const findNearestMicroSegment = (pos: LngLat): MicroSegment | null => {
        let nearest: MicroSegment | null = null
        let minDistance = Infinity
        
        for (const micro of routeMicros) {
          const distance = getDistanceInMeters(pos, micro.centerPos)
          if (distance < minDistance) {
            minDistance = distance
            nearest = micro
          }
        }
        
        return minDistance < 50 ? nearest : null // Within 50m
      }

      // Helper function to get corridor band info for a position  
      const getCorridorBandInfo = (pos: LngLat): { bandIndex: number; bandSize: number; spacing: number; direction: { x: number; y: number } } | null => {
        const nearestMicro = findNearestMicroSegment(pos)
        if (!nearestMicro) return null

        const corridorsForMicro = advancedTopo.microToCorridors.get(nearestMicro.id) || []
        if (corridorsForMicro.length === 0) return null

        // Use the first corridor
        const corridor = corridorsForMicro[0]
        const bandIndex = advancedTopo.routeCorridorBands.get(corridor.id)?.get(route.id) ?? 0
        const bandSize = corridor.routes.size
        
        // Determine spacing based on corridor direction
        const isDiagonal = Math.abs(Math.abs(corridor.averageDirection.x) - Math.abs(corridor.averageDirection.y)) < 0.3
        const spacing = isDiagonal ? 50 : 25

        return { bandIndex, bandSize, spacing, direction: corridor.averageDirection }
      }


      // Helper function to calculate a consistent offset direction for the entire route
      const calculateRouteOffsetDirection = (
        routePoints: Array<{
          pos: LngLat;
          mercator: { x: number; y: number; z: number; meterInMercatorCoordinateUnits: () => number };
          segmentIndex: number;
          pointIndex: number;
          corridorInfo: ReturnType<typeof getCorridorBandInfo>;
          isStation: boolean;
        }>,
        fallbackCorridorInfo: typeof routeCorridorInfo
      ): { x: number; y: number } | null => {
        if (routePoints.length < 2) return null
        
        // Try to get corridor direction from any point that has corridor info
        for (const point of routePoints) {
          const corridorInfo = point.corridorInfo || fallbackCorridorInfo
          if (corridorInfo) {
            const direction = corridorInfo.direction
            
            // Calculate perfectly perpendicular direction (exact 90 degree rotation in Mercator space)
            const perpX = -direction.y
            const perpY = direction.x
            
            // Force snap to exact perpendicular directions for perfect straight lines
            const length = Math.hypot(perpX, perpY)
            if (length > 0) {
              const normalizedX = perpX / length
              const normalizedY = perpY / length
              
              // Snap to exact perpendicular directions to ensure perfect straight line offsets
              if (Math.abs(normalizedX) > Math.abs(normalizedY)) {
                // More horizontal - force pure horizontal
                return { x: normalizedX > 0 ? 1 : -1, y: 0 }
              } else {
                // More vertical - force pure vertical
                return { x: 0, y: normalizedY > 0 ? 1 : -1 }
              }
            }
          }
        }
        
        // Fallback: calculate direction from overall route trend with strict perpendicular snapping
        const firstPoint = routePoints[0]
        const lastPoint = routePoints[routePoints.length - 1]
        
        const startMerc = MercatorCoordinate.fromLngLat([firstPoint.pos.lng, firstPoint.pos.lat], 0)
        const endMerc = MercatorCoordinate.fromLngLat([lastPoint.pos.lng, lastPoint.pos.lat], 0)
        
        const dx_m = endMerc.x - startMerc.x
        const dy_m = endMerc.y - startMerc.y
        const length_m = Math.hypot(dx_m, dy_m)
        
        if (length_m === 0) return null
        
        // Determine primary route direction and calculate exact perpendicular
        const normalizedX = dx_m / length_m
        const normalizedY = dy_m / length_m
        
        // Snap route direction to exact metro directions first
        let routeDirection: { x: number; y: number }
        
        if (Math.abs(normalizedY) < 0.1) {
          // Horizontal route
          routeDirection = { x: normalizedX > 0 ? 1 : -1, y: 0 }
        } else if (Math.abs(normalizedX) < 0.1) {
          // Vertical route
          routeDirection = { x: 0, y: normalizedY > 0 ? 1 : -1 }
        } else if (Math.abs(Math.abs(normalizedX) - Math.abs(normalizedY)) < 0.1) {
          // 45-degree diagonal route
          routeDirection = { 
            x: normalizedX > 0 ? Math.SQRT1_2 : -Math.SQRT1_2, 
            y: normalizedY > 0 ? Math.SQRT1_2 : -Math.SQRT1_2 
          }
        } else {
          // Force to closest metro direction
          if (Math.abs(normalizedX) > Math.abs(normalizedY)) {
            routeDirection = { x: normalizedX > 0 ? 1 : -1, y: 0 }
          } else {
            routeDirection = { x: 0, y: normalizedY > 0 ? 1 : -1 }
          }
        }
        
        // Calculate exact perpendicular to the snapped route direction
        const perpX = -routeDirection.y
        const perpY = routeDirection.x
        
        return { x: perpX, y: perpY }
      }

      // SOPHISTICATED METRO-ANGLE PRESERVING RENDERING SYSTEM
      
      // First pass: collect all points and their corridor information
      const routePoints: Array<{
        pos: LngLat;
        mercator: { x: number; y: number; z: number; meterInMercatorCoordinateUnits: () => number };
        segmentIndex: number;
        pointIndex: number;
        corridorInfo: ReturnType<typeof getCorridorBandInfo>;
        isStation: boolean;
      }> = []

      for (let i = 0; i < routeStations.length - 1; i++) {
        const a = routeStations[i]!, b = routeStations[i + 1]!
        const coords = createMetroRouteCoordinates(a.position, b.position)

        const startIndex = i === 0 ? 0 : 1
        for (let j = startIndex; j < coords.length; j++) {
          const [lng, lat] = coords[j]
          const currentPos = { lng, lat }
          const merc = MercatorCoordinate.fromLngLat([lng, lat], 0)
          const corridorInfo = getCorridorBandInfo(currentPos)
          
          routePoints.push({
            pos: currentPos,
            mercator: merc,
            segmentIndex: i,
            pointIndex: j,
            corridorInfo,
            isStation: (j === 0 && i === 0) || (j === coords.length - 1 && i === routeStations.length - 2)
          })
        }
      }

      // Second pass: calculate metro-angle preserving offsets using consistent route-wide approach
      // This ensures all points in a route get the same offset direction for perfect alignment
      const processedPoints: THREE.Vector3[] = new Array(routePoints.length)
      
      // Calculate a single consistent offset direction for the entire route
      const routeOffsetDir = calculateRouteOffsetDirection(routePoints, routeCorridorInfo)
      
      // Process each segment and apply the consistent offset to both endpoints
      for (let i = 0; i < routePoints.length - 1; i++) {
        const startPoint = routePoints[i]
        const endPoint = routePoints[i + 1]
        
        // Process start point if not already processed
        if (!processedPoints[i]) {
          const merc = startPoint.mercator
          let offsetX = 0, offsetY = 0
          
          const corridorInfo = startPoint.corridorInfo || routeCorridorInfo
          if (corridorInfo && routeOffsetDir) {
            const { bandIndex, bandSize, spacing } = corridorInfo
            const centeredIdx = bandIndex - (bandSize - 1) / 2
            const offsetMeters = centeredIdx * spacing
            const metersToMerc = merc.meterInMercatorCoordinateUnits()
            
            // Apply sophisticated offset for multi-route scenarios
            // Optimized for 8+ routes with attachment point system
            
            // Apply consistent route-wide offset direction
            offsetX = routeOffsetDir.x * offsetMeters * metersToMerc
            offsetY = routeOffsetDir.y * offsetMeters * metersToMerc
          }
          
          const z = merc.z - merc.meterInMercatorCoordinateUnits() * 5
          processedPoints[i] = new THREE.Vector3(merc.x + offsetX, merc.y + offsetY, z)
        }
        
        // Process end point using THE SAME route-wide offset direction
        if (!processedPoints[i + 1]) {
          const merc = endPoint.mercator
          let offsetX = 0, offsetY = 0
          
          const corridorInfo = endPoint.corridorInfo || routeCorridorInfo
          if (corridorInfo && routeOffsetDir) {
            const { bandIndex, bandSize, spacing } = corridorInfo
            const centeredIdx = bandIndex - (bandSize - 1) / 2
            const offsetMeters = centeredIdx * spacing
            const metersToMerc = merc.meterInMercatorCoordinateUnits()
            
            // Apply THE SAME consistent route-wide offset direction
            offsetX = routeOffsetDir.x * offsetMeters * metersToMerc
            offsetY = routeOffsetDir.y * offsetMeters * metersToMerc
          }
          
          const z = merc.z - merc.meterInMercatorCoordinateUnits() * 5
          processedPoints[i + 1] = new THREE.Vector3(merc.x + offsetX, merc.y + offsetY, z)
        }
      }
      
      // Handle single-point routes
      if (routePoints.length === 1) {
        const point = routePoints[0]
        const merc = point.mercator
        const z = merc.z - merc.meterInMercatorCoordinateUnits() * 5
        processedPoints[0] = new THREE.Vector3(merc.x, merc.y, z)
      }
      
      // Fill points array
      points.push(...processedPoints)

      // 🔍 DEBUG: CHECK IF BASE ROUTE IS STRAIGHT BEFORE APPLYING PARALLEL OFFSETS
      const validateAndCorrectStationConnections = (points: THREE.Vector3[]): THREE.Vector3[] => {
        // Debug: Check if the route has proper parallel spacing
        if (points.length >= 2) {
          for (let i = 0; i < points.length - 1; i++) {
            const dx = points[i + 1].x - points[i].x
            const dy = points[i + 1].y - points[i].y
            const length = Math.hypot(dx, dy)
            
            if (length > 0.000001) {
              const nx = dx / length
              const ny = dy / length
              
              // Check if this segment is straight
              const isHorizontal = Math.abs(ny) < 0.01
              const isVertical = Math.abs(nx) < 0.01
              const isDiagonal = Math.abs(Math.abs(nx) - Math.abs(ny)) < 0.01
              
              if (!isHorizontal && !isVertical && !isDiagonal) {
                console.warn(`❌ Route ${route.id} segment ${i} not straight: angle=${Math.atan2(ny, nx) * 180 / Math.PI}°`)
              }
            }
            
          }
          
        }
        
        return points
      }
      
      // Apply geometric validation and correction
      const finalPoints = validateAndCorrectStationConnections(points)
      
      // Create the route line using corrected points
      const geometry = new THREE.BufferGeometry().setFromPoints(finalPoints)
      const material = new THREE.LineBasicMaterial({
        color: route.color,
        linewidth: 8,
        transparent: false,
        opacity: 1.0,
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

// Helper function to find closest station to a point (same as StationDragHandler)
function findClosestStation(
  point: LngLat, 
  stations: Array<{ id: string; position: LngLat; color: string }>, 
  maxDistanceMeters: number
): { id: string; position: LngLat; color: string } | null {
  let closestStation = null;
  let minDistance = Infinity;

  for (const station of stations) {
    const distance = getDistanceInMeters(point, station.position);
    if (distance < minDistance && distance <= maxDistanceMeters) {
      minDistance = distance;
      closestStation = station;
    }
  }
  return closestStation;
}

// Web Mercator-based distance calculation for consistency
function getDistanceInMeters(pos1: LngLat, pos2: LngLat): number {
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

export default GameThreeLayer