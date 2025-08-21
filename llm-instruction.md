# LLM Instructions: @mapcomponents/react-maplibre Integration

## Overview
This guide provides practical knowledge for implementing @mapcomponents/react-maplibre with Three.js integration, based on real implementation experience. The MetroMesh project demonstrates advanced patterns for interactive mapping applications.

## Basic Setup

### Core Dependencies
```json
{
  "@mapcomponents/react-maplibre": "^0.x.x",
  "maplibre-gl": "^4.x.x",
  "three": "^0.1xx.x"
}
```

### Basic Map Component
```tsx
import { MapLibreMap } from '@mapcomponents/react-maplibre';

export default function MapComponent() {
  return (
    <MapLibreMap
      options={{
        zoom: 12,
        style: 'https://wms.wheregroup.com/tileserver/style/osm-bright.json',
        center: [-0.1278, 51.5074], // [lng, lat]
      }}
      mapId="unique_map_id"
    />
  );
}
```

### Map Context Access
```tsx
import { useMap } from '@mapcomponents/react-maplibre';

function MyComponent() {
  const mapHook = useMap();
  const map = mapHook?.map; // Access MapLibre GL map instance
  
  useEffect(() => {
    if (!map) return;
    // Use map instance for advanced operations
  }, [map]);
}
```

## Three.js Integration Patterns

### Custom Layer Architecture
Create reusable Three.js layers that integrate with MapLibre:

```tsx
const customLayer = {
  id: 'my-3d-layer',
  type: 'custom' as const,
  renderingMode: '3d' as const,
  camera: undefined as THREE.Camera | undefined,
  scene: undefined as THREE.Scene | undefined,
  renderer: undefined as THREE.WebGLRenderer | undefined,
  
  onAdd: function(mapInstance: any, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.camera = new THREE.Camera();
    this.scene = new THREE.Scene();
    
    // Setup lighting
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(0, -70, 100).normalize();
    this.scene.add(directionalLight);
    
    const ambientLight = new THREE.AmbientLight(0x404040, 0.4);
    this.scene.add(ambientLight);
    
    // Create renderer sharing MapLibre's canvas
    this.renderer = new THREE.WebGLRenderer({
      canvas: mapInstance.getCanvas(),
      context: gl,
      antialias: true
    });
    this.renderer.autoClear = false;
  },
  
  render: function(_gl: any, matrix: any) {
    if (!this.renderer || !this.scene || !this.camera) return;
    
    // Extract projection matrix
    const m = new THREE.Matrix4().fromArray(
      Array.from(matrix.defaultProjectionData?.mainMatrix || Object.values(matrix) || new Array(16).fill(0)) as number[]
    );
    
    this.camera.projectionMatrix = m;
    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
    map.triggerRepaint();
  }
};
```

### Coordinate Conversion
Critical for placing 3D objects correctly:

```tsx
import { MercatorCoordinate } from 'maplibre-gl';

// Convert LngLat to Mercator coordinates for Three.js positioning
const mercator = MercatorCoordinate.fromLngLat([lng, lat], altitude);
object3D.position.set(mercator.x, mercator.y, mercator.z);

// Scale objects to appear at correct size in meters
const scale = mercator.meterInMercatorCoordinateUnits() * objectSizeInMeters;
object3D.scale.setScalar(scale);
```

### Object Factory Pattern
Create consistent 3D objects:

```tsx
interface ThreeJsObject {
  id: string;
  position: LngLat;
  altitude: number;
  scale: number;
  object3D: THREE.Object3D;
}

export function createStationObject(station: StationData): ThreeJsObject {
  const group = new THREE.Group();
  
  // Base layer (grey transparent)
  const baseGeometry = new THREE.CylinderGeometry(1.3, 1.3, 0.05, 32);
  const baseMaterial = new THREE.MeshBasicMaterial({ 
    color: 0x888888,
    transparent: true,
    opacity: 0.7
  });
  const baseMesh = new THREE.Mesh(baseGeometry, baseMaterial);
  baseMesh.rotation.x = Math.PI / 2;
  baseMesh.position.z = -0.025;
  
  // Top layer (white)
  const geometry = new THREE.CylinderGeometry(1, 1, 0.1, 32);
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = Math.PI / 2;
  
  group.add(baseMesh);
  group.add(mesh);
  
  return {
    id: station.id,
    position: station.position,
    altitude: 0,
    scale: 50,
    object3D: group
  };
}
```

