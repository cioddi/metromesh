import { useMap } from '@mapcomponents/react-maplibre'
import type { LngLat } from '../types'
import { MAP_CENTER, GAME_CONFIG } from '../config/gameConfig'

export function useMapNavigation() {
  const mapContext = useMap()

  const centerAndZoomToStation = (position: LngLat, zoom: number = 14) => {
    if (!mapContext?.map) {
      console.warn('Map instance not available for navigation')
      return
    }

    mapContext.map.flyTo({
      center: [position.lng, position.lat],
      zoom: zoom,
      duration: 1000, // 1 second animation
      essential: true
    })
  }

  const resetMapToDefault = () => {
    if (!mapContext?.map) {
      console.warn('Map instance not available for navigation')
      return
    }

    mapContext.map.flyTo({
      center: [MAP_CENTER.lng, MAP_CENTER.lat],
      zoom: GAME_CONFIG.initialZoom,
      duration: 1000, // 1 second animation
      essential: true
    })
  }

  return {
    centerAndZoomToStation,
    resetMapToDefault,
    isMapReady: !!mapContext?.map
  }
}