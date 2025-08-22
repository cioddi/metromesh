import { useEffect, useRef } from 'react'
import { useMap } from '@mapcomponents/react-maplibre'
import * as THREE from 'three'
import { MercatorCoordinate } from 'maplibre-gl'
import type { LngLat, Route, Train, Passenger } from '../types'
import { createStationObject } from '../utils/threeObjectFactories'
import { PERFORMANCE_CONFIG } from '../config/gameConfig'

// Helper function to create metro-style route coordinates using Web Mercator for true visual alignment
function createMetroRouteCoordinates(start: LngLat, target: LngLat): number[][] {
  // Convert to Web Mercator coordinates for true visual calculations
  const startMerc = MercatorCoordinate.fromLngLat([start.lng, start.lat], 0);
  const targetMerc = MercatorCoordinate.fromLngLat([target.lng, target.lat], 0);
  
  const dx_m = targetMerc.x - startMerc.x;
  const dy_m = targetMerc.y - startMerc.y;
  
  // Start with the starting point
  const coordinates: number[][] = [[start.lng, start.lat]];
  
  // Check for alignment using meters-based threshold (~10m equivalent in Mercator space)
  const startMeterUnit = startMerc.meterInMercatorCoordinateUnits();
  const alignmentThreshold = 10 * startMeterUnit; // ~10 meters in Mercator units
  
  // If already aligned horizontally or vertically, go straight
  if (Math.abs(dx_m) < alignmentThreshold) {
    coordinates.push([start.lng, target.lat]);
    return coordinates;
  }
  if (Math.abs(dy_m) < alignmentThreshold) {
    coordinates.push([target.lng, start.lat]);
    return coordinates;
  }
  
  // Calculate which direction to go diagonally first in Mercator space
  const absDx_m = Math.abs(dx_m);
  const absDy_m = Math.abs(dy_m);
  
  // Determine the 45-degree direction in Mercator space
  const diagonalDistance_m = Math.min(absDx_m, absDy_m);
  const signX = dx_m > 0 ? 1 : -1;
  const signY = dy_m > 0 ? 1 : -1;
  
  // Calculate the corner point in Mercator space for true 45-degree alignment
  let cornerMerc: MercatorCoordinate;
  
  if (absDx_m < absDy_m) {
    // Diagonal stops when we reach target x - ensure perfect vertical alignment for final segment
    cornerMerc = new MercatorCoordinate(
      targetMerc.x, 
      startMerc.y + signY * diagonalDistance_m, 
      0
    );
  } else {
    // Diagonal stops when we reach target y - ensure perfect horizontal alignment for final segment  
    cornerMerc = new MercatorCoordinate(
      startMerc.x + signX * diagonalDistance_m, 
      targetMerc.y, 
      0
    );
  }
  
  // Convert corner back to lng-lat
  const cornerLngLat = cornerMerc.toLngLat();
  let cornerLng = cornerLngLat.lng;
  let cornerLat = cornerLngLat.lat;
  
  // Ensure perfect alignment for final segments
  if (absDx_m < absDy_m) {
    // Final segment should be perfectly vertical - corner must have target's longitude
    cornerLng = target.lng;
  } else {
    // Final segment should be perfectly horizontal - corner must have target's latitude  
    cornerLat = target.lat;
  }
  
  // Check for duplicates before adding corner point
  const lastCoord = coordinates[coordinates.length - 1];
  const cornerThreshold = 0.000001; // Very small threshold for lng-lat comparison
  if (Math.abs(cornerLng - lastCoord[0]) > cornerThreshold || 
      Math.abs(cornerLat - lastCoord[1]) > cornerThreshold) {
    coordinates.push([cornerLng, cornerLat]);
  }
  
  // Check for duplicates before adding target point
  const currentLastCoord = coordinates[coordinates.length - 1];
  if (Math.abs(target.lng - currentLastCoord[0]) > cornerThreshold || 
      Math.abs(target.lat - currentLastCoord[1]) > cornerThreshold) {
    coordinates.push([target.lng, target.lat]);
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

      // PHASE 1: Dense Route Sampling - Convert routes into micro-segments
      const allMicroSegments: MicroSegment[] = []
      const routeMicroSegments = new Map<string, MicroSegment[]>()
      const SAMPLING_DISTANCE_METERS = 25 // Sample every 25 meters

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

      // PHASE 2: Spatial Indexing - Build spatial grid for efficient proximity queries
      const GRID_SIZE = 0.001 // ~100m grid cells in degrees
      const spatialGrid = new Map<string, SpatialCell>()

      const getGridKey = (pos: LngLat) => {
        const x = Math.floor(pos.lng / GRID_SIZE)
        const y = Math.floor(pos.lat / GRID_SIZE) 
        return `${x},${y}`
      }

      const getNeighborGridKeys = (pos: LngLat) => {
        const cx = Math.floor(pos.lng / GRID_SIZE)
        const cy = Math.floor(pos.lat / GRID_SIZE)
        const keys: string[] = []
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            keys.push(`${cx + dx},${cy + dy}`)
          }
        }
        return keys
      }

      // Index all micro-segments in spatial grid
      for (const micro of allMicroSegments) {
        const key = getGridKey(micro.centerPos)
        if (!spatialGrid.has(key)) {
          spatialGrid.set(key, { microSegments: [] })
        }
        spatialGrid.get(key)!.microSegments.push(micro)
      }

      // PHASE 3: Parallelism Detection - Find parallel and nearby micro-segments
      const PROXIMITY_THRESHOLD_METERS = 100 // Consider segments within 100m
      const PARALLEL_ANGLE_THRESHOLD = Math.PI / 8 // ~22.5 degrees
      
      const parallelPairs: Array<{ a: MicroSegment; b: MicroSegment; distance: number; similarity: number }> = []

      for (const microA of allMicroSegments) {
        const nearbyKeys = getNeighborGridKeys(microA.centerPos)
        
        for (const key of nearbyKeys) {
          const cell = spatialGrid.get(key)
          if (!cell) continue
          
          for (const microB of cell.microSegments) {
            // Skip same route and same micro-segment
            if (microA.routeId === microB.routeId || microA.id === microB.id) continue
            
            // Check if we already processed this pair
            if (microA.id > microB.id) continue
            
            const distance = getDistanceInMeters(microA.centerPos, microB.centerPos)
            if (distance > PROXIMITY_THRESHOLD_METERS) continue
            
            // Check parallelism - compute angle between direction vectors
            // Use absolute dot product to treat anti-parallel (180°) as parallel
            const dotProduct = microA.direction.x * microB.direction.x + microA.direction.y * microB.direction.y
            const angleDiff = Math.acos(Math.min(1, Math.max(-1, Math.abs(dotProduct))))
            
            // Only group routes that are truly parallel (not opposing directions)
            if (angleDiff < PARALLEL_ANGLE_THRESHOLD && Math.abs(dotProduct) > 0.7) {
              const similarity = Math.abs(dotProduct) // Use absolute dot product for similarity
              parallelPairs.push({ a: microA, b: microB, distance, similarity })
            }
          }
        }
      }

      // PHASE 4: Corridor Construction - Group parallel micro-segments into corridors
      const corridors: Corridor[] = []
      const microToCorridors = new Map<string, Corridor[]>()
      let corridorIdCounter = 0

      // Use Union-Find to group connected parallel segments
      const corridorGroups = new Map<string, Set<MicroSegment>>()
      const parent = new Map<string, string>()
      
      const find = (id: string): string => {
        if (!parent.has(id)) {
          parent.set(id, id)
          return id
        }
        if (parent.get(id) !== id) {
          parent.set(id, find(parent.get(id)!))
        }
        return parent.get(id)!
      }

      const union = (a: string, b: string) => {
        const rootA = find(a)
        const rootB = find(b)
        if (rootA !== rootB) {
          parent.set(rootB, rootA)
        }
      }

      // Group parallel micro-segments
      for (const pair of parallelPairs) {
        union(pair.a.id, pair.b.id)
      }

      // Collect groups
      for (const micro of allMicroSegments) {
        const root = find(micro.id)
        if (!corridorGroups.has(root)) {
          corridorGroups.set(root, new Set())
        }
        corridorGroups.get(root)!.add(micro)
      }

      // Create corridors from groups (only multi-route groups)
      for (const [, microSet] of corridorGroups) {
        const micros = Array.from(microSet)
        const routes = new Set(micros.map(m => m.routeId))
        
        // Only create corridors for multi-route groups
        if (routes.size > 1) {
          const corridor: Corridor = {
            id: `corridor-${corridorIdCounter++}`,
            microSegments: micros,
            routes,
            centerLine: [], // Will be computed
            averageDirection: { x: 0, y: 0 } // Will be computed
          }

          // Compute weighted average direction (by length)
          let avgDx = 0, avgDy = 0, totalWeight = 0
          for (const micro of micros) {
            const weight = micro.length
            avgDx += micro.direction.x * weight
            avgDy += micro.direction.y * weight
            totalWeight += weight
          }
          const len = totalWeight > 0 ? Math.hypot(avgDx, avgDy) : 0
          corridor.averageDirection = len > 0 ? { x: avgDx / len, y: avgDy / len } : { x: 1, y: 0 }
          
          // Sort micro-segments along the corridor direction for better reference line
          const tempOrigin = { x: 0, y: 0 } // Arbitrary origin for projection
          micros.sort((a, b) => {
            const projA = (a.centerPos.lng - tempOrigin.x) * corridor.averageDirection.x + 
                         (a.centerPos.lat - tempOrigin.y) * corridor.averageDirection.y
            const projB = (b.centerPos.lng - tempOrigin.x) * corridor.averageDirection.x + 
                         (b.centerPos.lat - tempOrigin.y) * corridor.averageDirection.y
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

      // PHASE 5: Band Assignment within Corridors
      const routeCorridorBands = new Map<string, Map<string, number>>() // routeId -> corridorId -> bandIndex

      for (const corridor of corridors) {
        const routeList = Array.from(corridor.routes)
        
        // Use the same scoring approach as the original algorithm but applied to corridor geometry
        if (corridor.microSegments.length === 0) continue
        
        // Find a representative line for this corridor
        const firstMicro = corridor.microSegments[0]
        const lastMicro = corridor.microSegments[corridor.microSegments.length - 1]
        
        const lineStart = firstMicro.centerPos
        const lineEnd = lastMicro.centerPos
        
        // Score each route by average signed distance of all its stations to corridor line
        const scored: { routeId: string; score: number }[] = []
        for (const routeId of routeList) {
          const route = routes.find(r => r.id === routeId)!
          let s = 0, c = 0
          for (const stationId of route.stations) {
            const station = ST.get(stationId)
            if (!station) continue
            s += signedDistanceToLine(
              { position: lineStart },
              { position: lineEnd },
              { position: station.position }
            )
            c++
          }
          scored.push({ routeId, score: (c ? s / c : 0) })
        }

        // Sort by score -> band order left(-) to right(+)
        scored.sort((u, v) => u.score - v.score)
        
        // Try different orderings and evaluate them based on crossovers AND geometric constraints
        const bestOrdering = findBestRouteOrdering(scored, routes, ST, corridor)
        
        // Assign band indices using the best ordering
        if (!routeCorridorBands.has(corridor.id)) {
          routeCorridorBands.set(corridor.id, new Map())
        }
        
        bestOrdering.forEach((item, index) => {
          routeCorridorBands.get(corridor.id)!.set(item.routeId, index)
        })
      }

      // Advanced function to find the best route ordering considering crossovers AND geometric constraints
      function findBestRouteOrdering(
        scored: { routeId: string; score: number }[],
        allRoutes: Route[],
        stationMap: Map<string, { id: string; position: LngLat; color: string; passengerCount: number }>,
        corridor: Corridor
      ): { routeId: string; score: number }[] {
        if (scored.length <= 1) return scored
        
        // For small numbers of routes, we can test all permutations
        // For larger numbers, we'll test key variations
        const orderings: { routeId: string; score: number }[][] = []
        
        if (scored.length <= 3) {
          // Test all permutations for small sets
          orderings.push(...getAllPermutations(scored))
        } else {
          // For larger sets, test key variations
          orderings.push([...scored]) // Original
          orderings.push([...scored].reverse()) // Reversed
          
          // Test swapping adjacent pairs
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

      // Helper function for signed distance calculation (same as before)
      function signedDistanceToLine(
        a: { position: LngLat },
        b: { position: LngLat },
        p: { position: LngLat }
      ) {
        const ax = a.position.lng, ay = a.position.lat
        const bx = b.position.lng, by = b.position.lat
        const px = p.position.lng, py = p.position.lat

        const vx = bx - ax, vy = by - ay
        const wx = px - ax, wy = py - ay
        const L = Math.hypot(vx, vy) || 1
        const nx = -vy / L, ny = vx / L
        return wx * nx + wy * ny
      }

      // Return the advanced corridor-based topology
      return {
        routeMicroSegments,
        corridors,
        microToCorridors,
        routeCorridorBands,
        // Legacy compatibility - create simple segment info for routes without corridors
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

      // Helper function to determine metro direction type using Web Mercator coordinates
      const getMetroDirection = (dx_m: number, dy_m: number): 'horizontal' | 'vertical' | 'diagonal' => {
        const length_m = Math.hypot(dx_m, dy_m)
        if (length_m === 0) return 'horizontal'
        
        const nx = dx_m / length_m
        const ny = dy_m / length_m
        
        // Check for horizontal (±1, 0) - very small y component
        if (Math.abs(ny) < 0.1) return 'horizontal'
        // Check for vertical (0, ±1) - very small x component
        if (Math.abs(nx) < 0.1) return 'vertical'
        // Check for diagonal (±1, ±1) - 45 degrees, equal x and y components
        if (Math.abs(Math.abs(nx) - Math.abs(ny)) < 0.2) return 'diagonal'
        
        // Default to closest metro direction
        if (Math.abs(nx) > Math.abs(ny)) return 'horizontal'
        return 'vertical'
      }

      // Helper function to get metro-compliant perpendicular offset direction in Web Mercator space
      const getMetroPerpendicularOffset = (segmentDirection: 'horizontal' | 'vertical' | 'diagonal', startPos: LngLat, endPos: LngLat): { x: number; y: number } => {
        // Convert to Mercator for true visual calculations
        const startMerc = MercatorCoordinate.fromLngLat([startPos.lng, startPos.lat], 0)
        const endMerc = MercatorCoordinate.fromLngLat([endPos.lng, endPos.lat], 0)
        
        const dx_m = endMerc.x - startMerc.x
        const dy_m = endMerc.y - startMerc.y
        const length_m = Math.hypot(dx_m, dy_m)
        
        if (length_m === 0) return { x: 0, y: 1 } // Default vertical offset
        
        const nx = dx_m / length_m
        const ny = dy_m / length_m
        
        // Calculate true perpendicular in Mercator space (rotate 90 degrees counterclockwise)
        const perpX = -ny  // Left normal
        const perpY = nx   // Left normal
        
        switch (segmentDirection) {
          case 'horizontal':
            // For horizontal segments, use pure vertical offset
            return { x: 0, y: perpY > 0 ? 1 : -1 }
          case 'vertical':
            // For vertical segments, use pure horizontal offset
            return { x: perpX > 0 ? 1 : -1, y: 0 }
          case 'diagonal': {
            // For diagonal segments, use true perpendicular direction
            // but snap to the nearest 45-degree increment for visual consistency
            const angle = Math.atan2(perpY, perpX)
            const quarterPi = Math.PI / 4
            
            // Round to nearest 45-degree angle
            const snapAngle = Math.round(angle / quarterPi) * quarterPi
            
            return {
              x: Math.cos(snapAngle),
              y: Math.sin(snapAngle)
            }
          }
          default:
            // Fallback: use computed perpendicular
            return { x: perpX, y: perpY }
        }
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

      // Second pass: calculate metro-angle preserving offsets using true segment-based approach
      // This ensures all points in a segment get the same offset direction for perfect alignment
      const processedPoints: THREE.Vector3[] = new Array(routePoints.length)
      
      // Process each segment and apply consistent offsets to both endpoints
      for (let i = 0; i < routePoints.length - 1; i++) {
        const startPoint = routePoints[i]
        const endPoint = routePoints[i + 1]
        
        // Calculate segment direction in Web Mercator space for consistent direction detection
        const startMerc = MercatorCoordinate.fromLngLat([startPoint.pos.lng, startPoint.pos.lat], 0)
        const endMerc = MercatorCoordinate.fromLngLat([endPoint.pos.lng, endPoint.pos.lat], 0)
        const dx_m = endMerc.x - startMerc.x
        const dy_m = endMerc.y - startMerc.y
        
        // Determine metro direction type and get proper perpendicular offset for this segment
        const metroDir = getMetroDirection(dx_m, dy_m)
        const offsetDir = getMetroPerpendicularOffset(metroDir, startPoint.pos, endPoint.pos)
        
        // Process start point if not already processed
        if (!processedPoints[i]) {
          const merc = startPoint.mercator
          let offsetX = 0, offsetY = 0
          
          const corridorInfo = startPoint.corridorInfo || routeCorridorInfo
          if (corridorInfo) {
            const { bandIndex, bandSize, spacing } = corridorInfo
            const centeredIdx = bandIndex - (bandSize - 1) / 2
            const offsetMeters = centeredIdx * spacing
            const metersToMerc = merc.meterInMercatorCoordinateUnits()
            
            // Apply true perpendicular offset in Mercator space
            offsetX = offsetDir.x * offsetMeters * metersToMerc
            offsetY = offsetDir.y * offsetMeters * metersToMerc
          }
          
          const z = merc.z - merc.meterInMercatorCoordinateUnits() * 5
          processedPoints[i] = new THREE.Vector3(merc.x + offsetX, merc.y + offsetY, z)
        }
        
        // Process end point using THE SAME segment direction and offset
        if (!processedPoints[i + 1]) {
          const merc = endPoint.mercator
          let offsetX = 0, offsetY = 0
          
          const corridorInfo = endPoint.corridorInfo || routeCorridorInfo
          if (corridorInfo) {
            const { bandIndex, bandSize, spacing } = corridorInfo
            const centeredIdx = bandIndex - (bandSize - 1) / 2
            const offsetMeters = centeredIdx * spacing
            const metersToMerc = merc.meterInMercatorCoordinateUnits()
            
            // Apply THE SAME perpendicular offset as start point for perfect alignment
            offsetX = offsetDir.x * offsetMeters * metersToMerc
            offsetY = offsetDir.y * offsetMeters * metersToMerc
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

      // Create the route line
      const geometry = new THREE.BufferGeometry().setFromPoints(points)
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