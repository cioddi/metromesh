import { useRef, useEffect, useCallback } from 'react'
import { useMap } from '@mapcomponents/react-maplibre'
import * as THREE from 'three'
import { MercatorCoordinate } from 'maplibre-gl'
import type { LngLat } from '../types'

export interface ThreeJsObject {
  id: string
  position: LngLat
  altitude?: number
  rotation?: { x: number; y: number; z: number }
  scale?: number
  object3D: THREE.Object3D
}

export interface MlThreeJsLayerProps {
  mapId?: string
  layerId?: string
  objects?: ThreeJsObject[]
  onObjectClick?: (object: ThreeJsObject, event: MouseEvent) => void
  lighting?: {
    ambient?: { color: number; intensity: number }
    directional?: Array<{
      color: number
      intensity: number
      position: { x: number; y: number; z: number }
    }>
  }
}

const MlThreeJsLayer = ({
  layerId = 'three-js-layer',
  objects = [],
  onObjectClick,
  lighting = {
    ambient: { color: 0x404040, intensity: 0.4 },
    directional: [
      { color: 0xffffff, intensity: 0.6, position: { x: 0, y: -1, z: 1 } },
      { color: 0xffffff, intensity: 0.4, position: { x: 0, y: 1, z: 1 } }
    ]
  }
}: MlThreeJsLayerProps) => {
  const mapContext = useMap()
  const sceneRef = useRef<THREE.Scene | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const cameraRef = useRef<THREE.Camera | null>(null)
  const objectMapRef = useRef<Map<string, THREE.Object3D>>(new Map())

  const lngLatToMercator = useCallback((lngLat: LngLat, altitude: number = 0) => {
    // Use MapLibre's MercatorCoordinate for proper conversion
    const mercator = MercatorCoordinate.fromLngLat([lngLat.lng, lngLat.lat], altitude)
    return { 
      x: mercator.x, 
      y: mercator.y, 
      z: mercator.z,
      meterInMercatorCoordinateUnits: mercator.meterInMercatorCoordinateUnits()
    }
  }, [])

  const cleanup = useCallback(() => {
    if (mapContext?.map && mapContext.map.getLayer(layerId)) {
      mapContext.map.removeLayer(layerId)
    }
    
    // Clean up Three.js objects
    if (sceneRef.current) {
      sceneRef.current.clear()
    }
    if (rendererRef.current) {
      rendererRef.current.dispose()
    }
    
    objectMapRef.current.clear()
  }, [mapContext, layerId])

  // Update objects when the objects prop changes
  useEffect(() => {
    if (!sceneRef.current) return

    const scene = sceneRef.current
    const objectMap = objectMapRef.current

    // Remove objects that are no longer in the objects array
    const currentIds = new Set(objects.map(obj => obj.id))
    for (const [id, object3D] of objectMap.entries()) {
      if (!currentIds.has(id)) {
        scene.remove(object3D)
        objectMap.delete(id)
      }
    }

    // Add or update objects
    objects.forEach(threeObject => {
      const existingObject = objectMap.get(threeObject.id)
      
      if (existingObject) {
        // Update existing object position and scale
        const mercator = lngLatToMercator(threeObject.position, threeObject.altitude || 0)
        existingObject.position.set(mercator.x, mercator.y, mercator.z)
        
        // Apply proper scaling based on mercator units
        const baseScale = threeObject.scale || 1
        const mercatorScale = mercator.meterInMercatorCoordinateUnits * baseScale
        existingObject.scale.setScalar(mercatorScale)
        
        if (threeObject.rotation) {
          existingObject.rotation.set(
            threeObject.rotation.x,
            threeObject.rotation.y,
            threeObject.rotation.z
          )
        }
      } else {
        // Add new object
        const mercator = lngLatToMercator(threeObject.position, threeObject.altitude || 0)
        threeObject.object3D.position.set(mercator.x, mercator.y, mercator.z)
        
        // Apply proper scaling based on mercator units
        const baseScale = threeObject.scale || 1
        const mercatorScale = mercator.meterInMercatorCoordinateUnits * baseScale
        threeObject.object3D.scale.setScalar(mercatorScale)
        
        console.log(`Adding object ${threeObject.id}:`, {
          position: { x: mercator.x, y: mercator.y, z: mercator.z },
          scale: mercatorScale,
          meterInMercatorCoordinateUnits: mercator.meterInMercatorCoordinateUnits
        })
        
        if (threeObject.rotation) {
          threeObject.object3D.rotation.set(
            threeObject.rotation.x,
            threeObject.rotation.y,
            threeObject.rotation.z
          )
        }
        
        // Store reference to the original object for click handling
        threeObject.object3D.userData = { threeJsObject: threeObject }
        
        scene.add(threeObject.object3D)
        objectMap.set(threeObject.id, threeObject.object3D)
      }
    })
  }, [objects, lngLatToMercator])

  useEffect(() => {
    if (!mapContext?.map) return

    const map = mapContext.map
    
    // Don't reinitialize if layer already exists
    if (map.getLayer(layerId)) {
      return
    }

    // Create Three.js scene and camera
    const scene = new THREE.Scene()
    const camera = new THREE.Camera()
    
    sceneRef.current = scene
    cameraRef.current = camera

    // Add lighting to the scene
    if (lighting.ambient) {
      const ambientLight = new THREE.AmbientLight(lighting.ambient.color, lighting.ambient.intensity)
      scene.add(ambientLight)
    }

    if (lighting.directional) {
      lighting.directional.forEach(light => {
        const directionalLight = new THREE.DirectionalLight(light.color, light.intensity)
        directionalLight.position.set(light.position.x, light.position.y, light.position.z).normalize()
        scene.add(directionalLight)
      })
    }

    // Create custom layer
    const customLayer = {
      id: layerId,
      type: 'custom' as const,
      renderingMode: '3d' as const,
      resizeHandler: null as (() => void) | null,
      
      onAdd: function(mapInstance: any, gl: WebGLRenderingContext | WebGL2RenderingContext) { // eslint-disable-line @typescript-eslint/no-explicit-any
        const renderer = new THREE.WebGLRenderer({
          canvas: mapInstance.getCanvas(),
          context: gl,
          antialias: true
        })
        
        renderer.autoClear = false
        rendererRef.current = renderer
        
        // Handle map resize events to keep Three.js viewport synchronized
        const handleResize = () => {
          if (rendererRef.current) {
            const canvas = mapInstance.getCanvas()
            rendererRef.current.setSize(canvas.width, canvas.height, false)
          }
        }
        
        mapInstance.on('resize', handleResize)
        
        // Store cleanup function for resize listener
        this.resizeHandler = () => {
          mapInstance.off('resize', handleResize)
        }
      },
      
      onRemove: function() {
        // Clean up resize handler
        if (this.resizeHandler) {
          this.resizeHandler()
        }
      },
      
      render: function(_gl: WebGLRenderingContext | WebGL2RenderingContext, matrix: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
        if (!rendererRef.current || !sceneRef.current || !cameraRef.current) return
        
        // Follow the original example pattern for matrix handling
        const projectionMatrix = new THREE.Matrix4().fromArray(
          Array.from(matrix.defaultProjectionData?.mainMatrix || Object.values(matrix) || new Array(16).fill(0)) as number[]
        )
        
        // Set up camera with the projection matrix from MapLibre
        cameraRef.current.projectionMatrix = projectionMatrix
        
        // Debug: Log scene info occasionally
        if (Math.random() < 0.01) { // Log 1% of the time to avoid spam
          console.log('Rendering scene with', sceneRef.current.children.length, 'objects')
        }
        
        // Render the scene
        rendererRef.current.resetState()
        rendererRef.current.render(sceneRef.current, cameraRef.current)
        map.triggerRepaint()
      }
    }

    map.addLayer(customLayer)

    return cleanup
  }, [mapContext, layerId, lighting, cleanup])

  // Handle clicks if onObjectClick is provided
  useEffect(() => {
    if (!onObjectClick || !mapContext?.map) return

    const handleClick = (e: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      // This is a simplified click handler
      // In a real implementation, you'd need to implement raycasting
      // to determine which 3D object was clicked
      const clickedObject = objects.find(obj => {
        // Simple distance-based click detection (you'd want proper raycasting)
        const objMercator = lngLatToMercator(obj.position)
        const clickMercator = lngLatToMercator({ lng: e.lngLat.lng, lat: e.lngLat.lat })
        const distance = Math.sqrt(
          Math.pow(objMercator.x - clickMercator.x, 2) + 
          Math.pow(objMercator.y - clickMercator.y, 2)
        )
        return distance < 0.001 // Adjust threshold as needed
      })
      
      if (clickedObject) {
        onObjectClick(clickedObject, e.originalEvent)
      }
    }

    mapContext.map.on('click', handleClick)
    
    return () => {
      mapContext.map?.off('click', handleClick)
    }
  }, [mapContext, objects, onObjectClick, lngLatToMercator])

  useEffect(() => {
    return cleanup
  }, [cleanup])

  return null
}

export default MlThreeJsLayer