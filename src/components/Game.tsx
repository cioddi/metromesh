import { useEffect, useRef, useCallback, useState } from "react";
import { useMap } from '@mapcomponents/react-maplibre';
import MapComponent from "./MapComponent";
import GameThreeLayer from "./GameThreeLayer";
import GameUI from "./GameUI";
import StationDragHandler from "./StationDragHandler";
import GameOverScreen from "./GameOverScreen";
import StationStats from "./StationStats";
import RouteSelectionPopup from "./RouteSelectionPopup";
import { useGameStore, ROUTE_COLORS } from "../store/gameStore";
import { useMapNavigation } from "../hooks/useMapNavigation";
import { GAME_CONFIG } from "../config/gameConfig";
import type { LngLat, Route } from "../types";

export default function Game() {
  const {
    stations,
    routes,
    trains,
    score,
    isPlaying,
    selectedStationId,
    isGameOver,
    lastStationSpawnTime,
    addStation,
    addRoute,
    extendRoute,
    updateTrainPositions,
    resetGame,
    addPassengerToStation,
    selectStation,
  } = useGameStore();

  // Route selection popup state
  const [routeSelectionPopup, setRouteSelectionPopup] = useState<{
    isVisible: boolean
    routes: Route[]
    position: { x: number; y: number }
    pendingConnection: {
      startStationId: string
      endStationId: string
      isExtension?: boolean
      routeId?: string
      atEnd?: boolean
    } | null
  }>({
    isVisible: false,
    routes: [],
    position: { x: 0, y: 0 },
    pendingConnection: null
  })

  const { centerAndZoomToStation } = useMapNavigation();
  const mapHook = useMap();
  const initialStationsCreated = useRef(false);

  // Water detection function using MapLibre queryRenderedFeatures
  const isPositionOnWater = useCallback((position: LngLat): boolean => {
    if (!mapHook?.map) return false;
    try {
      const point = mapHook.map.project([position.lng, position.lat]);
      const features = mapHook.map.queryRenderedFeatures([point.x, point.y]);
      // Check if any of the features are water-related
      // Common water layer names: 'water', 'ocean', 'sea', 'lake', 'river', etc.
      for (const feature of features) {
        const layerName = feature.layer?.id?.toLowerCase() || '';
        const sourceLayer = feature.sourceLayer?.toLowerCase() || '';
        const featureType = feature.properties?.class?.toLowerCase() || '';
        const landuse = feature.properties?.landuse?.toLowerCase() || '';
        const natural = feature.properties?.natural?.toLowerCase() || '';
        // Check various water indicators
        if (
          layerName.includes('water') ||
          layerName.includes('ocean') ||
          layerName.includes('sea') ||
          layerName.includes('lake') ||
          layerName.includes('river') ||
          sourceLayer.includes('water') ||
          featureType === 'water' ||
          landuse === 'water' ||
          natural === 'water' ||
          natural === 'bay' ||
          natural === 'strait'
        ) {
          return true;
        }
      }
      return false;
    } catch (error) {
      console.warn('Error checking water features:', error);
      return false; // If there's an error, allow the position
    }
  }, [mapHook?.map]);

  // Transportation density calculation using queryRenderedFeatures
  const getTransportationDensity = useCallback((position: LngLat): number => {
    if (!mapHook?.map) return 0.5;
    try {
      const point = mapHook.map.project([position.lng, position.lat]);
      // Query features in a larger area around the position
      const radius = 50; // pixels
      const bbox: [[number, number], [number, number]] = [
        [point.x - radius, point.y - radius],
        [point.x + radius, point.y + radius]
      ];
      // Query only the relevant highway layers in the bbox
      const highwayLayers = [
        'highway_path',
        'highway_motorway_link',
        'highway_link',
        'highway_minor',
        'highway_major_inner',
        'highway_secondary_tertiary',
        'highway_primary',
        'highway_trunk',
        'highway_motorway'
      ];
      const features = mapHook.map.queryRenderedFeatures(bbox, {
        layers: highwayLayers
      });
      const highwayCount = features.length;
      // Convert highway count to density (0-1 range)
      if (highwayCount === 0) return 0.2; // Rural - no highways
      // Scale highway count to density
      let rawDensity;
      if (highwayCount <= 15) rawDensity = 0.3;
      else if (highwayCount <= 35) rawDensity = 0.5;
      else if (highwayCount <= 65) rawDensity = 0.7;
      else rawDensity = 1.0;
      // Apply final scaling to 0.2-1.0 range
      const finalDensity = 0.2 + rawDensity * 0.8;
      return finalDensity;
    } catch (error) {
      console.warn('Error calculating transportation density:', error);
      return 0.5;
    }
  }, [mapHook?.map]);

  // Reset the initial stations flag when game resets
  useEffect(() => {
    if (stations.length === 0) {
      initialStationsCreated.current = false;
    }
  }, [stations.length]);

  // Add initial stations when game starts - clean and simple approach
  useEffect(() => {
    if (stations.length === 0 && !initialStationsCreated.current && mapHook?.map) {
      initialStationsCreated.current = true;
      const bounds = mapHook.map.getBounds();
      const mapBounds = {
        southwest: {
          lng: bounds.getSouthWest().lng,
          lat: bounds.getSouthWest().lat
        },
        northeast: {
          lng: bounds.getNorthEast().lng,
          lat: bounds.getNorthEast().lat
        }
      };
      
      
      // Create first initial station (no existing stations, so distance check is skipped)
      addStation(mapBounds, undefined, isPositionOnWater, getTransportationDensity, true);
      
      // Create second initial station (will respect distance constraints to first station)
      setTimeout(() => {
        addStation(mapBounds, undefined, isPositionOnWater, getTransportationDensity, true);
      }, 100); // Small delay to ensure first station is added to store first
    }
  }, [stations.length, addStation, mapHook?.map, isPositionOnWater, getTransportationDensity]);

  useEffect(() => {
    if (!isPlaying) return;

    const gameLoop = setInterval(() => {
      updateTrainPositions();

      // Automatically add stations with timing constraints
      const timeSinceLastStationSpawn = Date.now() - lastStationSpawnTime;
      const hasMinDelayPassed = timeSinceLastStationSpawn > GAME_CONFIG.minStationSpawnDelay;
      const shouldForceSpawn = timeSinceLastStationSpawn > GAME_CONFIG.maxStationSpawnDelay;
      const shouldRandomSpawn = Math.random() < GAME_CONFIG.stationSpawnProbability;
      
      if (hasMinDelayPassed && (shouldRandomSpawn || shouldForceSpawn) && stations.length < GAME_CONFIG.maxStations && mapHook?.map) {
        const bounds = mapHook.map.getBounds();
        const gameBounds = {
          southwest: {
            lng: bounds.getSouthWest().lng,
            lat: bounds.getSouthWest().lat
          },
          northeast: {
            lng: bounds.getNorthEast().lng,
            lat: bounds.getNorthEast().lat
          }
        };
        addStation(gameBounds, undefined, isPositionOnWater, getTransportationDensity, false); // No position provided = random placement, avoiding water
      }

      // Spawn passengers based on building density
      if (stations.length > 0) {
        stations.forEach(station => {
          // Base spawn probability modified by building density
          const buildingDensity = station.buildingDensity || 0.5;
          const adjustedSpawnRate = GAME_CONFIG.passengerSpawnProbability * (0.3 + 0.7 * buildingDensity); // 0.3x to 1.0x base rate
          
          if (Math.random() < adjustedSpawnRate) {
            addPassengerToStation(station.id);
          }
        });
      }
    }, GAME_CONFIG.gameLoopInterval);

    return () => clearInterval(gameLoop);
  }, [
    isPlaying,
    updateTrainPositions,
    addStation,
    addPassengerToStation,
    stations,
    lastStationSpawnTime,
    isPositionOnWater,
  getTransportationDensity,
  ]);


  const handleCreateRoute = (stationIds: string[]) => {
    if (stationIds.length >= 2) {
      const color = ROUTE_COLORS[routes.length % ROUTE_COLORS.length];
      addRoute(stationIds, color);
    }
  };

  const handleDragCreateRoute = (startStationId: string, endStationId: string) => {
    // Check if this connection already exists on any route
    const connectionExists = routes.some(route => {
      const stations = route.stations;
      for (let i = 0; i < stations.length - 1; i++) {
        const currentStation = stations[i];
        const nextStation = stations[i + 1];
        // Check both directions
        if ((currentStation === startStationId && nextStation === endStationId) ||
            (currentStation === endStationId && nextStation === startStationId)) {
          return true;
        }
      }
      return false;
    });

    if (connectionExists) {
      return; // Don't create duplicate connection
    }

    const color = ROUTE_COLORS[routes.length % ROUTE_COLORS.length];
    addRoute([startStationId, endStationId], color);
  };

  // Handler for multi-route selection scenarios
  const handleMultiRouteConnection = (
    startStationId: string, 
    endStationId: string, 
    availableRoutes: Route[], 
    screenPosition: { x: number; y: number },
    isExtension?: boolean,
    routeId?: string,
    atEnd?: boolean
  ) => {
    setRouteSelectionPopup({
      isVisible: true,
      routes: availableRoutes,
      position: screenPosition,
      pendingConnection: {
        startStationId,
        endStationId,
        isExtension,
        routeId,
        atEnd
      }
    })
  }

  const handleRouteSelection = (selectedRouteId: string) => {
    const pending = routeSelectionPopup.pendingConnection
    if (!pending) return

    if (pending.isExtension) {
      // Extend the selected route - determine which end based on start station position
      const selectedRoute = routes.find(r => r.id === selectedRouteId)
      if (selectedRoute) {
        const isAtEnd = selectedRoute.stations[selectedRoute.stations.length - 1] === pending.startStationId
        extendRoute(selectedRouteId, pending.endStationId, isAtEnd)
      }
    } else {
      // This case shouldn't happen as we're replacing new route creation logic,
      // but handle it gracefully
      const color = ROUTE_COLORS[routes.length % ROUTE_COLORS.length];
      addRoute([pending.startStationId, pending.endStationId], color);
    }

    // Close popup
    setRouteSelectionPopup({
      isVisible: false,
      routes: [],
      position: { x: 0, y: 0 },
      pendingConnection: null
    })
  }

  const handlePopupCancel = () => {
    setRouteSelectionPopup({
      isVisible: false,
      routes: [],
      position: { x: 0, y: 0 },
      pendingConnection: null
    })
  }

  const handleStationSelectFromList = (stationId: string) => {
    // Select the station
    selectStation(stationId);
    
    // Find the station to get its position
    const station = stations.find(s => s.id === stationId);
    if (station) {
      // Center and zoom to the station
      centerAndZoomToStation(station.position, 14);
    }
  };

  // Prepare game data for Three.js layer
  const gameDataForThreeJs = {
    stations: stations.map((station) => ({
      id: station.id,
      position: station.position,
      color: station.color,
      passengerCount: station.passengerCount,
    })),
    routes,
    trains,
    passengers: [], // Not needed with simple count approach
  };

  return (
    <>
      <MapComponent />
      <GameThreeLayer 
        onStationClick={selectStation} 
        selectedStationId={selectedStationId}
      />
      <StationDragHandler 
        stations={gameDataForThreeJs.stations}
        routes={routes}
        onCreateRoute={handleDragCreateRoute}
        onExtendRoute={extendRoute}
        onMultiRouteConnection={handleMultiRouteConnection}
      />

      <GameUI
        gameState={{ stations, routes, trains, score, isPlaying, gameSpeed: 1 }}
        onReset={resetGame}
        onCreateRoute={handleCreateRoute}
        onStationSelectFromList={handleStationSelectFromList}
      />

      <RouteSelectionPopup
        isVisible={routeSelectionPopup.isVisible}
        routes={routeSelectionPopup.routes}
        position={routeSelectionPopup.position}
        onRouteSelect={handleRouteSelection}
        onCancel={handlePopupCancel}
      />

      <StationStats />
      
      {isGameOver && <GameOverScreen />}
    </>
  );
}
