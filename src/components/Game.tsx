import { useEffect, useRef, useCallback } from "react";
import { useMap } from '@mapcomponents/react-maplibre';
import MapComponent from "./MapComponent";
import GameThreeLayer from "./GameThreeLayer";
import GameUI from "./GameUI";
import StationDragHandler from "./StationDragHandler";
import GameOverScreen from "./GameOverScreen";
import StationStats from "./StationStats";
import { useGameStore, ROUTE_COLORS } from "../store/gameStore";
import { useMapNavigation } from "../hooks/useMapNavigation";
import { GAME_CONFIG } from "../config/gameConfig";
import type { LngLat } from "../types";

export default function Game() {
  const {
    stations,
    routes,
    trains,
    score,
    isPlaying,
    selectedStationId,
    isGameOver,
    addStation,
    addRoute,
    extendRoute,
    updateTrainPositions,
    resetGame,
    addPassengerToStation,
    selectStation,
  } = useGameStore();

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

  // Reset the initial stations flag when game resets
  useEffect(() => {
    if (stations.length === 0) {
      initialStationsCreated.current = false;
    }
  }, [stations.length]);

  // Add initial stations when game starts, ensuring they are inside the current map view
  useEffect(() => {
    if (stations.length === 0 && !initialStationsCreated.current && mapHook?.map) {
      initialStationsCreated.current = true;
      const bounds = mapHook.map.getBounds();
      // Helper to generate a random LngLat at least 100m from left/right/bottom and 500m from the top edge
      const randomPositionInBounds = () => {
        const sw = bounds.getSouthWest();
        const ne = bounds.getNorthEast();
        // Calculate 100m and 500m in degrees (approximate, varies with latitude)
        const metersToDegreesLat100 = 100 / 111320; // 1 deg lat ≈ 111.32km
        const metersToDegreesLat500 = 500 / 111320;
        const centerLat = (sw.lat + ne.lat) / 2;
        const metersToDegreesLng = 100 / (111320 * Math.cos(centerLat * Math.PI / 180));
        return {
          lng: sw.lng + metersToDegreesLng + Math.random() * ((ne.lng - sw.lng) - 2 * metersToDegreesLng),
          lat: sw.lat + metersToDegreesLat100 + Math.random() * ((ne.lat - sw.lat) - metersToDegreesLat100 - metersToDegreesLat500)
        };
      };
      // Add 2 stations inside the current map view, avoiding water
      setTimeout(() => {
        let pos;
        let attempts = 0;
        do {
          pos = randomPositionInBounds();
          attempts++;
        } while (isPositionOnWater(pos) && attempts < 10);
        addStation(pos, isPositionOnWater);
      }, 0);
      setTimeout(() => {
        let pos;
        let attempts = 0;
        do {
          pos = randomPositionInBounds();
          attempts++;
        } while (isPositionOnWater(pos) && attempts < 10);
        addStation(pos, isPositionOnWater);
      }, 1000);
    }
  }, [stations.length, addStation, mapHook?.map, isPositionOnWater]);

  useEffect(() => {
    if (!isPlaying) return;

    const gameLoop = setInterval(() => {
      updateTrainPositions();

      // Automatically add stations
      if (Math.random() < GAME_CONFIG.stationSpawnProbability && stations.length < GAME_CONFIG.maxStations) {
        addStation(undefined, isPositionOnWater); // No position provided = random placement, avoiding water
      }

      // Spawn passengers by adding them to random stations
      if (Math.random() < GAME_CONFIG.passengerSpawnProbability && stations.length > 0) {
        const randomStation = stations[Math.floor(Math.random() * stations.length)];
        addPassengerToStation(randomStation.id);
      }
    }, GAME_CONFIG.gameLoopInterval);

    return () => clearInterval(gameLoop);
  }, [
    isPlaying,
    updateTrainPositions,
    addStation,
    addPassengerToStation,
    stations,
    isPositionOnWater,
  ]);


  const handleCreateRoute = (stationIds: string[]) => {
    if (stationIds.length >= 2) {
      const color = ROUTE_COLORS[routes.length % ROUTE_COLORS.length];
      addRoute(stationIds, color);
    }
  };

  const handleDragCreateRoute = (startStationId: string, endStationId: string) => {
    const color = ROUTE_COLORS[routes.length % ROUTE_COLORS.length];
    addRoute([startStationId, endStationId], color);
  };

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
        gameData={gameDataForThreeJs} 
        onStationClick={selectStation} 
        selectedStationId={selectedStationId}
      />
      <StationDragHandler 
        stations={gameDataForThreeJs.stations}
        routes={routes}
        onCreateRoute={handleDragCreateRoute}
        onExtendRoute={extendRoute}
      />

      <GameUI
        gameState={{ stations, routes, trains, score, isPlaying, gameSpeed: 1 }}
        onReset={resetGame}
        onCreateRoute={handleCreateRoute}
        onStationSelectFromList={handleStationSelectFromList}
      />

      <StationStats />
      
      {isGameOver && <GameOverScreen />}
    </>
  );
}
