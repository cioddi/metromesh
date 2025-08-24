import { useState } from 'react';
import type { GameState } from '../types';
import { useGameStore } from '../store/gameStore';
import AttributionPopup from './AttributionPopup';
import CitySearch from './CitySearch';
import { getCurrentCity, setCurrentCity, type City } from '../utils/cityStorage';

interface GameUIProps {
  gameState: Pick<GameState, 'score' | 'stations' | 'routes' | 'trains' | 'isPlaying' | 'gameSpeed'>;
  onReset: () => void;
  onCreateRoute: (stationIds: string[]) => void;
  onStationSelectFromList?: (stationId: string) => void;
}

const isMobile = () => typeof window !== 'undefined' && window.innerWidth <= 768;

export default function GameUI({ gameState, onStationSelectFromList }: GameUIProps) {
  const [showStations, setShowStations] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [showAttributions, setShowAttributions] = useState(false);
  const [showCitySearch, setShowCitySearch] = useState(false);
  const [currentCity, setCurrentCityState] = useState<City>(getCurrentCity());
  const mobile = isMobile();
  const { useParallelVisualization, toggleVisualization, changeCity } = useGameStore();

  // Helper function to get routes connected to a station
  const getConnectedRoutes = (stationId: string) => {
    return gameState.routes.filter(route => route.stations.includes(stationId));
  };

  // Handle city selection
  const handleCitySelect = (city: City) => {
    setCurrentCity(city); // Save to localStorage
    setCurrentCityState(city); // Update local state
    changeCity(); // Reset game and reload with new city
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
          <button onClick={() => setShowAttributions(true)}>
            About
          </button>
        </div>
        
        <div className="city-selector-mobile">
          <CitySearch
            onCitySelect={handleCitySelect}
            currentCity={currentCity}
            isOpen={showCitySearch}
            onToggle={() => setShowCitySearch(!showCitySearch)}
          />
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
        <AttributionPopup 
          isOpen={showAttributions} 
          onClose={() => setShowAttributions(false)} 
        />
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
      <div className="city-selector-desktop">
        <CitySearch
          onCitySelect={handleCitySelect}
          currentCity={currentCity}
          isOpen={showCitySearch}
          onToggle={() => setShowCitySearch(!showCitySearch)}
        />
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
          <button style={{display:'none'}} onClick={toggleVisualization} className="visualization-toggle">
            {useParallelVisualization ? 'Simple View' : 'Parallel View'}
          </button>
          <button onClick={() => setShowAttributions(true)} className="attribution-toggle">
            About & Credits
          </button>
        </div>
      </div>
      <AttributionPopup 
        isOpen={showAttributions} 
        onClose={() => setShowAttributions(false)} 
      />
    </div>
  );
}