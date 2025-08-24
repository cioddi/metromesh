import { create } from 'zustand'
import type { LngLat } from '../types'
import { TRAIN_CONFIG } from '../config/gameConfig'
import { generateStationPosition, calculateDistance } from '../utils/stationPositioning'
import { calculateTrainMovementNetwork } from '../utils/routeNetworkCalculator'
import { calculateParallelRouteVisualization, generateVisualRouteNetwork } from '../utils/parallelRouteVisualizer'
import type { Station, Route, Train, GameState } from '../types'



interface GameActions {
  addStation: (bounds: { southwest: LngLat; northeast: LngLat }, position?: LngLat, waterCheckFn?: (position: LngLat) => boolean, transportationDensityFn?: (position: LngLat) => number, isInitialStation?: boolean, name?: string) => void
  addRoute: (stationIds: string[], color: string) => void
  extendRoute: (routeId: string, stationId: string, atEnd: boolean) => void
  updateTrainPositions: () => void
  resetGame: () => void
  addPassengerToStation: (stationId: string) => void
  selectStation: (stationId: string | null) => void
  triggerGameOver: (reason: string) => void
  // Dual caching system actions
  updateTrainMovementNetwork: () => void
  updateVisualRouteNetwork: () => void
  toggleVisualization: () => void
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
  // Dual caching system - completely separate networks
  trainMovementNetwork: null,
  visualRouteNetwork: null,
  // Default to parallel visualization (can be toggled)
  useParallelVisualization: true,

