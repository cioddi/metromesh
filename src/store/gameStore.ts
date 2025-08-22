import { create } from 'zustand'
import type { LngLat } from '../types'
import { generateRandomPosition, TRAIN_CONFIG } from '../config/gameConfig'

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
}

interface GameActions {
  addStation: (position?: LngLat, waterCheckFn?: (position: LngLat) => boolean, buildingDensityFn?: (position: LngLat) => number) => void
  addRoute: (stationIds: string[], color: string) => void
  extendRoute: (routeId: string, stationId: string, atEnd: boolean) => void
  updateTrainPositions: () => void
  resetGame: () => void
  addPassengerToStation: (stationId: string) => void
  selectStation: (stationId: string | null) => void
  triggerGameOver: (reason: string) => void
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

  // Actions
  addStation: (position, waterCheckFn, buildingDensityFn) => {
    const state = get()
    const stationPosition = position || generateRandomPosition(state.stations, waterCheckFn)
    
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

    set({ stations: [...state.stations, newStation] })
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
  },

  extendRoute: (routeId, newStationId, atEnd) => {
    const state = get()
    
    set({
      routes: state.routes.map(route => {
        if (route.id !== routeId) return route
        
        const updatedStations = atEnd 
          ? [...route.stations, newStationId]
          : [newStationId, ...route.stations]
        
        return { ...route, stations: updatedStations }
      })
    })
  },

  updateTrainPositions: () => {
    const state = get()
    if (!state.isPlaying) return

    let newScore = state.score

    const updatedTrains = state.trains.map(train => {
      const route = state.routes.find(r => r.id === train.routeId)
      if (!route || route.stations.length < 2) return train

      // Calculate movement speed based on actual distance between current stations
      const currentStationIdx = Math.floor(train.position)
      const nextStationIdx = Math.min(currentStationIdx + 1, route.stations.length - 1)
      
      // Get actual station positions to calculate real distance
      const currentStationId = route.stations[currentStationIdx]
      const nextStationId = route.stations[nextStationIdx]
      const currentStationObj = state.stations.find(s => s.id === currentStationId)
      const nextStationObj = state.stations.find(s => s.id === nextStationId)
      
      let speedPerLoop = 0.005 // Default fallback speed
      
      if (currentStationObj && nextStationObj && currentStationObj.id !== nextStationObj.id) {
        // Calculate actual distance between these two stations (in degrees)
        const deltaLng = nextStationObj.position.lng - currentStationObj.position.lng
        const deltaLat = nextStationObj.position.lat - currentStationObj.position.lat
        const actualDistance = Math.sqrt(deltaLng * deltaLng + deltaLat * deltaLat)
        
        // Normalize speed: longer distances should take proportionally longer
        // Base speed in "degrees per second" 
        const baseSpeedPerSecond = 0.003 // degrees per second (10x faster)
        const baseSpeedPerLoop = baseSpeedPerSecond * 0.1 // 100ms loops
        
        // Calculate position increment based on actual distance
        // We want to move at baseSpeedPerLoop degrees per loop, so:
        speedPerLoop = baseSpeedPerLoop / Math.max(0.0001, actualDistance) // position units per loop
      }
      
      let newPosition = train.position
      let newDirection = train.direction
      let newWaitTime = train.waitTime
      let newPassengerCount = train.passengerCount
      let newLastStationVisited = train.lastStationVisited

      // Check if route is circular (first and last station are the same)
      const isCircularRoute = route.stations.length > 2 && route.stations[0] === route.stations[route.stations.length - 1]
      
      // Check if train is at a station (within 0.01 units for precision)
      const currentStationIndex = Math.round(train.position)
      const distanceToStation = Math.abs(train.position - currentStationIndex)
      
      if (distanceToStation < 0.01 && currentStationIndex >= 0 && currentStationIndex < route.stations.length) {
        // Train is at a station
        if (newWaitTime <= 0 && currentStationIndex !== train.lastStationVisited) {
          // Just arrived at a NEW station - handle passengers
          const stationId = route.stations[currentStationIndex]
          
          // Score points for delivered passengers
          newScore += train.passengerCount * 10
          
          // All passengers get off
          newPassengerCount = 0
          
          // Pick up new passengers from station
          const station = state.stations.find(s => s.id === stationId)
          if (station && station.passengerCount > 0) {
            const pickupCount = Math.min(station.passengerCount, train.capacity)
            newPassengerCount = pickupCount
            
            // Update station passenger count and clear overloaded status if below 20
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
          newLastStationVisited = currentStationIndex
        } else if (newWaitTime > 0) {
          // Currently waiting at station
          newWaitTime--
          // Don't move while waiting
        } else {
          // Finished waiting at this station - can now move
          newPosition = train.position + speedPerLoop * train.direction * state.gameSpeed
        }
      } else {
        // Not at a station - move normally and reset wait time
        newPosition = train.position + speedPerLoop * train.direction * state.gameSpeed
        newWaitTime = 0
        
        // Reset lastStationVisited when train moves away from a station
        // This allows trains to visit the same station again on return trips
        const newStationIndex = Math.round(newPosition)
        if (newStationIndex !== train.lastStationVisited) {
          newLastStationVisited = -1 // Reset when moving between stations
        }

        // Handle boundaries based on route type
        if (isCircularRoute) {
          // Circular route: continue in same direction, wrap around
          if (newPosition >= route.stations.length - 1) {
            newPosition = 0 // Loop back to start
          } else if (newPosition < 0) {
            newPosition = route.stations.length - 2 // Loop back to end (avoiding duplicate last station)
          }
        } else {
          // Linear route: reverse direction at ends
          if (newPosition >= route.stations.length - 1) {
            newPosition = route.stations.length - 1
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
      gameStartTime: Date.now()
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
  }
}))