import { MapComponentsProvider } from '@mapcomponents/react-maplibre'
import Game from './components/Game'

function App() {
  return (
    <MapComponentsProvider>
      <div className="game-container">
        <Game />
      </div>
    </MapComponentsProvider>
  )
}

export default App