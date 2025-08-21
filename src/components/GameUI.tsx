import type { GameState } from '../types'

interface GameUIProps {
  gameState: GameState
  onReset: () => void
  onCreateRoute: (stationIds: string[]) => void
}

export default function GameUI({ gameState, onReset }: GameUIProps) {

  return (
    <div className="metro-legend">
      {/* Header with logo */}
      <div className="legend-header">
        <img src="/logo.png" alt="MetroMesh" className="logo" />
        <div className="stats">
          <div className="stat-item">
            <span className="stat-value">{gameState.score}</span>
            <span className="stat-label">Score</span>
          </div>
          <div className="stat-item">
            <span className="stat-value">{gameState.stations.length}</span>
            <span className="stat-label">Stations</span>
          </div>
          <div className="stat-item">
            <span className="stat-value">{gameState.stations.reduce((total, station) => total + (station.passengerCount || 0), 0)}</span>
            <span className="stat-label">Passengers</span>
          </div>
        </div>
      </div>

      {/* Routes Legend */}
      {gameState.routes.length > 0 && (
        <div className="routes-section">
          <h3 className="section-title">Lines</h3>
          <div className="routes-list">
            {gameState.routes.map((route, index) => (
              <div key={route.id} className="route-item">
                <div 
                  className="route-line" 
                  style={{ backgroundColor: route.color }}
                ></div>
                <span className="route-name">Line {index + 1}</span>
                <span className="station-count">{route.stations.length} stations</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stations Section */}
      <div className="stations-section">
        <h3 className="section-title">Stations</h3>
        <div className="stations-list">
          {gameState.stations.map(station => (
            <div key={station.id} className="station-item">
              <div className="station-info">
                <div 
                  className="station-dot"
                  style={{ backgroundColor: station.color }}
                ></div>
                <span className="station-name">Stn {station.id.slice(-4)}</span>
                {(station.passengerCount || 0) > 0 && (
                  <div className="passenger-badge">
                    {station.passengerCount}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Instructions */}
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
      </div>

      {/* Reset Button */}
      <button onClick={onReset} className="reset-btn">
        New Game
      </button>
    </div>
  )
}