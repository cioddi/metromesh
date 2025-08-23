// Master factory file - exports all Three.js object factories
// This separates game element logic from Three.js object generation

// Station factory
export { createStationObject } from './threeStationFactory'

// Passenger factory
export { 
  createPassengerObject,
  createPassengerInstancedMesh,
  disposeSharedPassengerResources
} from './threePassengerFactory'

// Train factory
export { 
  createTrainObject,
  disposeSharedTrainResources
} from './threeTrainFactory'

// Route factory
export { 
  createRouteObject,
  createRouteRingObject,
  type RouteRenderData
} from './threeRouteFactory'

// Particle effects factory
export { 
  createDistressParticleObject,
  createDistressGlowObject,
  createUnconnectedRingObject,
  disposeSharedParticleResources
} from './threeParticleFactory'

// Utility function to dispose all shared resources
export function disposeAllSharedThreeResources() {
  // Factory resource disposal will be implemented when migrating away from GameThreeLayer shared refs
  // For now, this is handled by the existing cleanup in GameThreeLayer
}