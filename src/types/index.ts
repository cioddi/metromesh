import { type TrainMovementNetwork } from '../utils/routeNetworkCalculator'
import { type VisualRouteNetwork } from '../utils/parallelRouteVisualizer'
export interface Position {
  x: number;
  y: number;
}

export interface LngLat {
  lng: number;
  lat: number;
}

export interface Station {
  id: string
  position: LngLat
  color: string
  passengerCount: number // Simple count instead of complex array
  overloadedSince?: number // Timestamp when station first reached 20+ passengers
  buildingDensity?: number // Building count in area (0-1 normalized)
  name?: string // Optional station name from suburb feature
}


export interface Route {
  id: string
  color: string
  stations: string[]
}

export interface Train {
  id: string
  routeId: string
  position: number
  direction: 1 | -1
  passengerCount: number // Simple count
  capacity: number
  speedKmh: number
  waitTime: number // Time to wait at station (in game loops)
  lastStationVisited: number // Index of last station where passengers were exchanged
}


export interface Passenger {
  id: string;
  origin: string;
  destination: string;
  spawnTime: number;
  color: string;
}

export interface GameState {
  stations: Station[]
  routes: Route[]
  trains: Train[]
  score: number
  isPlaying: boolean
  gameSpeed: number
  selectedStationId: string | null
  isGameOver: boolean
  gameOverReason: string | null
  gameOverStats: {
    finalScore: number
    totalStations: number
    totalRoutes: number
    gameTime: number
  } | null
  gameStartTime: number
  lastStationSpawnTime: number
  // Dual caching system - completely separate networks
  trainMovementNetwork: TrainMovementNetwork | null
  visualRouteNetwork: VisualRouteNetwork | null
  // Visualization toggle
  useParallelVisualization: boolean
}
