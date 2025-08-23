import { useEffect, useRef } from 'react'
import { useMap } from '@mapcomponents/react-maplibre'
import * as THREE from 'three'
import { MercatorCoordinate } from 'maplibre-gl'
import type { LngLat } from '../types'
import { createStationObject } from '../utils/threeStationFactory'
import { PERFORMANCE_CONFIG } from '../config/gameConfig'
import { useGameStore } from '../store/gameStore'
import { getTrainPositionFromMovementNetwork } from '../utils/routeNetworkCalculator'
import { getDistanceInMeters } from '../utils/coordinates'

interface GameThreeLayerProps {
  onStationClick?: (stationId: string) => void
  selectedStationId?: string | null
}

const GameThreeLayer = ({ onStationClick, selectedStationId }: GameThreeLayerProps) => {
  // Get game data and cached route network from store
  const { 
    stations, 
    routes, 
    trains, 
    trainMovementNetwork, 
    visualRouteNetwork, 
    useParallelVisualization 
  } = useGameStore()
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
      const closestStation = findClosestStation(pointLngLat, stations, 150) // 150m radius
      
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
  }, [mapContext?.map, onStationClick, stations])

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
      child.userData && ['station', 'route', 'route-simple', 'train', 'passenger', 'passengers', 'selection-ring', 'unconnected-ring', 'distress-particle', 'distress-glow'].includes(child.userData.type)
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
    stations.forEach(station => {
      const stationObj = createStationObject(station)
      if (!stationObj || !stationObj.object3D) return
      
      // Find routes connected to this station
      const connectedRoutes = routes.filter(route => route.stations.includes(station.id))
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
    
    // Route rendering logic
    if (useParallelVisualization && visualRouteNetwork) {
      // Use advanced parallel visualization
      routes.forEach(route => {
        if (route.stations.length < 2) return

        // Get cached visual route data for parallel rendering
        const visualRoute = visualRouteNetwork.routes.find((r) => r.routeId === route.id)
        if (!visualRoute) return

        // Use pre-calculated render points from visual cache
        const finalPoints = visualRoute.renderPoints.map((p) => new THREE.Vector3(p.x, p.y, p.z))

        // Create the route line using corrected points
        const geometry = new THREE.BufferGeometry().setFromPoints(finalPoints)
        const material = new THREE.LineBasicMaterial({
          color: route.color,
          linewidth: 6,
          transparent: true,
          opacity: 0.8
        })

        const line = new THREE.Line(geometry, material)
        line.userData = { type: 'route', routeId: route.id }
        scene.add(line)
      })
    } else {
      // Use simple straight-line rendering for basic visualization
      routes.forEach(route => {
        if (route.stations.length < 2) return

        const routeStations = route.stations
          .map(stationId => stations.find(s => s.id === stationId))
          .filter(Boolean)
        
        if (routeStations.length < 2) return

        // Simple straight lines between stations
        for (let i = 0; i < routeStations.length - 1; i++) {
          const start = routeStations[i]!
          const end = routeStations[i + 1]!
          
          const startMercator = MercatorCoordinate.fromLngLat([start.position.lng, start.position.lat], 0)
          const endMercator = MercatorCoordinate.fromLngLat([end.position.lng, end.position.lat], 0)

          // Position routes below stations (same as parallel view)
          const startZ = startMercator.z - startMercator.meterInMercatorCoordinateUnits() * 5
          const endZ = endMercator.z - endMercator.meterInMercatorCoordinateUnits() * 5

          const points = [
            new THREE.Vector3(startMercator.x, startMercator.y, startZ),
            new THREE.Vector3(endMercator.x, endMercator.y, endZ)
          ]

          const geometry = new THREE.BufferGeometry().setFromPoints(points)
          const material = new THREE.LineBasicMaterial({
            color: route.color,
            linewidth: 8,
            transparent: false,
            opacity: 1.0
          })

          const line = new THREE.Line(geometry, material)
          line.userData = { type: 'route-simple', routeId: route.id, segment: i }
          scene.add(line)
        }
      })
    }
    
    // Add trains
    trains.forEach(train => {
      const route = routes.find(r => r.id === train.routeId)
      if (!route || route.stations.length < 2) return
      
      const routeStations = route.stations.map(stationId => 
        stations.find(s => s.id === stationId)
      ).filter((station): station is { id: string; position: LngLat; color: string; passengerCount: number } => 
        station !== undefined
      )
      
      if (routeStations.length < 2) return
      
      // Calculate train position using train movement network for accurate positioning
      if (!trainMovementNetwork) return
      const trainLngLat = getTrainPositionFromMovementNetwork(trainMovementNetwork, train.routeId, train.position)
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
    const totalPassengers = stations.reduce((sum: number, station) => sum + (station.passengerCount || 0), 0)
    
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
      stations.forEach(station => {
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
  }, [stations, routes, trains, trainMovementNetwork, visualRouteNetwork, useParallelVisualization, selectedStationId])
  
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

export default GameThreeLayer