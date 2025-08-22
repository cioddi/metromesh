import { useEffect, useRef } from "react";
import MapComponent from "./MapComponent";
import GameThreeLayer from "./GameThreeLayer";
import GameUI from "./GameUI";
import StationDragHandler from "./StationDragHandler";
import GameOverScreen from "./GameOverScreen";
import { useGameStore, ROUTE_COLORS } from "../store/gameStore";
import { useMapNavigation } from "../hooks/useMapNavigation";
import { GAME_CONFIG, INITIAL_STATIONS } from "../config/gameConfig";

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
  const initialStationsCreated = useRef(false);

  // Add initial stations when game starts
  useEffect(() => {
    if (stations.length === 0 && !initialStationsCreated.current) {
      initialStationsCreated.current = true;
      INITIAL_STATIONS.forEach((position, index) => {
        setTimeout(() => addStation(position), index * 1000); // Stagger initial stations
      });
    }
  }, [stations.length, addStation]);

  useEffect(() => {
    if (!isPlaying) return;

    const gameLoop = setInterval(() => {
      updateTrainPositions();

      // Automatically add stations
      if (Math.random() < GAME_CONFIG.stationSpawnProbability && stations.length < GAME_CONFIG.maxStations) {
        addStation(); // No position provided = random placement
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
      
      {isGameOver && <GameOverScreen />}
    </>
  );
}
