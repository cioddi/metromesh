import { useEffect, useRef, useCallback } from 'react';
import { useMap } from '@mapcomponents/react-maplibre';
import { useGameStore } from '../store/gameStore';
import { useMapNavigation } from '../hooks/useMapNavigation';
import type { LngLat } from '../types';

interface IndicatorData {
  stationId: string;
  name?: string;
  position: LngLat;
  type: 'unconnected' | 'distressed';
}

interface IndicatorElement {
  element: HTMLDivElement;
  arrow: HTMLDivElement;
  data: IndicatorData;
}

export default function OffScreenStationIndicators() {
  const { stations, routes, selectStation } = useGameStore();
  const mapHook = useMap();
  const { centerAndZoomToStation } = useMapNavigation();
  
  const containerRef = useRef<HTMLDivElement>(null);
  const indicatorsRef = useRef<Map<string, IndicatorElement>>(new Map());
  const animationFrameRef = useRef<number | null>(null);
  const isUpdatingRef = useRef(false);

  // Create indicator element
  const createIndicator = useCallback((data: IndicatorData): IndicatorElement => {
    const element = document.createElement('div');
    element.className = `off-screen-indicator ${data.type}`;
    element.style.position = 'fixed';
    element.style.zIndex = '9999';
    element.style.cursor = 'pointer';
    element.style.pointerEvents = 'auto';
    element.style.transformOrigin = 'center';
    element.style.transition = 'left 0.2s ease-out, top 0.2s ease-out';
    element.style.opacity = '0';
    
    const arrow = document.createElement('div');
    arrow.className = 'off-screen-arrow';
    element.appendChild(arrow);
    
    element.title = data.name ? 
      `${data.type === 'distressed' ? 'Distressed Station: ' : 'Go to '}${data.name}` : 
      `${data.type === 'distressed' ? 'Distressed Station ' : 'Go to Station '}${data.stationId.slice(-4)}`;
    
    element.addEventListener('click', () => {
      selectStation(data.stationId);
      const station = stations.find(s => s.id === data.stationId);
      if (station) {
        centerAndZoomToStation(station.position, 14);
      }
    });
    
    // Fade in
    requestAnimationFrame(() => {
      element.style.opacity = '1';
    });
    
    return { element, arrow, data };
  }, [selectStation, centerAndZoomToStation, stations]);

  // Update indicator positions
  const updateIndicatorPositions = useCallback(() => {
    if (!mapHook?.map || isUpdatingRef.current) return;
    
    isUpdatingRef.current = true;
    const map = mapHook.map;
    
    // Use actual viewport dimensions for DOM positioning
    const visualWidth = window.innerWidth;
    const visualHeight = window.innerHeight;
    
    const margin = 40;
    const bufferZone = 100;
    
    // Mobile top bar: treat top 120px as "outside" since it's covered by UI
    const mobileTopBarHeight = 120;
    
    // Track which stations should have indicators
    const activeStations = new Map<string, IndicatorData>();
    
    stations.forEach((station) => {
      const isConnected = routes.some(route => route.stations.includes(station.id));
      const isDistressed = station.passengerCount >= 15;
      const shouldShow = !isConnected || isDistressed;
      
      if (!shouldShow) return;
      
      const screenPoint = map.project([station.position.lng, station.position.lat]);
      
      // screenPoint is already in visual coordinates for DOM positioning
      const visualX = screenPoint.x;
      const visualY = screenPoint.y;
      
      const centerX = visualWidth / 2;
      const centerY = visualHeight / 2;
      const dx = visualX - centerX;
      const dy = visualY - centerY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance < 60) return; // Too close to center
      
      const isOutside = (
        visualX < -bufferZone ||
        visualY < mobileTopBarHeight ||  // Stations in top 120px are considered "outside"
        visualX > visualWidth + bufferZone ||
        visualY > visualHeight + bufferZone
      );
      
      // Debug logging for right/bottom detection
      console.log(`Station ${station.id}: screen(${screenPoint.x.toFixed(1)}, ${screenPoint.y.toFixed(1)}), viewport(${visualWidth}, ${visualHeight}), isOutside: ${isOutside}`);
      
      if (isOutside) {
        activeStations.set(station.id, {
          stationId: station.id,
          name: station.name,
          position: station.position,
          type: isDistressed ? 'distressed' : 'unconnected'
        });
      }
    });
    
    // Remove indicators for stations that no longer need them
    const currentIndicators = indicatorsRef.current;
    currentIndicators.forEach((indicator, stationId) => {
      if (!activeStations.has(stationId)) {
        indicator.element.style.opacity = '0';
        setTimeout(() => {
          if (containerRef.current?.contains(indicator.element)) {
            containerRef.current.removeChild(indicator.element);
          }
          currentIndicators.delete(stationId);
        }, 200);
      }
    });
    
    // Add or update indicators
    activeStations.forEach((data, stationId) => {
      let indicator = currentIndicators.get(stationId);
      
      // Create new indicator if needed or type changed
      if (!indicator || indicator.data.type !== data.type) {
        if (indicator) {
          // Remove old indicator
          const oldIndicator = indicator;
          oldIndicator.element.style.opacity = '0';
          setTimeout(() => {
            if (containerRef.current?.contains(oldIndicator.element)) {
              containerRef.current.removeChild(oldIndicator.element);
            }
          }, 200);
        }
        
        indicator = createIndicator(data);
        currentIndicators.set(stationId, indicator);
        if (containerRef.current) {
          containerRef.current.appendChild(indicator.element);
        }
      }
      
      // Update position
      const station = stations.find(s => s.id === stationId);
      if (!station) return;
      
      const screenPoint = map.project([station.position.lng, station.position.lat]);
      
      // screenPoint is already in visual coordinates for DOM positioning
      const visualX = screenPoint.x;
      const visualY = screenPoint.y;
      
      const centerX = visualWidth / 2;
      const centerY = visualHeight / 2;
      const dx = visualX - centerX;
      const dy = visualY - centerY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance === 0) return;
      
      // Mobile top bar considerations - use same value as detection
      const effectiveTopMargin = Math.max(margin, mobileTopBarHeight);
      
      // Dead simple approach: clamp visual position to screen boundaries
      let edgeX = visualX;
      let edgeY = visualY;
      
      // Clamp X coordinate to visual screen edges
      if (visualX < margin) {
        edgeX = margin;
      } else if (visualX > visualWidth - margin) {
        edgeX = visualWidth - margin;
      }
      
      // Clamp Y coordinate to visual screen edges (accounting for mobile top bar)
      if (visualY < effectiveTopMargin) {
        edgeY = effectiveTopMargin;
      } else if (visualY > visualHeight - margin) {
        edgeY = visualHeight - margin;
      }
      
      const angle = Math.atan2(dy, dx) * 180 / Math.PI;
      
      // Update DOM directly for smooth movement
      indicator.element.style.left = `${edgeX}px`;
      indicator.element.style.top = `${edgeY}px`;
      indicator.element.style.transform = `translate(-50%, -50%)`;
      indicator.element.style.setProperty('--arrow-angle', `${angle + 90}deg`);
    });
    
    isUpdatingRef.current = false;
  }, [mapHook?.map, stations, routes, createIndicator]);

  // Throttled update handler
  const handleUpdate = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    animationFrameRef.current = requestAnimationFrame(updateIndicatorPositions);
  }, [updateIndicatorPositions]);

  // Setup map event listeners
  useEffect(() => {
    if (!mapHook?.map) return;
    
    const map = mapHook.map;
    
    map.on('move', handleUpdate);
    map.on('zoom', handleUpdate);
    map.on('resize', handleUpdate);
    
    // Initial update
    handleUpdate();
    
    return () => {
      map.off('move', handleUpdate);
      map.off('zoom', handleUpdate);
      map.off('resize', handleUpdate);
      
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [mapHook?.map, handleUpdate]);

  // Update when game state changes
  useEffect(() => {
    handleUpdate();
  }, [stations, routes, handleUpdate]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      indicatorsRef.current.forEach(indicator => {
        if (containerRef.current?.contains(indicator.element)) {
          containerRef.current.removeChild(indicator.element);
        }
      });
      indicatorsRef.current.clear();
    };
  }, []);

  return <div ref={containerRef} style={{ pointerEvents: 'none' }} />;
}