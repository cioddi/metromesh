## Project Overview

MetroMesh is a browser-based single-page application inspired by Mini Metro. Built with TypeScript, React, MapLibre GL, and Three.js, it features an interactive map where players can place stations, create routes, and watch trains transport passengers.

## Development Commands

- `npm run dev` - Start development server (Vite)
- `npm run build` - Build for production (TypeScript + Vite)
- `npm run lint` - Run ESLint
- `npm test` - Run Jest tests
- `npm run test:watch` - Run tests in watch mode
- `npm run preview` - Preview production build

## Architecture

### Core Technology Stack
- **Frontend**: TypeScript + React with functional components and hooks
- **Mapping**: `@mapcomponents/react-maplibre` for base map rendering
- **3D Graphics**: Three.js integrated as custom MapLibre layer for animations
- **Build**: Vite with TypeScript compilation
- **Testing**: Jest + React Testing Library

### Key Components
- `Game.tsx` - Main entry point with game loop and state orchestration
- `MapComponent.tsx` - MapLibre GL wrapper with click interaction handling
- `MlThreeJsLayer.tsx` - Generic, reusable Three.js layer following @mapcomponents pattern
- `threeObjectFactories.ts` - Factory functions for creating game entity 3D objects
- `GameUI.tsx` - React overlay for game controls and information

### State Management
- `useGameState` hook manages all game state (stations, routes, trains, passengers, score)
- Game loop runs at 100ms intervals updating train positions and spawning passengers
- Coordinate conversion utilities handle MapLibre LngLat ↔ Three.js world positions
- `MapComponentsProvider` is placed at App level, making `useMap` hook available throughout the component tree

### Three.js Integration
The project uses a generic, reusable `MlThreeJsLayer` component that:
- Creates a Three.js WebGL renderer overlaid on the map
- Synchronizes Three.js camera with MapLibre projection matrix  
- Renders collections of 3D objects with proper coordinate transformation
- Supports configurable lighting (ambient + directional)
- Uses factory pattern for creating game entity 3D objects
- Follows @mapcomponents/react-maplibre architectural patterns
- Enables efficient batch rendering of all game elements

## Deployment

- GitHub Actions CI/CD pipeline runs on push to main
- Automatic deployment to GitHub Pages
- Base path configured as `/metromesh/` for GitHub Pages hosting