## Interactive Features

### Mouse Event Handling
Implement drag-and-drop interactions:

```tsx
function MouseHandler({ onCreateConnection }) {
  const mapHook = useMap();
  const [dragState, setDragState] = useState({
    isDragging: false,
    startPoint: null,
    currentPosition: null
  });

  useEffect(() => {
    if (!mapHook?.map) return;
    
    const canvas = mapHook.map.getCanvas();
    
    const handleMouseDown = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const point = mapHook.map.unproject([
        e.clientX - rect.left, 
        e.clientY - rect.top
      ]);
      
      // Convert to your coordinate system
      const lngLat = { lng: point.lng, lat: point.lat };
      
      // Find nearby interactive objects
      const nearbyObject = findNearestObject(lngLat, objects, 150); // 150m radius
      
      if (nearbyObject) {
        setDragState({
          isDragging: true,
          startPoint: nearbyObject,
          currentPosition: lngLat
        });
        e.preventDefault();
        e.stopPropagation();
      }
    };
    
    canvas.addEventListener('mousedown', handleMouseDown);
    return () => canvas.removeEventListener('mousedown', handleMouseDown);
  }, [mapHook?.map, objects]);
}
```

### Distance Calculation Helper
```tsx
function getDistanceInMeters(pos1: LngLat, pos2: LngLat): number {
  const dlng = pos2.lng - pos1.lng;
  const dlat = pos2.lat - pos1.lat;
  
  // Rough conversion to meters (assuming roughly 111km per degree)
  const dxMeters = dlng * 111000 * Math.cos(pos1.lat * Math.PI / 180);
  const dyMeters = dlat * 111000;
  
  return Math.sqrt(dxMeters * dxMeters + dyMeters * dyMeters);
}
```

## Dynamic Layer Management

### Adding/Updating GeoJSON Layers
For preview lines and dynamic content:

```tsx
function addOrUpdateLayer(map: MapLibreMap, layerId: string, data: GeoJSON, style: any) {
  // Update existing source or create new one
  if (map.getSource(layerId)) {
    (map.getSource(layerId) as unknown as maplibregl.GeoJSONSource).setData(data);
  } else {
    map.addSource(layerId, {
      type: 'geojson',
      data: data
    });
  }

  // Update layer style or create new layer
  if (map.getLayer(layerId)) {
    Object.entries(style.paint || {}).forEach(([property, value]) => {
      map.setPaintProperty(layerId, property, value);
    });
  } else {
    map.addLayer({
      id: layerId,
      type: 'line',
      source: layerId,
      layout: style.layout || {},
      paint: style.paint || {}
    });
  }
}
```

### Layer Cleanup
```tsx
function removeLayer(map: MapLibreMap, layerId: string) {
  if (map.getLayer(layerId)) {
    map.removeLayer(layerId);
  }
  if (map.getSource(layerId)) {
    map.removeSource(layerId);
  }
}
```

## Performance Optimization

### useEffect Dependencies
Be careful with dependencies to avoid flickering:

```tsx
// Bad - causes frequent re-renders
useEffect(() => {
  // rendering logic
}, [dragState]); // Entire object causes re-renders

// Good - specific dependencies
useEffect(() => {
  // rendering logic
}, [dragState.isDragging, dragState.currentPosition]); // Only specific properties
```

### Material Types
Use appropriate Three.js materials:

```tsx
// Use MeshBasicMaterial for unlit objects (stations, UI elements)
const material = new THREE.MeshBasicMaterial({ color: 0xffffff });

// Use MeshLambertMaterial for objects that should respond to lighting
const material = new THREE.MeshLambertMaterial({ color: 0xff0000 });
```

## Configuration Management

