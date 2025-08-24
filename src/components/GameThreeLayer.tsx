import { useEffect, useRef, useState } from 'react'
import { useMap } from '@mapcomponents/react-maplibre'
import * as THREE from 'three'
import { MercatorCoordinate } from 'maplibre-gl'
import type { LngLat } from '../types'
import { 
  createStationObject,
  disposeAllSharedThreeResources
} from '../utils/threeObjectFactories'
import { PERFORMANCE_CONFIG } from '../config/gameConfig'
import { useGameStore } from '../store/gameStore'
import { getTrainPositionFromMovementNetwork } from '../utils/routeNetworkCalculator'
import { getDistanceInMeters } from '../utils/coordinates'

// --- Generic Sync Objects Utility ---
function syncObjects<T extends { id: string }, U extends THREE.Object3D>(
  dataArray: T[],
  objectMap: Map<string, U>,
  scene: THREE.Scene,
  createFn: (data: T) => U,
  updateFn: (data: T, object: U, ...args: any[]) => void,
  disposeFn: (object: U) => void,
  ...updateFnArgs: any[]
) {
  const currentIds = new Set(dataArray.map(d => d.id))

  // 1. Add/Update phase
  for (const data of dataArray) {
    let object = objectMap.get(data.id)
    if (object) {
      updateFn(data, object, ...updateFnArgs) // Exists: Update it
    } else {
      object = createFn(data) // New: Create it
      objectMap.set(data.id, object)
      scene.add(object)
      updateFn(data, object, ...updateFnArgs) // Also run update on creation for initial setup
    }
  }

  // 2. Remove phase
  objectMap.forEach((object, id) => {
    if (!currentIds.has(id)) {
      disposeFn(object)
      scene.remove(object)
      objectMap.delete(id)
    }
  })
}

// --- Robust Disposal Utility ---
function disposeObject(object: THREE.Object3D) {
  if (!object) return
  object.traverse(child => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose()
      if (Array.isArray(child.material)) {
        child.material.forEach(mat => mat.dispose())
      } else if (child.material.map) {
        child.material.map.dispose()
        child.material.dispose()
      }
    }
  })
  if (object.parent) object.parent.remove(object)
}

// --- Object-Specific Update & Animation Functions ---

