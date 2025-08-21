import { useEffect } from 'react';
import { useMap } from '@mapcomponents/react-maplibre';
import type { LngLat } from '../types';

interface MapClickHandlerProps {
  onMapClick: (lngLat: LngLat) => void;
}

function MapClickHandler({ onMapClick }: MapClickHandlerProps) {
  const mapHook = useMap();

  useEffect(() => {
    if (mapHook?.map) {
      const handleClick = (e: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        onMapClick({
          lng: e.lngLat.lng,
          lat: e.lngLat.lat,
        });
      };

      mapHook.map?.on('click', handleClick);

      return () => {
        mapHook.map?.off('click', handleClick);
      };
    }
  }, [mapHook?.map, onMapClick]);

  return null;
}

export default MapClickHandler;
