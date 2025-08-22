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
      const dlng = pos2.lng - pos1.lng
      const dlat = pos2.lat - pos1.lat
      
      // Rough conversion to meters (assuming roughly 111km per degree)
      const dxMeters = dlng * 111000 * Math.cos(pos1.lat * Math.PI / 180)
      const dyMeters = dlat * 111000
      
      return Math.sqrt(dxMeters * dxMeters + dyMeters * dyMeters)
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
        
        // Calculate total route length first
        for (let i = 0; i < routeStations.length - 1; i++) {
          const start = routeStations[i]!
          const end = routeStations[i + 1]!
          const segLength = getDistanceInMeters(start.position, end.position)
          totalRouteLength += segLength
        }

        let currentRouteDistance = 0

        // Sample each segment of the route
        for (let segIdx = 0; segIdx < routeStations.length - 1; segIdx++) {
          const start = routeStations[segIdx]!
          const end = routeStations[segIdx + 1]!
          const segLength = getDistanceInMeters(start.position, end.position)
          
          if (segLength < 1) continue // Skip very short segments
          
          const numSamples = Math.max(2, Math.ceil(segLength / SAMPLING_DISTANCE_METERS))
          
          for (let sampleIdx = 0; sampleIdx < numSamples - 1; sampleIdx++) {
            const t1 = sampleIdx / (numSamples - 1)
            const t2 = (sampleIdx + 1) / (numSamples - 1)
            
            const startPos = interpolatePosition(start.position, end.position, t1)
            const endPos = interpolatePosition(start.position, end.position, t2)
            const centerPos = interpolatePosition(startPos, endPos, 0.5)
            
            const dx = endPos.lng - startPos.lng
            const dy = endPos.lat - startPos.lat
            const len = Math.hypot(dx, dy)
            
            const microSeg: MicroSegment = {
              id: `micro-${microSegmentCounter++}`,
              routeId: route.id,
              startPos,
              endPos,
              centerPos,
              direction: len > 0 ? { x: dx / len, y: dy / len } : { x: 1, y: 0 },
              length: len,
              routeT: (currentRouteDistance + (sampleIdx / (numSamples - 1)) * segLength) / totalRouteLength,
              segmentIndex: segIdx
            }
            
            routeMicros.push(microSeg)
            allMicroSegments.push(microSeg)
          }
          
          currentRouteDistance += segLength
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
            const dotProduct = microA.direction.x * microB.direction.x + microA.direction.y * microB.direction.y
            const angleDiff = Math.acos(Math.min(1, Math.max(-1, Math.abs(dotProduct))))
            
            if (angleDiff < PARALLEL_ANGLE_THRESHOLD) {
              const similarity = 1 - (angleDiff / PARALLEL_ANGLE_THRESHOLD) // 1 = perfectly parallel, 0 = at threshold
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

          // Compute average direction
          let avgDx = 0, avgDy = 0
          for (const micro of micros) {
            avgDx += micro.direction.x
            avgDy += micro.direction.y
          }
          const len = Math.hypot(avgDx, avgDy)
          corridor.averageDirection = len > 0 ? { x: avgDx / len, y: avgDy / len } : { x: 1, y: 0 }

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
        
        // Assign band indices
        if (!routeCorridorBands.has(corridor.id)) {
          routeCorridorBands.set(corridor.id, new Map())
        }
        
        scored.forEach((item, index) => {
          routeCorridorBands.get(corridor.id)!.set(item.routeId, index)
        })
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

      // Helper function to determine metro direction type
      const getMetroDirection = (dx: number, dy: number): 'horizontal' | 'vertical' | 'diagonal' => {
        const length = Math.hypot(dx, dy)
        if (length === 0) return 'horizontal'
        
        const nx = dx / length
        const ny = dy / length
        
        // Check for horizontal (±1, 0)
        if (Math.abs(ny) < 0.1) return 'horizontal'
        // Check for vertical (0, ±1)  
        if (Math.abs(nx) < 0.1) return 'vertical'
        // Check for diagonal (±1, ±1) - 45 degrees
        if (Math.abs(Math.abs(nx) - Math.abs(ny)) < 0.2) return 'diagonal'
        
        // Default to closest metro direction
        if (Math.abs(nx) > Math.abs(ny)) return 'horizontal'
        return 'vertical'
      }

      // Helper function to get metro-compliant perpendicular offset direction
      const getMetroPerpendicularOffset = (segmentDirection: 'horizontal' | 'vertical' | 'diagonal', dx: number, dy: number): { x: number; y: number } => {
        const length = Math.hypot(dx, dy)
        if (length === 0) return { x: 0, y: 1 } // Default vertical offset
        
        const nx = dx / length
        const ny = dy / length
        
        switch (segmentDirection) {
          case 'horizontal':
            // For horizontal segments, offset vertically (pure up/down)
            return { x: 0, y: 1 } // Always offset upward for consistency
          case 'vertical':
            // For vertical segments, offset horizontally (pure left/right)  
            return { x: 1, y: 0 } // Always offset rightward for consistency
          case 'diagonal': {
            // For diagonal segments, calculate precise perpendicular in 45-degree increments
            // Determine which diagonal this is and provide exact perpendicular
            
            // Normalize to exact 45-degree angles
            const angle = Math.atan2(ny, nx)
            const quarterPi = Math.PI / 4
            
            // Round to nearest 45-degree angle
            const snapAngle = Math.round(angle / quarterPi) * quarterPi
            
            // Calculate perpendicular (add 90 degrees)
            const perpAngle = snapAngle + Math.PI / 2
            
            return {
              x: Math.cos(perpAngle),
              y: Math.sin(perpAngle)
            }
          }
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

      // Second pass: calculate metro-angle preserving offsets
      for (let i = 0; i < routePoints.length; i++) {
        const point = routePoints[i]
        const merc = point.mercator

        // Determine local metro direction and offset
        let offsetX = 0, offsetY = 0

        if (point.corridorInfo) {
          const { bandIndex, bandSize, spacing } = point.corridorInfo
          const centeredIdx = bandIndex - (bandSize - 1) / 2
          const offsetMeters = centeredIdx * spacing

          // Calculate direction for offset
          let dx = 0, dy = 0
          
          // Get direction from neighboring points
          if (i === 0 && i < routePoints.length - 1) {
            // First point - use direction to next point
            const nextPoint = routePoints[i + 1]
            dx = nextPoint.pos.lng - point.pos.lng
            dy = nextPoint.pos.lat - point.pos.lat
          } else if (i === routePoints.length - 1 && i > 0) {
            // Last point - use direction from previous point
            const prevPoint = routePoints[i - 1]
            dx = point.pos.lng - prevPoint.pos.lng
            dy = point.pos.lat - prevPoint.pos.lat
          } else if (i > 0 && i < routePoints.length - 1) {
            // Middle point - use average direction
            const prevPoint = routePoints[i - 1]
            const nextPoint = routePoints[i + 1]
            dx = (nextPoint.pos.lng - prevPoint.pos.lng) * 0.5
            dy = (nextPoint.pos.lat - prevPoint.pos.lat) * 0.5
          }

          // Determine metro direction type and get proper perpendicular offset
          const metroDir = getMetroDirection(dx, dy)
          const offsetDir = getMetroPerpendicularOffset(metroDir, dx, dy)

          // Apply metro-compliant offset
          const metersToMerc = merc.meterInMercatorCoordinateUnits()
          offsetX = offsetDir.x * offsetMeters * metersToMerc
          offsetY = offsetDir.y * offsetMeters * metersToMerc
        }

        const z = merc.z - merc.meterInMercatorCoordinateUnits() * 5
        points.push(new THREE.Vector3(merc.x + offsetX, merc.y + offsetY, z))
      }

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

// Simple distance calculation (same as StationDragHandler)
function getDistanceInMeters(pos1: LngLat, pos2: LngLat): number {
  const dlng = pos2.lng - pos1.lng;
  const dlat = pos2.lat - pos1.lat;
  
  // Rough conversion to meters (assuming roughly 111km per degree)
  const dxMeters = dlng * 111000 * Math.cos(pos1.lat * Math.PI / 180);
  const dyMeters = dlat * 111000;
  
  return Math.sqrt(dxMeters * dxMeters + dyMeters * dyMeters);
}

export default GameThreeLayer