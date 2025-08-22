import { useGameStore } from '../store/gameStore';

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

export default function GameOverScreen() {
  const { gameOverStats, gameOverReason, resetGame } = useGameStore();

  if (!gameOverStats) return null;

  return (
    <div className="game-over-overlay">
      <div className="game-over-screen">
        <div className="game-over-header">
          <img src="/metromesh/logo.png" alt="MetroMesh" className="logo" />
          <h2 className="game-over-title">Game Over</h2>
          <p className="game-over-reason">{gameOverReason}</p>
        </div>
        
        <div className="game-over-stats">
          <h3 className="section-title">Final Statistics</h3>
          
          <div className="stats-grid">
            <div className="stat-item">
              <span className="stat-value">{gameOverStats.finalScore}</span>
              <span className="stat-label">Final Score</span>
            </div>
            
            <div className="stat-item">
              <span className="stat-value">{formatTime(gameOverStats.gameTime)}</span>
              <span className="stat-label">Game Time</span>
            </div>
            
            <div className="stat-item">
              <span className="stat-value">{gameOverStats.totalStations}</span>
              <span className="stat-label">Stations Built</span>
            </div>
            
            <div className="stat-item">
              <span className="stat-value">{gameOverStats.totalRoutes}</span>
              <span className="stat-label">Routes Created</span>
            </div>
          </div>
          
          <div className="game-over-actions">
            <button 
              className="restart-btn"
              onClick={resetGame}
            >
              Start New Game
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}