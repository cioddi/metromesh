import { useMap } from '@mapcomponents/react-maplibre'
import type { LngLat } from '../types'

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

  return {
    centerAndZoomToStation,
    isMapReady: !!mapContext?.map
  }
}