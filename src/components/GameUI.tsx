import { useState } from 'react';
import type { GameState } from '../types';
import { useGameStore } from '../store/gameStore';

interface GameUIProps {
  gameState: GameState;
  onReset: () => void;
  onCreateRoute: (stationIds: string[]) => void;
  onStationSelectFromList?: (stationId: string) => void;
}

const isMobile = () => typeof window !== 'undefined' && window.innerWidth <= 768;

export default function GameUI({ gameState, onStationSelectFromList }: GameUIProps) {
  const [showStations, setShowStations] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const mobile = isMobile();
  const { useParallelVisualization, toggleVisualization } = useGameStore();

  // Helper function to get routes connected to a station
  const getConnectedRoutes = (stationId: string) => {
    return gameState.routes.filter(route => route.stations.includes(stationId));
  };

  if (mobile) {
    return (
      <div className="game-ui-mobile">
        <div className="legend-header">
          <img src="/metromesh/logo.png" alt="MetroMesh" className="logo" />
          <div className="stats">
            <div className="stat-item">
              <span className="stat-value" data-testid="score">{gameState.score}</span>
              <span className="stat-label">Score</span>
            </div>
            <div className="stat-item">
              <span className="stat-value" data-testid="stations-count">{gameState.stations.length}</span>
              <span className="stat-label">Stations</span>
            </div>
            <div className="stat-item">
              <span className="stat-value" data-testid="passengers-count">{gameState.stations.reduce((total, station) => total + (station.passengerCount || 0), 0)}</span>
              <span className="stat-label">Passengers</span>
            </div>
          </div>
        </div>
        <div className="game-ui-mobile-buttons">
          <button onClick={() => setShowStations((s) => !s)}>
            Stations
          </button>
          <button onClick={() => setShowInstructions((s) => !s)}>
            Instructions
          </button>
        </div>
        {showStations && (
          <div className="stations-section mobile">
            <h3 className="section-title">Stations</h3>
            <div className="stations-list">
              {gameState.stations.map(station => (
                <div 
                  key={station.id} 
                  className="station-item clickable"
                  onClick={() => onStationSelectFromList?.(station.id)}
                >
                  <div className="station-info">
                    <span className="station-name">{station.name ? station.name : `Stn ${station.id.slice(-4)}`}</span>
                    <div className="route-indicators">
                      {getConnectedRoutes(station.id).map(route => (
                        <div 
                          key={route.id}
                          className="route-dot" 
                          style={{ backgroundColor: route.color }}
                        ></div>
                      ))}
                    </div>
                    {(station.passengerCount || 0) > 0 && (
                      <div className="passenger-badge">{station.passengerCount}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {showInstructions && (
          <div className="instructions-section mobile">
            <div className="instruction-item">
              <span className="instruction-icon">🚉</span>
              <span>Stations spawn automatically</span>
            </div>
            <div className="instruction-item">
              <span className="instruction-icon">🔗</span>
              <span>Drag between stations to connect</span>
            </div>
            <div className="instruction-item">
              <span className="instruction-icon">👥</span>
              <span>Trains pick up waiting passengers</span>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Desktop: always show station list and instructions
  return (
    <div className="metro-legend">
      <div className="legend-header">
        <img src="/metromesh/logo.png" alt="MetroMesh" className="logo" />
        <div className="stats">
          <div className="stat-item">
            <span className="stat-value" data-testid="score">{gameState.score}</span>
            <span className="stat-label">Score</span>
          </div>
          <div className="stat-item">
            <span className="stat-value" data-testid="stations-count">{gameState.stations.length}</span>
            <span className="stat-label">Stations</span>
          </div>
          <div className="stat-item">
            <span className="stat-value" data-testid="passengers-count">{gameState.stations.reduce((total, station) => total + (station.passengerCount || 0), 0)}</span>
            <span className="stat-label">Passengers</span>
          </div>
        </div>
      </div>
      <div className="stations-section">
        <h3 className="section-title">Stations</h3>
        <div className="stations-list">
          {gameState.stations.map(station => (
            <div 
              key={station.id} 
              className="station-item clickable"
              onClick={() => onStationSelectFromList?.(station.id)}
            >
              <div className="station-info">
                <span className="station-name">{station.name ? station.name : `Stn ${station.id.slice(-4)}`}</span>
                <div className="route-indicators">
                  {getConnectedRoutes(station.id).map(route => (
                    <div 
                      key={route.id}
                      className="route-dot" 
                      style={{ backgroundColor: route.color }}
                    ></div>
                  ))}
                </div>
                {(station.passengerCount || 0) > 0 && (
                  <div className="passenger-badge">{station.passengerCount}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="instructions-section">
        <div className="instruction-item">
          <span className="instruction-icon">🚉</span>
          <span>Stations spawn automatically</span>
        </div>
        <div className="instruction-item">
          <span className="instruction-icon">🔗</span>
          <span>Drag between stations to connect</span>
        </div>
        <div className="instruction-item">
          <span className="instruction-icon">👥</span>
          <span>Trains pick up waiting passengers</span>
        </div>
        <div className="visualization-controls">
          <button onClick={toggleVisualization} className="visualization-toggle">
            {useParallelVisualization ? 'Simple View' : 'Parallel View'}
          </button>
        </div>
      </div>
    </div>
  );
}