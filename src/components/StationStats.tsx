import { useGameStore } from '../store/gameStore';

export default function StationStats() {
  const { selectedStationId, stations, routes, selectStation } = useGameStore();

  if (!selectedStationId) {
    return null; // Don't render anything when no station is selected
  }

  const selectedStation = stations.find(s => s.id === selectedStationId);
  
  if (!selectedStation) {
    return null;
  }

  // Find routes connected to this station
  const connectedRoutes = routes.filter(route => route.stations.includes(selectedStationId));

  return (
    <div className="selected-station-info">
      <div className="selected-station-header">
        <span className="section-title">Stn {selectedStation.id.slice(-4)}</span>
        <button 
          className="deselect-btn"
          onClick={() => selectStation(null)}
          aria-label="Close station details"
        >
          ×
        </button>
      </div>
      
      <div className="selected-station-content">
        <div className="station-info-row">
          <span className="station-name">Waiting Passengers</span>
          {selectedStation.passengerCount > 0 && (
            <div className="passenger-badge">{selectedStation.passengerCount}</div>
          )}
        </div>
        
        <div className="station-info-row">
          <span className="station-name">Connected Routes</span>
          <div className="route-indicators">
            {connectedRoutes.map(route => (
              <div 
                key={route.id}
                className="route-dot" 
                style={{ backgroundColor: route.color }}
              ></div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}