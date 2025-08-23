import { create } from 'zustand'
import type { LngLat } from '../types'
import { generateRandomPosition, TRAIN_CONFIG } from '../config/gameConfig'
import { calculateRouteNetwork, type CachedRouteNetwork } from '../utils/routeNetworkCalculator'

interface Station {
  id: string
  position: LngLat
  color: string
  passengerCount: number // Simple count instead of complex array
  overloadedSince?: number // Timestamp when station first reached 20+ passengers
  buildingDensity?: number // Building count in area (0-1 normalized)
}

interface Route {
  id: string
  color: string
  stations: string[]
}

interface Train {
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

interface GameState {
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
  cachedRouteNetwork: CachedRouteNetwork | null
}

interface GameActions {
  addStation: (position?: LngLat, waterCheckFn?: (position: LngLat) => boolean, buildingDensityFn?: (position: LngLat) => number, isInitialStation?: boolean, bounds?: { southwest: LngLat; northeast: LngLat }) => void
  addRoute: (stationIds: string[], color: string) => void
  extendRoute: (routeId: string, stationId: string, atEnd: boolean) => void
  updateTrainPositions: () => void
  resetGame: () => void
  addPassengerToStation: (stationId: string) => void
  selectStation: (stationId: string | null) => void
  triggerGameOver: (reason: string) => void
  updateRouteNetworkCache: () => void
}

const STATION_COLORS = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#f9ca24', '#f0932b', '#eb4d4b', '#6c5ce7', '#a29bfe']

// More distinguishable route colors with better contrast
export const ROUTE_COLORS = ['#e74c3c', '#2ecc71', '#3498db', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#34495e']

export const useGameStore = create<GameState & GameActions>((set, get) => ({
  // Initial state
  stations: [],
  routes: [],
  trains: [],
  score: 0,
  isPlaying: true,
  gameSpeed: 1,
  selectedStationId: null,
  isGameOver: false,
  gameOverReason: null,
  gameOverStats: null,
  gameStartTime: Date.now(),
  lastStationSpawnTime: Date.now(),
  cachedRouteNetwork: null,

  // Actions
  addStation: (position, waterCheckFn, buildingDensityFn, isInitialStation = false, bounds) => {
    const state = get()
    const stationPosition = position || generateRandomPosition(state.stations, waterCheckFn, isInitialStation, bounds)
    
    // Calculate building density if function provided
    let buildingDensity = 0.5 // Default medium density
    if (buildingDensityFn) {
      try {
        buildingDensity = Math.max(0, Math.min(1, buildingDensityFn(stationPosition)))
      } catch (error) {
        console.warn('Error calculating building density:', error)
      }
    }
    
    const newStation: Station = {
      id: `station-${Date.now()}`,
      position: stationPosition,
      color: STATION_COLORS[state.stations.length % STATION_COLORS.length],
      passengerCount: 0,
      buildingDensity
    }

    set({ 
      stations: [...state.stations, newStation],
      lastStationSpawnTime: Date.now()
    })
  },

  addRoute: (stationIds, color) => {
    const state = get()
    
    const newRoute: Route = {
      id: `route-${Date.now()}`,
      color,
      stations: stationIds
    }

    const newTrain: Train = {
      id: `train-${Date.now()}`,
      routeId: newRoute.id,
      position: 0,
      direction: 1,
      passengerCount: 0,
      capacity: TRAIN_CONFIG.defaultCapacity,
      speedKmh: TRAIN_CONFIG.defaultSpeedKmh,
      waitTime: 0,
      lastStationVisited: -1 // No station visited yet
    }

    set({ 
      routes: [...state.routes, newRoute],
      trains: [...state.trains, newTrain]
    })
    
    // Update route network cache after adding new route
    get().updateRouteNetworkCache()
  },

  extendRoute: (routeId, newStationId, atEnd) => {
    const state = get()
    
    const targetRoute = state.routes.find(r => r.id === routeId)
    if (!targetRoute) return

    // Check if this station is already connected to the endpoint we're extending from
    const endpointStationId = atEnd 
      ? targetRoute.stations[targetRoute.stations.length - 1]
      : targetRoute.stations[0]

    // Check if this connection already exists on the same route
    const connectionExists = targetRoute.stations.some((stationId, index) => {
      if (index === targetRoute.stations.length - 1) return false // Skip last station
      const nextStationId = targetRoute.stations[index + 1]
      return (stationId === endpointStationId && nextStationId === newStationId) ||
             (stationId === newStationId && nextStationId === endpointStationId)
    })

    if (connectionExists) {
      console.log('Connection already exists on this route')
      return // Don't extend with duplicate connection
    }

    set({
      routes: state.routes.map(route => {
        if (route.id !== routeId) return route
        
        const updatedStations = atEnd 
          ? [...route.stations, newStationId]
          : [newStationId, ...route.stations]
        
        return { ...route, stations: updatedStations }
      })
    })
    
    // Update route network cache after extending route
    get().updateRouteNetworkCache()
  },

  updateTrainPositions: () => {
    const state = get()
    if (!state.isPlaying) return

    let newScore = state.score

    const updatedTrains = state.trains.map(train => {
      const route = state.routes.find(r => r.id === train.routeId)
      const cachedNetwork = state.cachedRouteNetwork;
      const cachedRoute = cachedNetwork?.routes.find(r => r.routeId === train.routeId)
      const coordinates = cachedRoute?.coordinates || [];
      if (!route || coordinates.length < 2) return train

      // Calculate movement speed based on actual distance between current coordinates
      const currentCoordIdx = Math.floor(train.position)
      const nextCoordIdx = Math.min(currentCoordIdx + 1, coordinates.length - 1)

      const currentCoord = coordinates[currentCoordIdx]
      const nextCoord = coordinates[nextCoordIdx]

      let speedPerLoop = 0.005 // Default fallback speed
      if (currentCoord && nextCoord && (currentCoord.lng !== nextCoord.lng || currentCoord.lat !== nextCoord.lat)) {
        // Calculate actual distance between these two coordinates (in degrees)
        const deltaLng = nextCoord.lng - currentCoord.lng
        const deltaLat = nextCoord.lat - currentCoord.lat
        const actualDistance = Math.sqrt(deltaLng * deltaLng + deltaLat * deltaLat)
        // Normalize speed: longer distances should take proportionally longer
        const baseSpeedPerSecond = 0.003 // degrees per second (10x faster)
        const baseSpeedPerLoop = baseSpeedPerSecond * 0.1 // 100ms loops
        speedPerLoop = baseSpeedPerLoop / Math.max(0.0001, actualDistance)
      }

      let newPosition = train.position
      let newDirection = train.direction
      let newWaitTime = train.waitTime
      let newPassengerCount = train.passengerCount
      let newLastStationVisited = train.lastStationVisited

      // Check if route is circular (first and last station are the same)
      const isCircularRoute = route.stations.length > 2 && route.stations[0] === route.stations[route.stations.length - 1]

      // Find which coordinates correspond to stations
      const stationCoordIndices = route.stations.map(stationId => coordinates.findIndex(c => c.lng === (state.stations.find(s => s.id === stationId)?.position.lng) && c.lat === (state.stations.find(s => s.id === stationId)?.position.lat)))

      // Check if train is at a station coordinate (within 0.01 units for precision)
      const currentCoordIndex = Math.round(train.position)
      const stationIndexAtCoord = stationCoordIndices.indexOf(currentCoordIndex)
      const distanceToStation = Math.abs(train.position - currentCoordIndex)

      if (distanceToStation < 0.01 && stationIndexAtCoord !== -1) {
        // Train is at a station
        if (newWaitTime <= 0 && currentCoordIndex !== train.lastStationVisited) {
          // Just arrived at a NEW station - handle passengers
          const stationId = route.stations[stationIndexAtCoord]
          // Score points for delivered passengers
          newScore += train.passengerCount * 10
          // All passengers get off
          newPassengerCount = 0
          // Pick up new passengers from station
          const station = state.stations.find(s => s.id === stationId)
          if (station && station.passengerCount > 0) {
            const pickupCount = Math.min(station.passengerCount, train.capacity)
            newPassengerCount = pickupCount
            set({
              stations: state.stations.map(s => {
                if (s.id === stationId) {
                  const newPassengerCount = Math.max(0, s.passengerCount - pickupCount)
                  return {
                    ...s,
                    passengerCount: newPassengerCount,
                    overloadedSince: newPassengerCount < 20 ? undefined : s.overloadedSince
                  }
                }
                return s
              })
            })
          }
          // Start waiting and mark this station as visited
          newWaitTime = 10 // Wait for 1 second
          newLastStationVisited = currentCoordIndex
        } else if (newWaitTime > 0) {
          newWaitTime--
        } else {
          newPosition = train.position + speedPerLoop * train.direction * state.gameSpeed
        }
      } else {
        // Not at a station - move normally and reset wait time
        newPosition = train.position + speedPerLoop * train.direction * state.gameSpeed
        newWaitTime = 0
        // Reset lastStationVisited when train moves away from a station
        if (currentCoordIndex !== train.lastStationVisited) {
          newLastStationVisited = -1
        }
        // Handle boundaries based on route type
        if (isCircularRoute) {
          if (newPosition >= coordinates.length - 1) {
            newPosition = 0
          } else if (newPosition < 0) {
            newPosition = coordinates.length - 2
          }
        } else {
          if (newPosition >= coordinates.length - 1) {
            newPosition = coordinates.length - 1
            newDirection = -1
          } else if (newPosition <= 0) {
            newPosition = 0
            newDirection = 1
          }
        }
      }

      return {
        ...train,
        position: newPosition,
        direction: newDirection,
        passengerCount: newPassengerCount,
        waitTime: newWaitTime,
        lastStationVisited: newLastStationVisited
      }
    })

    set({ 
      trains: updatedTrains,
      score: newScore
    })

    // Check for game over condition: any station with 20+ passengers for 5+ seconds
    const now = Date.now()
    const overloadedStation = state.stations.find(station => 
      station.passengerCount >= 20 && 
      station.overloadedSince && 
      (now - station.overloadedSince) >= 5000 // 5 seconds
    )
    
    if (overloadedStation && state.isPlaying) {
      get().triggerGameOver(`Station ${overloadedStation.id.slice(-4)} was overloaded for too long!`)
    }
  },

  addPassengerToStation: (stationId) => {
    const state = get()
    const now = Date.now()
    
    set({
      stations: state.stations.map(station => {
        if (station.id === stationId) {
          const newCount = station.passengerCount + 1
          const wasOverloaded = station.passengerCount >= 20
          const isNowOverloaded = newCount >= 20
          
          return { 
            ...station, 
            passengerCount: newCount,
            overloadedSince: !wasOverloaded && isNowOverloaded ? now : station.overloadedSince
          }
        }
        return station
      })
    })
  },

  resetGame: () => {
    set({
      stations: [],
      routes: [],
      trains: [],
      score: 0,
      isPlaying: true,
      gameSpeed: 1,
      selectedStationId: null,
      isGameOver: false,
      gameOverReason: null,
      gameOverStats: null,
      gameStartTime: Date.now(),
      lastStationSpawnTime: Date.now(),
      cachedRouteNetwork: null
    })
  },

  selectStation: (stationId) => {
    set({ selectedStationId: stationId })
  },

  triggerGameOver: (reason) => {
    const state = get()
    const gameTime = Math.floor((Date.now() - state.gameStartTime) / 1000) // in seconds
    
    set({
      isPlaying: false,
      isGameOver: true,
      gameOverReason: reason,
      gameOverStats: {
        finalScore: state.score,
        totalStations: state.stations.length,
        totalRoutes: state.routes.length,
        gameTime: gameTime
      }
    })
  },

  updateRouteNetworkCache: () => {
    const state = get()
    
    // Only calculate if we have routes
    if (state.routes.length === 0) {
      set({ cachedRouteNetwork: null })
      return
    }
    
    // Calculate the complete route network with all parallel line visualizations
    try {
      const cachedNetwork = calculateRouteNetwork(state.routes, state.stations)
      set({ cachedRouteNetwork: cachedNetwork })
    } catch (error) {
      console.error('Failed to calculate route network:', error)
      set({ cachedRouteNetwork: null })
    }
  }
}))