// Runs ONLY on state change to manage object structure and animation tags
function updateStationVisuals(
  station: any,
  group: THREE.Group,
  selectedStationId: string | null,
  routes: any[],
  sharedGeometries: any,
  _distressMaterialCache: Map<string, THREE.MeshBasicMaterial>
) {
  const isUnconnected = !routes.some(r => r.stations.includes(station.id))
  const isDistressed = (station.passengerCount || 0) >= 15

  // Reset animation flag; it will be re-enabled if any animatable state is active
  group.userData.isAnimating = false

  // --- Manage Selection Ring ---
  const selectionRing = group.getObjectByName('selectionRing')
  if (selectedStationId === station.id) {
    if (!selectionRing && sharedGeometries.selectionRingGeometry && sharedGeometries.selectionRingMaterial) {
      const ring = new THREE.Mesh(
        sharedGeometries.selectionRingGeometry,
        sharedGeometries.selectionRingMaterial
      )
      ring.name = 'selectionRing'
      ring.position.z = 0.05
      ring.userData = { type: 'selection-ring' }
      group.add(ring)
    }
  } else if (selectionRing) {
    disposeObject(selectionRing)
  }

  // --- Manage Unconnected Ring ---
  const unconnectedRing = group.getObjectByName('unconnectedRing')
  if (isUnconnected) {
    if (!unconnectedRing && sharedGeometries.unconnectedRingGeometry && sharedGeometries.unconnectedRingMaterial) {
      const ring = new THREE.Mesh(
        sharedGeometries.unconnectedRingGeometry,
        sharedGeometries.unconnectedRingMaterial
      )
      ring.name = 'unconnectedRing'
      ring.position.z = 0.02
      ring.userData = { type: 'unconnected-ring' }
      group.add(ring)
    }
    group.userData.isAnimating = true // TAG for animation
  } else if (unconnectedRing) {
    disposeObject(unconnectedRing)
  }

  // --- Manage Distress Effects ---
  const distressGlow = group.getObjectByName('distressGlow')
  if (isDistressed) {
    if (!distressGlow) {
      const glow = new THREE.Group()
      glow.name = 'distressGlow'
      
      // Create all distress effect elements
      
      // Primary energy ring
      const primaryRingGeometry = new THREE.RingGeometry(2.2, 2.6, 64)
      const primaryRingMaterial = new THREE.MeshBasicMaterial({
        color: new THREE.Color().setHSL(0.05, 0.9, 0.6),
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
        blending: THREE.NormalBlending
      })
      const primaryRing = new THREE.Mesh(primaryRingGeometry, primaryRingMaterial)
      primaryRing.name = 'primaryRing'
      primaryRing.position.z = 0.4
      glow.add(primaryRing)

      // Outer ring
      const outerRingGeometry = new THREE.RingGeometry(3.0, 3.2, 64)
      const outerRingMaterial = new THREE.MeshBasicMaterial({
        color: new THREE.Color().setHSL(0.95, 0.8, 0.6),
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide,
        blending: THREE.NormalBlending
      })
      const outerRing = new THREE.Mesh(outerRingGeometry, outerRingMaterial)
      outerRing.name = 'outerRing'
      outerRing.position.z = 0.3
      glow.add(outerRing)

      // Aura sphere
      const auraGeometry = new THREE.SphereGeometry(1.8, 32, 16)
      const auraMaterial = new THREE.MeshBasicMaterial({
        color: new THREE.Color().setHSL(0.08, 0.8, 0.4),
        transparent: true,
        opacity: 0.2,
        side: THREE.BackSide,
        blending: THREE.NormalBlending
      })
      const auraSphere = new THREE.Mesh(auraGeometry, auraMaterial)
      auraSphere.name = 'auraSphere'
      auraSphere.position.z = 0.5
      glow.add(auraSphere)

      // Shimmer layer
      const shimmerGeometry = new THREE.CylinderGeometry(1.1, 1.1, 0.1, 32)
      const shimmerMaterial = new THREE.MeshBasicMaterial({
        color: new THREE.Color().setHSL(0.12, 0.9, 0.5),
        transparent: true,
        opacity: 0.4,
        side: THREE.DoubleSide,
        blending: THREE.NormalBlending
      })
      const shimmerLayer = new THREE.Mesh(shimmerGeometry, shimmerMaterial)
      shimmerLayer.name = 'shimmerLayer'
      shimmerLayer.position.z = 0.6
      glow.add(shimmerLayer)
      
      group.add(glow)
    }
    group.userData.isAnimating = true // TAG for animation
  } else if (distressGlow) {
    disposeObject(distressGlow)
    
    // Restore original shared material when no longer distressed
    const stationMesh = group.children[1] as THREE.Mesh
    if (stationMesh && stationMesh.userData.hasIndividualMaterial) {
      // Dispose the individual material and restore shared material
      if (stationMesh.material instanceof THREE.Material) {
        stationMesh.material.dispose()
      }
      // Get the shared material from the factory - we need to import it
      // For now, create a new material with default white color
      stationMesh.material = new THREE.MeshLambertMaterial({
        color: 0xffffff,
        side: THREE.DoubleSide
      })
      stationMesh.userData.hasIndividualMaterial = false
    }
  }

  // --- Update Connected Route Rings ---
  const connectedRoutes = routes.filter(route => route.stations.includes(station.id))
  
  // Remove old route rings
  const existingRouteRings = group.children.filter(child => child.userData.type === 'route-ring')
  existingRouteRings.forEach(ring => disposeObject(ring))
  
  // Add new route rings
  connectedRoutes.forEach((route, index) => {
    const ringGeometry = new THREE.RingGeometry(
      1.1 + (index * 0.15),
      1.25 + (index * 0.15),
      64
    )
    const ringMaterial = new THREE.MeshPhysicalMaterial({
      color: route.color,
      emissive: new THREE.Color(route.color).multiplyScalar(0.3),
      transparent: false,
      roughness: 0.15,
      metalness: 0.0,
      envMapIntensity: 0.8,
      clearcoat: 0.5,
      clearcoatRoughness: 0.02,
      side: THREE.DoubleSide
    })
    const ring = new THREE.Mesh(ringGeometry, ringMaterial)
    ring.position.z = 0.03
    ring.castShadow = true
    ring.userData = { type: 'route-ring' }
    group.add(ring)
  })
}

