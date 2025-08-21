import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'maplibre-gl/dist/maplibre-gl.css'
import './index.css'
import App from './App.tsx'

// Suppress defaultProps warning from @mapcomponents/react-maplibre
const originalError = console.error
console.error = (...args) => {
  if (typeof args[0] === 'string' && args[0].includes('Support for defaultProps will be removed')) {
    return
  }
  originalError(...args)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)