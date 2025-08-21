# MetroMesh

A browser-based single-page application inspired by *Mini Metro*, built with TypeScript, React, MapLibre GL, and Three.js.

## Features

- **Interactive Map**: Place stations by clicking on the map
- **Route Creation**: Connect stations to create colored transit routes
- **Animated Trains**: Trains move smoothly along routes using Three.js animations
- **Passenger Simulation**: Passengers spawn at stations and travel to destinations
- **Real-time Gameplay**: Dynamic passenger generation and train movement

## Tech Stack

- **Frontend**: TypeScript + React
- **Mapping**: `@mapcomponents/react-maplibre` for base map rendering
- **3D Graphics**: Three.js for custom animated layers
- **Build Tool**: Vite
- **Testing**: Jest + React Testing Library
- **CI/CD**: GitHub Actions + GitHub Pages

## Development Setup

### Prerequisites

- Node.js 20+
- npm

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd metromesh

# Install dependencies
npm install

# Start development server
npm run dev
```

### Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint
- `npm test` - Run tests
- `npm run test:watch` - Run tests in watch mode

## How to Play

1. **Place Stations**: Click anywhere on the map to place circular station nodes
2. **Create Routes**: 
   - Select 2 or more stations using the checkboxes in the UI
   - Click "Create Route" to connect them with a colored line
3. **Watch Trains**: Trains automatically spawn and move along routes
4. **Manage Passengers**: Passengers appear at stations and need transport to their destinations

## Architecture

### Core Components

- `Game.tsx` - Main game loop and state management
- `MapComponent.tsx` - MapLibre GL integration with click handling
- `ThreeLayer.tsx` - Three.js rendering layer for animations
- `Station.tsx` - Animated station nodes
- `Route.tsx` - Colored route lines connecting stations
- `Train.tsx` - Moving train animations
- `Passenger.tsx` - Passenger visualization and animations
- `GameUI.tsx` - Game controls and information overlay

### State Management

The game uses React hooks for state management with the `useGameState` hook managing:
- Stations and their positions
- Routes connecting stations
- Train positions and movement
- Passenger spawning and destinations
- Game score and controls

## Deployment

The project is configured for automatic deployment to GitHub Pages via GitHub Actions:

1. Push changes to the `main` branch
2. GitHub Actions runs tests and builds the project
3. Successful builds are automatically deployed to GitHub Pages

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `npm test`
5. Run linter: `npm run lint`
6. Submit a pull request

## License

MIT