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
import { generateStationPosition } from "../utils/stationPositioning";
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
        'highway_motorway_inner',
        'highway_minor',
        'highway_major_inner',
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
    function getFeatureNameFromLayer(position: LngLat, layer: string): string | undefined {
      if (!mapHook?.map) {
        console.log(`[FeatureName] No map instance available for layer ${layer}`);
        return undefined;
      }
      const point = mapHook.map.project([position.lng, position.lat]);
      const radius = 200; // px, increase search area
      const bbox: [[number, number], [number, number]] = [
        [point.x - radius, point.y - radius],
        [point.x + radius, point.y + radius]
      ];
      console.log(`[FeatureName] Projected point:`, point, 'for position', position, 'bbox', bbox, 'layer', layer);
      const features = mapHook.map.queryRenderedFeatures(bbox, { layers: [layer] });
      console.log(`[FeatureName] Features found in ${layer}:`, features);
      if (!features || features.length === 0) {
        console.log(`[FeatureName] No features found in ${layer} at`, position);
        return undefined;
      }
      let minDist = Infinity;
      let closestName = undefined;
      for (const feature of features) {
        const geom = feature.geometry;
        let featureLng = undefined, featureLat = undefined;
        if (geom?.type === 'Point' && Array.isArray(geom.coordinates)) {
          [featureLng, featureLat] = geom.coordinates;
        } else if (geom?.type === 'LineString' && Array.isArray(geom.coordinates) && geom.coordinates.length) {
          // Use midpoint of linestring
          const coords = geom.coordinates;
          const mid = coords[Math.floor(coords.length / 2)];
          featureLng = mid[0];
          featureLat = mid[1];
        } else if (geom?.type === 'Polygon' && Array.isArray(geom.coordinates) && geom.coordinates[0]?.length) {
          // Use centroid of polygon
          const coords = geom.coordinates[0];
          const avg = coords.reduce((acc, c) => [acc[0]+c[0], acc[1]+c[1]], [0,0]);
          featureLng = avg[0]/coords.length;
          featureLat = avg[1]/coords.length;
        }
        // Use 'name' or 'ref' property, whichever is defined
        const featureLabel = feature.properties?.name ?? feature.properties?.ref;
        console.log(feature.properties)
        if (featureLng !== undefined && featureLat !== undefined) {
          const dx = featureLng - position.lng;
          const dy = featureLat - position.lat;
          const dist = dx*dx + dy*dy;
          if (dist < minDist) {
            minDist = dist;
            closestName = featureLabel;
          }
        }
        console.log(`[FeatureName] Feature in ${layer}:`, feature, 'Centroid:', featureLng, featureLat, 'Distance:', minDist, 'Label:', featureLabel);
      }
      console.log(`[FeatureName] Closest label in ${layer}:`, closestName);
      return closestName;
    }

    (async () => {
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

        // Generate and use actual positions for initial stations
        const firstPos = generateStationPosition(
          [], mapBounds, isPositionOnWater, true
        );
        const suburbName = getFeatureNameFromLayer(firstPos, 'place_suburb');
        const highwayName = getFeatureNameFromLayer(firstPos, 'highway_name_other');
        let stationName = undefined;
        if (highwayName) {
          stationName = highwayName + (suburbName ? ` (${suburbName})` : '');
        } else if (suburbName) {
          stationName = suburbName;
        }
        console.log('[StationPlacement] Adding first initial station at', firstPos, 'with name', stationName);
        addStation(mapBounds, firstPos, isPositionOnWater, getTransportationDensity, true, stationName);

        // Create second initial station after a delay
        setTimeout(() => {
          const secondPos = generateStationPosition(
            [ { id: 'station-0', position: firstPos, color: '', passengerCount: 0 } ],
            mapBounds, isPositionOnWater, true
          );
          const suburbName2 = getFeatureNameFromLayer(secondPos, 'place_suburb');
          const highwayName2 = getFeatureNameFromLayer(secondPos, 'highway_name_other');
          let stationName2 = undefined;
          if (highwayName2) {
            stationName2 = highwayName2 + (suburbName2 ? ` (${suburbName2})` : '');
          } else if (suburbName2) {
            stationName2 = suburbName2;
          }
          console.log('[StationPlacement] Adding second initial station at', secondPos, 'with name', stationName2);
          addStation(mapBounds, secondPos, isPositionOnWater, getTransportationDensity, true, stationName2);
        }, 100);
      }
    })();
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
        // Find the position that will be used for the new station
  const newPos: LngLat | undefined = undefined;
        // If addStation is called with undefined, it generates a random position, so we need to replicate that logic here if we want the name
        // For now, we call addStation, then update the name after placement (or refactor addStation to return the position). For simplicity, we query at the random position after placement.
        // But for now, if you want the name at placement, you need to generate the position first. This is a TODO for full accuracy.
        addStation(gameBounds, newPos, isPositionOnWater, getTransportationDensity, false);
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
    mapHook.map
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
