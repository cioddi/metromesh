import { useEffect, useRef } from "react";
import MapComponent from "./MapComponent";
import GameThreeLayer from "./GameThreeLayer";
import GameUI from "./GameUI";
import StationDragHandler from "./StationDragHandler";
import { useGameStore } from "../store/gameStore";
import { GAME_CONFIG, INITIAL_STATIONS } from "../config/gameConfig";

export default function Game() {
  const {
    stations,
    routes,
    trains,
    score,
    isPlaying,
    addStation,
    addRoute,
    extendRoute,
    updateTrainPositions,
    resetGame,
    addPassengerToStation,
  } = useGameStore();

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
    stations.length,
  ]);


  const handleCreateRoute = (stationIds: string[]) => {
    if (stationIds.length >= 2) {
      const colors = ["#ff6b6b", "#4ecdc4", "#45b7d1", "#f9ca24", "#f0932b"];
      const color = colors[routes.length % colors.length];
      addRoute(stationIds, color);
    }
  };

  const handleDragCreateRoute = (startStationId: string, endStationId: string) => {
    const colors = ["#ff6b6b", "#4ecdc4", "#45b7d1", "#f9ca24", "#f0932b"];
    const color = colors[routes.length % colors.length];
    addRoute([startStationId, endStationId], color);
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

  // Debug: Log stations with passengers
  const stationsWithPassengers = gameDataForThreeJs.stations.filter(s => s.passengerCount > 0);
  if (stationsWithPassengers.length > 0) {
    console.log('Stations with passengers:', stationsWithPassengers);
  }

  return (
    <>
      <MapComponent />
      <GameThreeLayer gameData={gameDataForThreeJs} />
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
      />
    </>
  );
}