  // Actions
  addStation: (bounds, position, waterCheckFn, transportationDensityFn, isInitialStation = false, name) => {
    const state = get()
    const stationPosition = position || generateStationPosition(state.stations, bounds, waterCheckFn, isInitialStation)
    // Calculate transportation density if function provided
    let buildingDensity = 0.5 // Default medium density (kept property name for compatibility)
    if (transportationDensityFn) {
      try {
        buildingDensity = Math.max(0, Math.min(1, transportationDensityFn(stationPosition)))
      } catch (error) {
        console.warn('Error calculating transportation density:', error)
      }
    }
    const newStation: Station = {
      id: `station-${Date.now()}`,
      position: stationPosition,
      color: STATION_COLORS[state.stations.length % STATION_COLORS.length],
      passengerCount: 0,
      buildingDensity, // Still called buildingDensity in Station for now
      name
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
    
    // Update both networks after adding new route
    get().updateTrainMovementNetwork()
    get().updateVisualRouteNetwork()
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
    
    // Update both networks after extending route
    get().updateTrainMovementNetwork()
    get().updateVisualRouteNetwork()
  },

  updateTrainPositions: () => {
    const state = get()
    if (!state.isPlaying) return

    let newScore = state.score

    const updatedTrains = state.trains.map(train => {
      const route = state.routes.find(r => r.id === train.routeId)
      
      // Use train movement network for position calculations
      const trainMovementNetwork = state.trainMovementNetwork;
      const movementRoute = trainMovementNetwork?.routes.get(train.routeId);
      const coordinates = movementRoute?.routeCoordinates || [];
      
      if (!route || coordinates.length < 2) return train

      // REALISTIC METRO SIMULATION MOVEMENT SYSTEM
      // Use configured train speed for accurate simulation
      const speedKmh = train.speedKmh || TRAIN_CONFIG.defaultSpeedKmh;
      const speedMs = speedKmh / 3.6; // Convert km/h to m/s
      const gameLoopInterval = 100; // milliseconds
      
      const stationPositions = movementRoute?.stationPositions || [];
      if (stationPositions.length < 2) return train; // Need at least 2 stations

      let newPosition = train.position
      let newDirection = train.direction
      let newWaitTime = train.waitTime
      let newPassengerCount = train.passengerCount
      let newLastStationVisited = train.lastStationVisited

      // Check if route is circular (first and last station are the same)
      const isCircularRoute = route.stations.length > 2 && route.stations[0] === route.stations[route.stations.length - 1]
      const maxPosition = stationPositions.length - 1;

      // We'll calculate segment indices as needed below

      // Check if train is very close to a station (within 0.02 units)
      const nearestStationIndex = Math.round(train.position);
      const distanceToNearestStation = Math.abs(train.position - nearestStationIndex);
      const isAtStation = distanceToNearestStation < 0.02;

      // Handle station stops and passenger exchange
      if (isAtStation && nearestStationIndex !== train.lastStationVisited && nearestStationIndex >= 0 && nearestStationIndex < stationPositions.length) {
        if (newWaitTime <= 0) {
          // Just arrived - handle passengers
          const stationId = route.stations[nearestStationIndex]
          newScore += train.passengerCount * 10 // Score for delivered passengers
          newPassengerCount = 0 // All passengers get off
          
          // Pick up new passengers
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
          
          newWaitTime = 10 // Wait for 1 second
          newLastStationVisited = nearestStationIndex
        } else {
          // Still waiting at station
          newWaitTime--
        }
      } else if (newWaitTime > 0) {
        // Continue waiting at station
        newWaitTime--
      } else {
        // Normal movement between stations
        // Only reset lastStationVisited when train is far enough from any station
        // to prevent multiple visits to the same station due to position oscillation
        if (distanceToNearestStation > 0.1) {
          newLastStationVisited = -1; // Reset when sufficiently far from any station
        }
        
        // Calculate movement step based on realistic train speed
        const speedMeterPerLoop = speedMs * (gameLoopInterval / 1000);
        
        // For non-circular routes, calculate average distance between adjacent stations
        let totalRouteDistance = 0;
        for (let i = 0; i < stationPositions.length - 1; i++) {
          totalRouteDistance += calculateDistance(stationPositions[i], stationPositions[i + 1]);
        }
        const avgSegmentDistance = totalRouteDistance / Math.max(1, stationPositions.length - 1);
        
        // Convert speed to position units per loop
        const positionProgressPerLoop = avgSegmentDistance > 0 ? speedMeterPerLoop / avgSegmentDistance : 0.01;
        
        // Apply movement
        newPosition = train.position + positionProgressPerLoop * train.direction * state.gameSpeed;
        
        // Handle route boundaries
        if (isCircularRoute) {
          if (newPosition >= maxPosition) {
            newPosition = 0;
          } else if (newPosition < 0) {
            newPosition = maxPosition - 0.01;
          }
        } else {
          // Non-circular route: reverse direction at endpoints
          if (newPosition >= maxPosition) {
            newPosition = maxPosition;
            newDirection = -1;
          } else if (newPosition <= 0) {
            newPosition = 0;
            newDirection = 1;
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
    const state = get();
    
    // Properly clear complex network data structures before resetting
    if (state.trainMovementNetwork) {
      // Clear Maps in train movement network
      if (state.trainMovementNetwork.routes) {
        state.trainMovementNetwork.routes.clear();
      }
    }
    
    if (state.visualRouteNetwork) {
      // Clear arrays and Maps in visual route network
      if (state.visualRouteNetwork.routes) {
        state.visualRouteNetwork.routes.length = 0;
      }
      if (state.visualRouteNetwork.corridors) {
        state.visualRouteNetwork.corridors.length = 0;
      }
      if (state.visualRouteNetwork.microSegments) {
        state.visualRouteNetwork.microSegments.length = 0;
      }
      if (state.visualRouteNetwork.stationAttachmentPoints) {
        state.visualRouteNetwork.stationAttachmentPoints.clear();
      }
      if (state.visualRouteNetwork.routeAttachmentPoints) {
        state.visualRouteNetwork.routeAttachmentPoints.clear();
      }
    }
    
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
      // Now safely set to null after clearing
      trainMovementNetwork: null,
      visualRouteNetwork: null,
      // Keep visualization preference
      useParallelVisualization: true
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

  updateTrainMovementNetwork: () => {
    const state = get()
    
    // Only calculate if we have routes
    if (state.routes.length === 0) {
      set({ trainMovementNetwork: null })
      return
    }
    
    // Calculate train movement network for accurate physics
    try {
      const trainNetwork = calculateTrainMovementNetwork(state.routes, state.stations)
      set({ trainMovementNetwork: trainNetwork })
    } catch (error) {
      console.error('Failed to calculate train movement network:', error)
      set({ trainMovementNetwork: null })
    }
  },

  updateVisualRouteNetwork: () => {
    const state = get()
    
    // Only calculate if we have routes
    if (state.routes.length === 0) {
      set({ visualRouteNetwork: null })
      return
    }
    
    // Calculate visual route network for rendering
    try {
      const parallelData = calculateParallelRouteVisualization(state.routes, state.stations)
      const visualNetwork = generateVisualRouteNetwork(state.routes, state.stations, parallelData)
      set({ visualRouteNetwork: visualNetwork })
    } catch (error) {
      console.error('Failed to calculate visual route network:', error)
      set({ visualRouteNetwork: null })
    }
  },

  toggleVisualization: () => {
    const state = get()
    set({ useParallelVisualization: !state.useParallelVisualization })
  }
}))