// Runs EVERY FRAME to update visual properties of tagged objects
function runStationAnimations(group: THREE.Group, stationData: any, time: number) {
  const timeSeconds = time * 0.001

  // --- Animate Unconnected Ring (if it exists) ---
  const unconnectedRing = group.getObjectByName('unconnectedRing')
  if (unconnectedRing) {
    const stationHash = stationData.id.split('').reduce((a: number, b: string) => a + b.charCodeAt(0), 0)
    const staggeredTime = time * 0.002 + (stationHash % 10) * 0.314
    const pulse = 0.85 + Math.sin(staggeredTime) * 0.15
    unconnectedRing.scale.setScalar(pulse)
  }

  // --- Animate Distress Effects (if they exist) ---
  const distressGlow = group.getObjectByName('distressGlow')
  if (distressGlow && stationData.passengerCount) {
    const passengerCount = stationData.passengerCount || 0
    const distressIntensity = Math.min(passengerCount / 20, 1.0)
    
    // Update station material color
    const stationMesh = group.children[1] as THREE.Mesh
    if (stationMesh && stationMesh.material) {
      const pulseSpeed = 3 + distressIntensity * 7
      const pulseIntensity = 0.3 + distressIntensity * 0.5
      const heatPulse = pulseIntensity * Math.sin(time * 0.001 * pulseSpeed)
      
      const redHue = 0.08 * (1 - distressIntensity)
      const saturation = 0.8 + 0.2 * distressIntensity
      const lightness = 0.4 + 0.2 * (1 + heatPulse)
      
      // Create individual material for this station to avoid affecting others
      if (!stationMesh.userData.hasIndividualMaterial) {
        const individualMaterial = (stationMesh.material as THREE.MeshLambertMaterial).clone()
        stationMesh.material = individualMaterial
        stationMesh.userData.hasIndividualMaterial = true
      }
      
      ;(stationMesh.material as THREE.MeshLambertMaterial).color.setHSL(redHue, saturation, lightness)
    }

    // Animate primary ring
    const primaryRing = distressGlow.getObjectByName('primaryRing')
    if (primaryRing) {
      const ringIntensity = 0.7 + 0.3 * Math.sin(timeSeconds * 6)
      const material = (primaryRing as THREE.Mesh).material as THREE.MeshBasicMaterial
      material.opacity = 0.7 + 0.2 * ringIntensity
      primaryRing.scale.setScalar(1 + 0.2 * Math.sin(timeSeconds * 4))
    }

    // Animate outer ring
    const outerRing = distressGlow.getObjectByName('outerRing')
    if (outerRing) {
      const material = (outerRing as THREE.Mesh).material as THREE.MeshBasicMaterial
      material.opacity = 0.5 + 0.2 * Math.sin(timeSeconds * 5 + Math.PI)
      outerRing.scale.setScalar(1 + 0.15 * Math.sin(timeSeconds * 3 + Math.PI/2))
    }

    // Animate aura sphere
    const auraSphere = distressGlow.getObjectByName('auraSphere')
    if (auraSphere) {
      const material = (auraSphere as THREE.Mesh).material as THREE.MeshBasicMaterial
      material.opacity = 0.2 + 0.1 * Math.sin(timeSeconds * 8)
      auraSphere.scale.setScalar(1 + 0.3 * Math.sin(timeSeconds * 3))
    }

    // Animate shimmer layer
    const shimmerLayer = distressGlow.getObjectByName('shimmerLayer')
    if (shimmerLayer) {
      const shimmerMaterial = (shimmerLayer as THREE.Mesh).material as THREE.MeshBasicMaterial
      shimmerMaterial.color.setHSL(0.12, 0.9, 0.5 + 0.2 * Math.sin(timeSeconds * 12))
      shimmerMaterial.opacity = 0.4 + 0.2 * Math.sin(timeSeconds * 8)
      shimmerLayer.scale.setScalar(1 + 0.1 * Math.sin(timeSeconds * 10))
    }
  }
}

