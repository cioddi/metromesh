import { useEffect, useRef } from 'react'
import { useMap } from '@mapcomponents/react-maplibre'
import * as THREE from 'three'
import { MercatorCoordinate } from 'maplibre-gl'
import type { LngLat, Route, Train, Passenger } from '../types'
import { createStationObject } from '../utils/threeObjectFactories'

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
}

const GameThreeLayer = ({ gameData }: GameThreeLayerProps) => {
  const mapContext = useMap()
  const layerRef = useRef<any>(null) // eslint-disable-line @typescript-eslint/no-explicit-any
  
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

  // Update game objects in the Three.js scene
  useEffect(() => {
    const renderGameObjects = () => {
      if (!layerRef.current?.scene || !layerRef.current?.renderer) {
        setTimeout(renderGameObjects, 100)
        return
      }
      
      const scene = layerRef.current.scene
    
    // Clear existing game objects
    const gameObjects = scene.children.filter((child: THREE.Object3D) => 
      child.userData && ['station', 'route', 'train', 'passenger'].includes(child.userData.type)
    )
    gameObjects.forEach((obj: THREE.Object3D) => scene.remove(obj))
    
    // Add stations using the factory (geometry/material logic centralized)
    gameData.stations.forEach(station => {
      const stationObj = createStationObject(station)
      if (!stationObj || !stationObj.object3D) return
      
      // Find routes connected to this station
      const connectedRoutes = gameData.routes.filter(route => route.stations.includes(station.id))
      
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
      
      // Add passenger indicators as dark grey dots above the train
      if (train.passengerCount > 0) {
        for (let passengerIndex = 0; passengerIndex < train.passengerCount; passengerIndex++) {
          const dotGeometry = new THREE.SphereGeometry(0.2, 8, 8) // Slightly larger grey dot
          const dotMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x333333, // Dark grey instead of black
            roughness: 0.4, // Slightly rougher plastic
            metalness: 0.0, // Non-metallic
            envMapIntensity: 0.3, // Subtle reflections
            side: THREE.DoubleSide // Render both sides
          })
          const dot = new THREE.Mesh(dotGeometry, dotMaterial)
          dot.castShadow = true
          
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
      }
      
      cube.position.set(x, y, z)
      
      const scale = trainMercator.meterInMercatorCoordinateUnits() * 30
      cube.scale.setScalar(scale)
      
      cube.userData = { type: 'train', trainId: train.id }
      scene.add(cube)
    })
    
    // Add passengers around stations as simple dark dots
    gameData.stations.forEach(station => {
      if (station.passengerCount && station.passengerCount > 0) {
        for (let idx = 0; idx < station.passengerCount; idx++) {
          
          const dotGeometry = new THREE.SphereGeometry(0.3, 8, 8) // Smaller passenger dots
          const dotMaterial = new THREE.MeshBasicMaterial({ 
            color: 0x555555, // Grey color for waiting passengers
            side: THREE.DoubleSide
          })
          const dot = new THREE.Mesh(dotGeometry, dotMaterial)
          
          // Place passengers in a small ring just outside the station disk
          const angle = (idx / station.passengerCount) * Math.PI * 2
          const mercator = MercatorCoordinate.fromLngLat([station.position.lng, station.position.lat], 0)
          const meterUnit = mercator.meterInMercatorCoordinateUnits()
          const ringRadius = 80 // Smaller radius around stations
          const offsetX = Math.cos(angle) * ringRadius * meterUnit
          const offsetY = Math.sin(angle) * ringRadius * meterUnit
          
          dot.position.set(
            mercator.x + offsetX,
            mercator.y + offsetY,
            mercator.z + meterUnit * 5 // Higher above ground for visibility
          )
          const scale = meterUnit * 50 // Use same scale as stations
          dot.scale.setScalar(scale)
          dot.userData = { type: 'passenger', stationId: station.id }
          scene.add(dot)
        }
      }
    })
    }
    
    renderGameObjects()
  }, [gameData])
  
  return null
}

export default GameThreeLayer