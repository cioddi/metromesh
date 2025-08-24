import citiesData from '../data/cities.json';

export interface City {
  id: string;
  name: string;
  country: string;
  center: {
    lng: number;
    lat: number;
  };
  bounds: {
    southwest: { lng: number; lat: number };
    northeast: { lng: number; lat: number };
  };
  initialZoom: number;
}

const STORAGE_KEY = 'metromesh-selected-city';
const DEFAULT_CITY_ID = 'london';

/**
 * Get all available cities
 */
export const getCities = (): City[] => {
  return citiesData as City[];
};

/**
 * Get city by ID
 */
export const getCityById = (id: string): City | undefined => {
  return getCities().find(city => city.id === id);
};

/**
 * Get the currently selected city from localStorage
 * Falls back to default city (London) if none selected or invalid ID
 */
export const getCurrentCity = (): City => {
  try {
    const savedCityId = localStorage.getItem(STORAGE_KEY);
    if (savedCityId) {
      const city = getCityById(savedCityId);
      if (city) {
        return city;
      }
    }
  } catch (error) {
    console.warn('Error reading city from localStorage:', error);
  }
  
  // Fallback to default city
  return getCityById(DEFAULT_CITY_ID) || getCities()[0];
};

/**
 * Save the selected city to localStorage
 */
export const setCurrentCity = (city: City): void => {
  try {
    localStorage.setItem(STORAGE_KEY, city.id);
  } catch (error) {
    console.warn('Error saving city to localStorage:', error);
  }
};

/**
 * Get map bounds for a city (compatible with existing game config format)
 */
export const getCityBounds = (city: City) => {
  return {
    southwest: { lng: city.bounds.southwest.lng, lat: city.bounds.southwest.lat },
    northeast: { lng: city.bounds.northeast.lng, lat: city.bounds.northeast.lat }
  };
};

/**
 * Get map center for a city (compatible with existing game config format)  
 */
export const getCityCenter = (city: City) => {
  return {
    lng: city.center.lng,
    lat: city.center.lat
  };
};