### Centralized Config
```tsx
// config/gameConfig.ts
export const MAP_CONFIG = {
  bounds: {
    southwest: { lng: -0.16785167250222344, lat: 51.494542306198014 },
    northeast: { lng: -0.07911706882524072, lat: 51.53028184893728 }
  },
  center: { lng: -0.1278, lat: 51.5074 },
  zoom: 12,
  clickRadius: 150 // meters
};

export function generateRandomPosition(): LngLat {
  const width = MAP_CONFIG.bounds.northeast.lng - MAP_CONFIG.bounds.southwest.lng;
  const height = MAP_CONFIG.bounds.northeast.lat - MAP_CONFIG.bounds.southwest.lat;
  
  return {
    lng: MAP_CONFIG.bounds.southwest.lng + Math.random() * width,
    lat: MAP_CONFIG.bounds.southwest.lat + Math.random() * height
  };
}
```

## Common Patterns

### App-Level Map Provider
```tsx
// App.tsx
import { MapComponentsProvider } from '@mapcomponents/react-maplibre';

function App() {
  return (
    <MapComponentsProvider>
      <Game />
    </MapComponentsProvider>
  );
}
```

### Scene Updates
Update Three.js scenes efficiently:

```tsx
useEffect(() => {
  if (!scene) return;
  
  // Remove old objects
  const oldObjects = scene.children.filter((child: THREE.Object3D) => 
    child.userData && child.userData.type === 'game-object'
  );
  oldObjects.forEach((obj: THREE.Object3D) => scene.remove(obj));
  
  // Add new objects
  gameObjects.forEach(obj => {
    const object3D = createObject(obj);
    const mercator = MercatorCoordinate.fromLngLat([obj.position.lng, obj.position.lat], 0);
    object3D.position.set(mercator.x, mercator.y, mercator.z);
    object3D.scale.setScalar(mercator.meterInMercatorCoordinateUnits() * obj.scale);
    object3D.userData = { type: 'game-object', id: obj.id };
    scene.add(object3D);
  });
}, [gameObjects]);
```

## TypeScript Considerations

### Type Assertions
```tsx
// Handle MapLibre type conflicts
const pointLngLat: LngLat = { lng: point.lng, lat: point.lat };

// GeoJSON source type casting
(map.getSource(layerId) as unknown as maplibregl.GeoJSONSource).setData(data);
```

### Custom Types
```tsx
interface LngLat {
  lng: number;
  lat: number;
}

interface ThreeJsObject {
  id: string;
  position: LngLat;
  altitude: number;
  scale: number;
  object3D: THREE.Object3D;
}
```

## Debugging Tips

1. **Console Logging**: Add strategic console.log statements for coordinate conversion
2. **Visual Debugging**: Use bright colors for debugging objects
3. **Scale Issues**: Most positioning issues are scale-related - check meterInMercatorCoordinateUnits()
4. **Layer Dependencies**: Flickering usually indicates useEffect dependency issues
5. **Coordinate Systems**: Always convert between map coordinates and Three.js coordinates

## Metro Map Specific Patterns

### 45-Degree Line Constraints
```tsx
function createMetroRoute(start: LngLat, target: LngLat): number[][] {
  const dx = target.lng - start.lng;
  const dy = target.lat - start.lat;
  
  const coordinates: number[][] = [[start.lng, start.lat]];
  
  // Straight line if already aligned
  if (Math.abs(dx) < 0.0001) {
    coordinates.push([start.lng, target.lat]);
    return coordinates;
  }
  if (Math.abs(dy) < 0.0001) {
    coordinates.push([target.lng, start.lat]);
    return coordinates;
  }
  
  // L-shaped route: diagonal then straight
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  const diagonalDistance = Math.min(absDx, absDy);
  
  const cornerLng = start.lng + (dx > 0 ? 1 : -1) * diagonalDistance;
  const cornerLat = start.lat + (dy > 0 ? 1 : -1) * diagonalDistance;
  
  coordinates.push([cornerLng, cornerLat]);
  coordinates.push([target.lng, target.lat]);
  
  return coordinates;
}
```

This guide captures the essential patterns and gotchas discovered during the MetroMesh implementation.