function updateTrainVisuals(train: any, mesh: THREE.Mesh, _trainMovementNetwork: any, routes: any[], sharedGeometries: any) {
  const route = routes.find(r => r.id === train.routeId)
  if (!route) return

  // Update color if needed
  const currentColor = (mesh.material as THREE.MeshPhysicalMaterial).color.getHex()
  const routeColor = new THREE.Color(route.color).getHex()
  if (currentColor !== routeColor) {
    ;(mesh.material as THREE.MeshPhysicalMaterial).color.setHex(routeColor)
    ;(mesh.material as THREE.MeshPhysicalMaterial).emissive = new THREE.Color(route.color).multiplyScalar(0.3)
  }

  // --- Manage Train Passengers ---
  // Only update passengers if the count actually changed
  const existingPassengers = mesh.children.filter(child => child.userData.type === 'train-passenger')
  const currentVisualPassengerCount = existingPassengers.length
  const newVisualPassengerCount = train.passengerCount > 0 ? Math.min(train.passengerCount, PERFORMANCE_CONFIG.maxTrainPassengers) : 0
  
  if (currentVisualPassengerCount !== newVisualPassengerCount) {
    // Remove all existing passenger dots
    existingPassengers.forEach(passenger => disposeObject(passenger))

    // Add new passenger dots if train has passengers
    if (newVisualPassengerCount > 0 && sharedGeometries.trainPassengerGeometry && sharedGeometries.trainPassengerMaterial) {
      for (let passengerIndex = 0; passengerIndex < newVisualPassengerCount; passengerIndex++) {
        // Reuse shared geometry and material
        const dot = new THREE.Mesh(
          sharedGeometries.trainPassengerGeometry,
          sharedGeometries.trainPassengerMaterial
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
        dot.scale.set(1.2, 1.2, 1.2) // 20% larger
        dot.userData = { type: 'train-passenger' }
        mesh.add(dot)
      }
    }
  }
}

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
  // Mobile reinitialization trigger - while this is a state for side effects pattern,
  // it's the most reliable way to trigger complete Three.js layer recreation on mobile orientation changes
  const [mobileReinitKey, setMobileReinitKey] = useState(0)
  const raycasterRef = useRef<THREE.Raycaster | null>(null)
  const mouseRef = useRef<THREE.Vector2 | null>(null)
  
  // --- Persistent Object References for Performance ---
  // Refs to hold maps of game IDs to live Three.js objects
  const stationObjects = useRef(new Map<string, THREE.Group>())
  const routeObjects = useRef(new Map<string, THREE.Object3D>())
  const trainObjects = useRef(new Map<string, THREE.Mesh>())
  
  // Ref to hold the ID of the requestAnimationFrame loop
  const animationFrameId = useRef<number | undefined>(undefined)
  
  // Shared geometries and materials for performance
  // TODO: Migrate to factories incrementally
  const sharedGeometriesRef = useRef<{
    passengerGeometry?: THREE.CylinderGeometry
    trainPassengerGeometry?: THREE.CylinderGeometry
    passengerMaterial?: THREE.MeshBasicMaterial
    trainPassengerMaterial?: THREE.MeshBasicMaterial
    selectionRingGeometry?: THREE.RingGeometry
    selectionRingMaterial?: THREE.MeshBasicMaterial
    unconnectedRingGeometry?: THREE.RingGeometry
    unconnectedRingMaterial?: THREE.MeshBasicMaterial
    distressParticleGeometry?: THREE.CylinderGeometry
    distressParticleMaterial?: THREE.MeshBasicMaterial
  }>({})
  
  // Instanced meshes for passengers
  const instancedMeshesRef = useRef<{
    stationPassengers?: THREE.InstancedMesh
    trainPassengers?: THREE.InstancedMesh
  }>({})
  
  // Performance optimization: reusable matrix objects and material caching
  const matrixRef = useRef(new THREE.Matrix4())
  const distressMaterialCacheRef = useRef<Map<string, THREE.MeshBasicMaterial>>(new Map())
  
  // Initialize the layer once  
  useEffect(() => {
    if (!mapContext?.map) return
    
    const map = mapContext.map
    
    // Clean up existing layer on mobile reinit
    if (map.getLayer('stations-3d')) {
      map.removeLayer('stations-3d')
      console.log('Cleaned up existing Three.js layer for mobile reinit')
    }
    
    // Clean up existing resources on mobile reinit
    if (layerRef.current?.renderer) {
      layerRef.current.renderer.dispose()
      console.log('Cleaned up Three.js renderer for mobile reinit')
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
        
        // Initialize optimized geometries and materials for maximum performance
        // TODO: Migrate to individual factories
        // Use simple cylinders instead of spheres for passengers - much more efficient
        sharedGeometriesRef.current.passengerGeometry = new THREE.CylinderGeometry(
          0.15, // radiusTop
          0.15, // radiusBottom  
          0.3,  // height
          6,    // radialSegments (very low for performance)
          1     // heightSegments
        )
        sharedGeometriesRef.current.trainPassengerGeometry = new THREE.CylinderGeometry(
          0.1,  // radiusTop
          0.1,  // radiusBottom
          0.2,  // height  
          6,    // radialSegments (very low for performance)
          1     // heightSegments
        )
        // Use basic materials for all passengers - no lighting calculations needed
        sharedGeometriesRef.current.passengerMaterial = new THREE.MeshBasicMaterial({ 
          color: 0x555555,
        })
        sharedGeometriesRef.current.trainPassengerMaterial = new THREE.MeshBasicMaterial({ 
          color: 0x333333,
        })
        
        // Initialize selection ring geometry and material
        sharedGeometriesRef.current.selectionRingGeometry = new THREE.RingGeometry(
          2.0, // Inner radius (slightly larger than station)
          2.4, // Outer radius
          32   // Segments for smooth circle
        )
        sharedGeometriesRef.current.selectionRingMaterial = new THREE.MeshBasicMaterial({
          color: 0xffae00,
          side: THREE.DoubleSide
        })
        
        // Initialize unconnected station indicator
        sharedGeometriesRef.current.unconnectedRingGeometry = new THREE.RingGeometry(
          2.5, // Inner radius (larger than selection ring)
          3.0, // Outer radius  
          12   // Reduced segments for performance
        )
        sharedGeometriesRef.current.unconnectedRingMaterial = new THREE.MeshBasicMaterial({
          color: 0x6975dd, // Purple color
          transparent: true,
          opacity: 0.6, // Slightly more subtle
          side: THREE.DoubleSide
        })
        
        // Initialize distress particle effects with optimized geometry
        sharedGeometriesRef.current.distressParticleGeometry = new THREE.CylinderGeometry(
          0.05, // radiusTop
          0.05, // radiusBottom
          0.1,  // height
          4,    // radialSegments (minimal for particles)
          1     // heightSegments
        )
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
  }, [mapContext?.map, mobileReinitKey])

  // Handle resize events - mobile requires complete layer reinitialization
  useEffect(() => {
    if (!mapContext?.map) return

    const map = mapContext.map
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)

    const handleResize = () => {
      console.log('RESIZE detected')
      
      if (isMobile) {
        console.log('Mobile detected - will reinitialize Three.js layer')
        
        // Wait for orientation change to complete, then trigger reinit
        setTimeout(() => {
          console.log('Triggering Three.js layer reinitialization')
          setMobileReinitKey(prev => prev + 1)
        }, 500)
      } else {
        // Desktop: simple renderer resize
        if (layerRef.current?.renderer) {
          const renderer = layerRef.current.renderer
          const canvas = map.getCanvas()
          renderer.setSize(canvas.clientWidth, canvas.clientHeight, false)
          map.triggerRepaint()
        }
      }
    }

    // Listen to resize events
    map.on('resize', handleResize)

    return () => {
      map.off('resize', handleResize)
    }
  }, [mapContext?.map])

  // --- Animation Loop ---
  useEffect(() => {
    const scene = layerRef.current?.scene
    if (!scene) return

    const animate = () => {
      const time = Date.now()

      // Animate only the "tagged" objects
      stationObjects.current.forEach((group, id) => {
        if (group.userData.isAnimating) {
          const stationData = stations.find(s => s.id === id)
          if (stationData) {
            runStationAnimations(group, stationData, time)
          }
        }
      })

      // Schedule the next frame
      animationFrameId.current = requestAnimationFrame(animate)
    }

    animate() // Start the loop

    // Cleanup: Stop the loop on unmount
    return () => {
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current)
      }
    }
  }, [layerRef.current, stations]) // Dependency on `stations` ensures data freshness

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

  // --- Reconciliation Hook ---
  useEffect(() => {
    const scene = layerRef.current?.scene
    if (!scene) return

    // Sync all station objects
    syncObjects(
      stations,
      stationObjects.current,
      scene,
      (station) => {
        const stationObj = createStationObject(station)
        if (!stationObj || !stationObj.object3D) return new THREE.Group() // eslint-disable-line @typescript-eslint/no-explicit-any
        
        const group = stationObj.object3D as THREE.Group
        const mercator = MercatorCoordinate.fromLngLat([stationObj.position.lng, stationObj.position.lat], 0)
        const stationHeight = mercator.meterInMercatorCoordinateUnits() * (stationObj.altitude || 0)
        group.position.set(mercator.x, mercator.y, mercator.z + stationHeight)
        const scale = mercator.meterInMercatorCoordinateUnits() * (stationObj.scale || 1)
        group.scale.setScalar(scale)
        group.userData = { type: 'station', stationId: station.id }
        
        // Ensure all children also have the station userData for raycasting
        group.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.userData = { type: 'station', stationId: station.id }
          }
        })
        
        return group
      },
      (station, group) => updateStationVisuals(
        station, 
        group, 
        selectedStationId || null, 
        routes, 
        sharedGeometriesRef.current, 
        distressMaterialCacheRef.current
      ),
      disposeObject
    )
    
    // Sync all train objects
    syncObjects(
      trains,
      trainObjects.current,
      scene,
      (train) => {
        const route = routes.find(r => r.id === train.routeId)
        const geometry = new THREE.BoxGeometry(2, 2, 1)
        const material = new THREE.MeshPhysicalMaterial({
          color: route?.color || '#ffffff',
          emissive: new THREE.Color(route?.color || '#ffffff').multiplyScalar(0.3),
          roughness: 0.2,
          metalness: 0.0,
          envMapIntensity: 0.7,
          clearcoat: 0.4,
          clearcoatRoughness: 0.03,
          side: THREE.DoubleSide
        })
        const cube = new THREE.Mesh(geometry, material)
        cube.castShadow = true
        cube.receiveShadow = true
        cube.userData = { type: 'train', trainId: train.id }
        return cube
      },
      (train, mesh) => updateTrainVisuals(train, mesh, trainMovementNetwork, routes, sharedGeometriesRef.current),
      disposeObject
    )

    // Handle route rendering (simplified for now - routes don't need complex lifecycle management)
    // Clear existing routes
    const existingRoutes = scene.children.filter((child: THREE.Object3D) => 
      child.userData && (child.userData.type === 'route' || child.userData.type === 'route-simple')
    )
    existingRoutes.forEach((route: THREE.Object3D) => {
      disposeObject(route)
      scene.remove(route)
    })

    // Add new routes
    if (useParallelVisualization && visualRouteNetwork) {
      routes.forEach(route => {
        if (route.stations.length < 2) return
        const visualRoute = visualRouteNetwork.routes.find((r: any) => r.routeId === route.id)
        if (!visualRoute) return

        const finalPoints = visualRoute.renderPoints.map((p: any) => new THREE.Vector3(p.x, p.y, p.z))
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
      routes.forEach(route => {
        if (route.stations.length < 2) return

        const routeStations = route.stations
          .map(stationId => stations.find(s => s.id === stationId))
          .filter(Boolean)
        
        if (routeStations.length < 2) return

        for (let i = 0; i < routeStations.length - 1; i++) {
          const start = routeStations[i]!
          const end = routeStations[i + 1]!
          
          const startMercator = MercatorCoordinate.fromLngLat([start.position.lng, start.position.lat], 0)
          const endMercator = MercatorCoordinate.fromLngLat([end.position.lng, end.position.lat], 0)

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

    // Handle passenger rendering (instanced mesh approach)
    const totalPassengers = stations.reduce((sum: number, station) => sum + (station.passengerCount || 0), 0)
    const maxRenderPassengers = Math.min(totalPassengers, PERFORMANCE_CONFIG.maxRenderedPassengers)

    // Remove existing passenger mesh if needed
    const prevMesh = instancedMeshesRef.current.stationPassengers
    if (prevMesh && (prevMesh.count !== maxRenderPassengers || totalPassengers === 0)) {
      scene.remove(prevMesh)
      prevMesh.dispose()
      instancedMeshesRef.current.stationPassengers = undefined
    }

    // Add new passenger mesh if needed
    if (totalPassengers > 0 && maxRenderPassengers > 0 && !instancedMeshesRef.current.stationPassengers) {
      const geometry = sharedGeometriesRef.current.passengerGeometry!
      const material = sharedGeometriesRef.current.passengerMaterial!
      
      const instancedMesh = new THREE.InstancedMesh(geometry, material, maxRenderPassengers)
      instancedMesh.userData = { type: 'passengers' }
      scene.add(instancedMesh)
      instancedMeshesRef.current.stationPassengers = instancedMesh

      // Position passengers around stations
      const matrix = matrixRef.current
      let instanceIndex = 0
      stations.forEach(station => {
        if (station.passengerCount && station.passengerCount > 0 && instanceIndex < maxRenderPassengers) {
          const mercator = MercatorCoordinate.fromLngLat([station.position.lng, station.position.lat], 0)
          const meterUnit = mercator.meterInMercatorCoordinateUnits()
          const scale = meterUnit * 50
          const ringRadius = 80 * meterUnit
          const passengersToRender = Math.min(
            station.passengerCount,
            maxRenderPassengers - instanceIndex,
            PERFORMANCE_CONFIG.maxPassengersPerStation
          )
          for (let idx = 0; idx < passengersToRender; idx++) {
            const angle = (idx / Math.max(passengersToRender, 8)) * Math.PI * 2
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
      instancedMesh.count = instanceIndex
      instancedMesh.instanceMatrix.needsUpdate = true
    }

  }, [stations, routes, trains, selectedStationId, visualRouteNetwork, useParallelVisualization])

  // Separate effect for train position updates (runs more frequently)
  useEffect(() => {
    if (!trainMovementNetwork) return
    
    // Update train positions without recreating objects
    trainObjects.current.forEach((mesh, trainId) => {
      const train = trains.find(t => t.id === trainId)
      if (train) {
        const trainLngLat = getTrainPositionFromMovementNetwork(trainMovementNetwork, train.routeId, train.position)
        const trainMercator = MercatorCoordinate.fromLngLat([trainLngLat.lng, trainLngLat.lat], 0)
        const scale = trainMercator.meterInMercatorCoordinateUnits() * 30
        
        mesh.position.set(trainMercator.x, trainMercator.y, trainMercator.z)
        mesh.scale.setScalar(scale)
      }
    })
  }, [trainMovementNetwork, trains])
  
  // Cleanup on component unmount
  useEffect(() => {
    return () => {
      // Stop animation loop
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current)
      }

      // Dispose all persistent objects
      stationObjects.current.forEach(obj => disposeObject(obj))
      stationObjects.current.clear()
      routeObjects.current.forEach(obj => disposeObject(obj))
      routeObjects.current.clear()
      trainObjects.current.forEach(obj => disposeObject(obj))
      trainObjects.current.clear()

      // Dispose all shared Three.js resources using factories
      disposeAllSharedThreeResources();
      
      // Performance optimization: dispose cached materials
      distressMaterialCacheRef.current.forEach(material => material.dispose())
      distressMaterialCacheRef.current.clear()
      
      // Remove Three.js layer from map if it exists
      if (mapContext?.map && layerRef.current && mapContext.map.getLayer('stations-3d')) {
        mapContext.map.removeLayer('stations-3d');
      }
    };
  }, [mapContext?.map]);
  
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