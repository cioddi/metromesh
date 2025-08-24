import { MapLibreMap } from "@mapcomponents/react-maplibre";
import { MAP_CENTER, GAME_CONFIG } from "../config/gameConfig";
import mapStyle from "../config/style.json";

export default function MapComponent() {
  return (
    <>
      <MapLibreMap
        options={{
          zoom: GAME_CONFIG.initialZoom,
          // @ts-expect-error: mapStyle version property type mismatch with StyleSpecification
          style: mapStyle,
          center: [MAP_CENTER.lng, MAP_CENTER.lat],
          maxZoom: GAME_CONFIG.maxZoom,
          maxPitch: 0,
          dragRotate: false,
          pitchWithRotate: false
        }}
        mapId="metromesh_map"
      />
    </>
  );
}
