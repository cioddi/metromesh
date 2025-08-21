export interface Position {
  x: number;
  y: number;
}

export interface LngLat {
  lng: number;
  lat: number;
}

export interface Station {
  id: string;
  position: LngLat;
  color: string;
  passengerCount: number; // Simple count instead of complex array
}

export interface Route {
  id: string;
  color: string;
  stations: string[];
}

export interface Train {
  id: string;
  routeId: string;
  position: number;
  direction: 1 | -1;
  passengerCount: number; // Simple count
  capacity: number;
  speedKmh: number;
  waitTime: number; // Time to wait at station
  lastStationVisited: number; // Index of last station visited
}

export interface Passenger {
  id: string;
  origin: string;
  destination: string;
  spawnTime: number;
  color: string;
}

export interface GameState {
  stations: Station[];
  routes: Route[];
  trains: Train[];
  score: number;
  isPlaying: boolean;
  gameSpeed: number;
}