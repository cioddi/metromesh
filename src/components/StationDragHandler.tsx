import { useEffect, useRef, useState } from 'react';
import { useMap } from '@mapcomponents/react-maplibre';
import maplibregl from 'maplibre-gl';
import type { LngLat, Route } from '../types';

interface DragState {
  isDragging: boolean;
  startStation: string | null;
  currentPosition: LngLat | null;
  isValidTarget: boolean;
  targetStation: string | null;
  fromRouteEnd?: { routeId: string; isEnd: boolean }; // Track if dragging from route end
}

interface StationDragHandlerProps {
  stations: Array<{ id: string; position: LngLat; color: string }>;
  routes: Route[];
  onCreateRoute: (startStationId: string, endStationId: string) => void;
  onExtendRoute: (routeId: string, stationId: string, atEnd: boolean) => void;
  onMultiRouteConnection?: (
    startStationId: string, 
    endStationId: string, 
    availableRoutes: Route[], 
    screenPosition: { x: number; y: number },
    isExtension?: boolean,
    routeId?: string,
    atEnd?: boolean
  ) => void;
}

function StationDragHandler({ stations, routes, onCreateRoute, onExtendRoute, onMultiRouteConnection }: StationDragHandlerProps) {
  const mapHook = useMap();
  const [dragState, setDragState] = useState<DragState>({
    isDragging: false,
    startStation: null,
    currentPosition: null,
    isValidTarget: false,
    targetStation: null,
    fromRouteEnd: undefined
  });
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mouseMoveTimeoutRef = useRef<number | null>(null);
  const dragStateRef = useRef(dragState);

  // Keep ref in sync with state
  useEffect(() => {
    dragStateRef.current = dragState;
  }, [dragState]);

  useEffect(() => {
    if (!mapHook?.map) return;

    const map = mapHook.map;
    const canvas = map.getCanvas();
    canvasRef.current = canvas;
    

    const handleStart = (clientX: number, clientY: number, event: Event) => {
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      
      // Convert screen coordinates to map coordinates
      const point = map.unproject([x, y]);
      const pointLngLat = { lng: point.lng, lat: point.lat };
      
      // First, check if clicking on a route endpoint
      const routeEnd = findClosestRouteEnd(pointLngLat, routes, stations, 150); // Larger click area
      if (routeEnd) {
        // Disable map dragging during station drag
        map.dragPan.disable();
        
        setDragState({
          isDragging: true,
          startStation: routeEnd.stationId,
          currentPosition: pointLngLat,
          isValidTarget: false,
          targetStation: null,
          fromRouteEnd: { routeId: routeEnd.routeId, isEnd: routeEnd.isEnd }
        });
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      
      // Find closest station within reasonable distance
      const closestStation = findClosestStation(pointLngLat, stations, 150); // Larger click area
      
      if (closestStation) {
        // Disable map dragging during station drag
        map.dragPan.disable();
        
        setDragState({
          isDragging: true,
          startStation: closestStation.id,
          currentPosition: pointLngLat,
          isValidTarget: false,
          targetStation: null,
          fromRouteEnd: undefined
        });
        event.preventDefault();
        event.stopPropagation();
      }
    };

    const handleMouseDown = (e: MouseEvent) => {
      handleStart(e.clientX, e.clientY, e);
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        e.preventDefault(); // Always prevent default to stop map panning
        const touch = e.touches[0];
        handleStart(touch.clientX, touch.clientY, e);
      }
    };

    const updateDragPosition = (pointLngLat: LngLat) => {
      const currentDragState = dragStateRef.current;
      const startStation = stations.find(s => s.id === currentDragState.startStation);
      if (!startStation) return;

      // Find the best target station within range
      const potentialTarget = findClosestStation(pointLngLat, stations, 250); // Even larger search radius for target detection
      
      let targetStation = null;
      let isValidTarget = false;
      let constrainedEnd = pointLngLat;

      if (potentialTarget && potentialTarget.id !== currentDragState.startStation) {
        // If we have a potential target, snap the line to the best 45-degree angle to reach it
        const snappedEnd = snapTo45DegreeConnection(startStation.position, potentialTarget.position);
        constrainedEnd = { lng: snappedEnd.lng, lat: snappedEnd.lat };
        
        // Check if the snapped line actually gets close to the target station
        const distanceToTarget = getDistanceInMeters(constrainedEnd, potentialTarget.position);
        if (distanceToTarget <= 150) { // Larger tolerance for connection
          targetStation = potentialTarget;
          isValidTarget = true;
        }
      } else {
        // No target station, just apply 45-degree constraint to mouse position
        const constrained = constrainTo45Degrees(startStation.position, pointLngLat);
        constrainedEnd = { lng: constrained.lng, lat: constrained.lat };
      }

      setDragState(prev => ({
        ...prev,
        currentPosition: constrainedEnd, // Use constrained position for preview
        isValidTarget,
        targetStation: targetStation?.id || null
      }));
    };

    const handleMove = (clientX: number, clientY: number, event: Event) => {
      if (!dragStateRef.current.isDragging) return;

      event.preventDefault();
      
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      const point = map.unproject([x, y]);
      const pointLngLat = { lng: point.lng, lat: point.lat };
      
      // Clear existing timeout
      if (mouseMoveTimeoutRef.current) {
        clearTimeout(mouseMoveTimeoutRef.current);
      }
      
      // Update immediately for smooth dragging, but throttle the expensive calculations
      updateDragPosition(pointLngLat);
    };

    const handleEnd = () => {
      const currentDragState = dragStateRef.current;
      if (currentDragState.isDragging && currentDragState.isValidTarget && currentDragState.targetStation) {
        if (currentDragState.fromRouteEnd) {
          // Extending a route - check if start station is a terminal for multiple routes
          const startStationRoutes = routes.filter(route => {
            const stations = route.stations;
            return stations.length > 0 && 
                   (stations[0] === currentDragState.startStation || 
                    stations[stations.length - 1] === currentDragState.startStation);
          });

          if (startStationRoutes.length > 1 && onMultiRouteConnection) {
            // Multiple routes at this terminal - show selection popup
            const rect = canvas.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            
            onMultiRouteConnection(
              currentDragState.startStation!,
              currentDragState.targetStation,
              startStationRoutes,
              { x: centerX, y: centerY },
              true, // isExtension
              currentDragState.fromRouteEnd.routeId,
              currentDragState.fromRouteEnd.isEnd
            );
          } else {
            // Single route or no multi-route handler - proceed normally
            onExtendRoute(currentDragState.fromRouteEnd.routeId, currentDragState.targetStation, currentDragState.fromRouteEnd.isEnd);
          }
        } else {
          // Creating new route - check if start station is a terminal for multiple routes
          const startStationRoutes = routes.filter(route => {
            const stations = route.stations;
            return stations.length > 0 && 
                   (stations[0] === currentDragState.startStation || 
                    stations[stations.length - 1] === currentDragState.startStation);
          });

          if (startStationRoutes.length > 0 && onMultiRouteConnection) {
            // Station is terminal of existing routes - show selection popup to extend instead of creating new
            const rect = canvas.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            
            onMultiRouteConnection(
              currentDragState.startStation!,
              currentDragState.targetStation,
              startStationRoutes,
              { x: centerX, y: centerY },
              true // isExtension
            );
          } else {
            // No existing routes at start station - create new route
            onCreateRoute(currentDragState.startStation!, currentDragState.targetStation);
          }
        }
      }

      // Re-enable map dragging
      if (currentDragState.isDragging) {
        map.dragPan.enable();
      }

      setDragState({
        isDragging: false,
        startStation: null,
        currentPosition: null,
        isValidTarget: false,
        targetStation: null,
        fromRouteEnd: undefined
      });
    };

    const handleMouseMove = (e: MouseEvent) => {
      handleMove(e.clientX, e.clientY, e);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (dragStateRef.current.isDragging) {
        e.preventDefault(); // Prevent map panning while dragging
        e.stopPropagation(); // Stop event from reaching map
      }
      if (e.touches.length === 1) {
        const touch = e.touches[0];
        handleMove(touch.clientX, touch.clientY, e);
      }
    };

    const handleMouseUp = () => {
      handleEnd();
    };

    const handleTouchEnd = (e: TouchEvent) => {
      // Only handle if there are no remaining touches
      if (e.touches.length === 0) {
        handleEnd();
      }
    };

    // Add event listeners
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('touchend', handleTouchEnd, { passive: false });

    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [mapHook?.map, stations, routes, onCreateRoute, onExtendRoute, onMultiRouteConnection]);

  // Render drag preview - separate effect with minimal dependencies
  useEffect(() => {
    if (!mapHook?.map) return;

    const map = mapHook.map;
    
    // If not dragging, clean up preview and return
    if (!dragState.isDragging) {
      if (map.getLayer('drag-preview')) {
        map.removeLayer('drag-preview');
      }
      if (map.getSource('drag-preview')) {
        map.removeSource('drag-preview');
      }
      return;
    }
    
    // Update existing preview or create new one

    if (dragState.startStation && dragState.currentPosition) {
      const startStation = stations.find(s => s.id === dragState.startStation);
      if (!startStation) return;

      // Use the already constrained position from mouse move handler
      const constrainedEnd = dragState.currentPosition;

      // Create preview line with metro-style routing
      let coordinates = [[startStation.position.lng, startStation.position.lat]];
      
      // If we have a target station, create the corner route
      const targetStation = dragState.targetStation ? stations.find(s => s.id === dragState.targetStation) : null;
      if (targetStation) {
        const cornerRoute = createMetroRoute(startStation.position, targetStation.position);
        coordinates = cornerRoute;
      } else {
        // No target, just show straight line to mouse position
        coordinates.push([constrainedEnd.lng, constrainedEnd.lat]);
      }

      const lineData = {
        type: 'FeatureCollection' as const,
        features: [{
          type: 'Feature' as const,
          geometry: {
            type: 'LineString' as const,
            coordinates: coordinates
          },
          properties: {}
        }]
      };

      // Update or create the source
      if (map.getSource('drag-preview')) {
        (map.getSource('drag-preview') as unknown as maplibregl.GeoJSONSource).setData(lineData);
      } else {
        map.addSource('drag-preview', {
          type: 'geojson',
          data: lineData
        });
      }

      // Update or create the layer
      if (map.getLayer('drag-preview')) {
        map.setPaintProperty('drag-preview', 'line-color', dragState.isValidTarget ? '#00ff00' : '#888888');
      } else {
        map.addLayer({
          id: 'drag-preview',
          type: 'line',
          source: 'drag-preview',
          layout: {
            'line-join': 'round',
            'line-cap': 'round'
          },
          paint: {
            'line-color': dragState.isValidTarget ? '#00ff00' : '#888888',
            'line-width': 4,
            'line-opacity': 0.9
          }
        });
      }
    }

  }, [mapHook?.map, dragState.isDragging, dragState.startStation, dragState.currentPosition, dragState.isValidTarget, dragState.targetStation, stations]);

  return null;
}

// Helper function to find closest station to a point
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

// Simple distance calculation (rough approximation)
function getDistanceInMeters(pos1: LngLat, pos2: LngLat): number {
  const dlng = pos2.lng - pos1.lng;
  const dlat = pos2.lat - pos1.lat;
  
  // Rough conversion to meters (assuming roughly 111km per degree)
  const dxMeters = dlng * 111000 * Math.cos(pos1.lat * Math.PI / 180);
  const dyMeters = dlat * 111000;
  
  return Math.sqrt(dxMeters * dxMeters + dyMeters * dyMeters);
}

// Helper function to find closest route endpoint to a point
function findClosestRouteEnd(
  point: LngLat,
  routes: Route[],
  stations: Array<{ id: string; position: LngLat; color: string }>,
  maxDistanceMeters: number
): { routeId: string; stationId: string; isEnd: boolean } | null {
  let closestEnd = null;
  let minDistance = Infinity;

  for (const route of routes) {
    if (route.stations.length < 2) continue;

    // Check first station (start of route)
    const firstStationId = route.stations[0];
    const firstStation = stations.find(s => s.id === firstStationId);
    if (firstStation) {
      const distance = getDistanceInMeters(point, firstStation.position);
      if (distance < minDistance && distance <= maxDistanceMeters) {
        minDistance = distance;
        closestEnd = { routeId: route.id, stationId: firstStationId, isEnd: false };
      }
    }

    // Check last station (end of route)
    const lastStationId = route.stations[route.stations.length - 1];
    const lastStation = stations.find(s => s.id === lastStationId);
    if (lastStation && lastStationId !== firstStationId) {
      const distance = getDistanceInMeters(point, lastStation.position);
      if (distance < minDistance && distance <= maxDistanceMeters) {
        minDistance = distance;
        closestEnd = { routeId: route.id, stationId: lastStationId, isEnd: true };
      }
    }
  }

  return closestEnd;
}

// Helper function to constrain a line to 45-degree increments
function constrainTo45Degrees(start: LngLat, end: LngLat): LngLat {
  const dx = end.lng - start.lng;
  const dy = end.lat - start.lat;
  
  // Calculate angle in degrees
  let angle = Math.atan2(dy, dx) * 180 / Math.PI;
  
  // Normalize to 0-360 degrees
  if (angle < 0) angle += 360;
  
  // Round to nearest 45-degree increment
  const constrainedAngle = Math.round(angle / 45) * 45;
  
  // Calculate distance
  const distance = Math.sqrt(dx * dx + dy * dy);
  
  // Apply constrained angle
  const constrainedAngleRad = constrainedAngle * Math.PI / 180;
  
  return {
    lng: start.lng + Math.cos(constrainedAngleRad) * distance,
    lat: start.lat + Math.sin(constrainedAngleRad) * distance
  };
}

// Helper function to create metro-style routing: 45-degree then horizontal/vertical
function snapTo45DegreeConnection(_start: LngLat, target: LngLat): LngLat {
  // This function just returns the target for the distance calculation
  // The actual routing is handled by createMetroRoute
  return { lng: target.lng, lat: target.lat };
}

// Helper function to create a metro-style route with corner points
function createMetroRoute(start: LngLat, target: LngLat): number[][] {
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
  
  // Determine the 45-degree direction (northeast, northwest, southeast, southwest)
  const diagonalDx = dx > 0 ? 1 : -1; // East or West
  const diagonalDy = dy > 0 ? 1 : -1; // North or South
  
  // Go 45 degrees until we align with target on one axis
  // Choose the shorter distance to minimize the diagonal segment
  const diagonalDistance = Math.min(absDx, absDy);
  
  // Calculate the corner point where we transition from diagonal to straight
  const cornerLng = start.lng + diagonalDx * diagonalDistance;
  const cornerLat = start.lat + diagonalDy * diagonalDistance;
  
  // Add the corner point
  coordinates.push([cornerLng, cornerLat]);
  
  // Add the final target point
  coordinates.push([target.lng, target.lat]);
  
  return coordinates;
}

export default StationDragHandler;