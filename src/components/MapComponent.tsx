import { MapLibreMap } from '@mapcomponents/react-maplibre'
import { MAP_CENTER, GAME_CONFIG } from '../config/gameConfig'

export default function MapComponent() {
  return (
    <>
      <MapLibreMap
        options={{
          zoom: GAME_CONFIG.initialZoom,
          style: 'https://wms.wheregroup.com/tileserver/style/osm-bright.json',
          center: [MAP_CENTER.lng, MAP_CENTER.lat],
          maxZoom: GAME_CONFIG.maxZoom,
          maxPitch: 0,
        }}
        mapId="metromesh_map"
      />
    </>
  );
}