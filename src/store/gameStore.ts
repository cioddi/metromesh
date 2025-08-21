import { create } from 'zustand'
import { LngLat } from '../types'
import { generateRandomPosition, TRAIN_CONFIG } from '../config/gameConfig'

interface Station {
  id: string
  position: LngLat
  color: string
  passengerCount: number // Simple count instead of complex array
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
}

interface GameActions {
  addStation: (position?: LngLat) => void
  addRoute: (stationIds: string[], color: string) => void
  extendRoute: (routeId: string, stationId: string, atEnd: boolean) => void
  updateTrainPositions: () => void
  resetGame: () => void
  addPassengerToStation: (stationId: string) => void
}

const STATION_COLORS = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#f9ca24', '#f0932b', '#eb4d4b', '#6c5ce7', '#a29bfe']

export const useGameStore = create<GameState & GameActions>((set, get) => ({
  // Initial state
  stations: [],
  routes: [],
  trains: [],
  score: 0,
  isPlaying: true,
  gameSpeed: 1,

  // Actions
  addStation: (position) => {
    const state = get()
    const stationPosition = position || generateRandomPosition()
    
    const newStation: Station = {
      id: `station-${Date.now()}`,
      position: stationPosition,
      color: STATION_COLORS[state.stations.length % STATION_COLORS.length],
      passengerCount: 0
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

      // Check if train is at a station (within 0.01 units for precision)
      const currentStationIndex = Math.round(train.position)
      const distanceToStation = Math.abs(train.position - currentStationIndex)
      
      if (distanceToStation < 0.01 && currentStationIndex >= 0 && currentStationIndex < route.stations.length) {
        // Train is at a station
        if (newWaitTime <= 0 && currentStationIndex !== train.lastStationVisited) {
          // Just arrived at a NEW station - start waiting and handle passengers
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
            
            // Update station passenger count
            set({
              stations: state.stations.map(s => 
                s.id === stationId 
                  ? { ...s, passengerCount: Math.max(0, s.passengerCount - pickupCount) }
                  : s
              )
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

        // Handle boundaries
        if (newPosition >= route.stations.length - 1) {
          newPosition = route.stations.length - 1
          newDirection = -1
        } else if (newPosition <= 0) {
          newPosition = 0
          newDirection = 1
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
  },

  addPassengerToStation: (stationId) => {
    const state = get()
    
    set({
      stations: state.stations.map(station => 
        station.id === stationId 
          ? { ...station, passengerCount: station.passengerCount + 1 }
          : station
      )
    })
  },

  resetGame: () => {
    set({
      stations: [],
      routes: [],
      trains: [],
      score: 0,
      isPlaying: true,
      gameSpeed: 1
    })
  }
}))