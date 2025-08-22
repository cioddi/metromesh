import { useGameStore } from '../store/gameStore';

export default function StationStats() {
  const { selectedStationId, stations, routes, trains } = useGameStore();

  if (!selectedStationId) {
    return (
      <div className="station-stats">
        <p className="station-stats-hint">Click a station to see its details</p>
      </div>
    );
  }

  const selectedStation = stations.find(s => s.id === selectedStationId);
  
  if (!selectedStation) {
    return (
      <div className="station-stats">
        <p className="station-stats-error">Station not found</p>
      </div>
    );
  }

  // Find routes connected to this station
  const connectedRoutes = routes.filter(route => route.stations.includes(selectedStationId));
  
  // Find trains currently at or near this station
  const nearbyTrains = trains.filter(train => {
    const route = routes.find(r => r.id === train.routeId);
    if (!route) return false;
    
    const stationIndex = route.stations.indexOf(selectedStationId);
    if (stationIndex === -1) return false;
    
    // Check if train is close to this station (within 0.2 units)
    const distanceToStation = Math.abs(train.position - stationIndex);
    return distanceToStation < 0.2;
  });

  return (
    <div className="station-stats">
      <div className="station-stats-header">
        <div className="station-dot" style={{ backgroundColor: selectedStation.color }}></div>
        <h3 className="station-stats-title">Station {selectedStation.id.slice(-4)}</h3>
      </div>
      
      <div className="station-stats-content">
        <div className="stat-row">
          <span className="stat-label">Waiting Passengers:</span>
          <span className="stat-value">{selectedStation.passengerCount}</span>
        </div>
        
        <div className="stat-row">
          <span className="stat-label">Connected Routes:</span>
          <span className="stat-value">{connectedRoutes.length}</span>
        </div>
        
        {connectedRoutes.length > 0 && (
          <div className="connected-routes">
            {connectedRoutes.map(route => (
              <div key={route.id} className="route-indicator">
                <div className="route-color-dot" style={{ backgroundColor: route.color }}></div>
              </div>
            ))}
          </div>
        )}
        
        {nearbyTrains.length > 0 && (
          <div className="stat-row">
            <span className="stat-label">Trains Nearby:</span>
            <span className="stat-value">{nearbyTrains.length}</span>
          </div>
        )}
        
        <div className="stat-row">
          <span className="stat-label">Position:</span>
          <span className="stat-value">
            {selectedStation.position.lat.toFixed(4)}, {selectedStation.position.lng.toFixed(4)}
          </span>
        </div>
      </div>
    </div>
  );
}