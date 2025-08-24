import { useState, useEffect, useRef, useLayoutEffect } from 'react';
import citiesData from '../data/cities.json';

interface City {
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

interface CitySearchProps {
  onCitySelect: (city: City) => void;
  currentCity?: City;
  isOpen: boolean;
  onToggle: () => void;
}

export default function CitySearch({ onCitySelect, currentCity, isOpen, onToggle }: CitySearchProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [filteredCities, setFilteredCities] = useState<City[]>([]);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [dropdownPosition, setDropdownPosition] = useState<{top: number, left: number, width: number}>({top: 0, left: 0, width: 0});
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const cities: City[] = citiesData;

  // Filter cities based on search term
  useEffect(() => {
    if (searchTerm.length === 0) {
      setFilteredCities([]);
    } else {
      const filtered = cities.filter(city => 
        city.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        city.country.toLowerCase().includes(searchTerm.toLowerCase())
      );
      setFilteredCities(filtered);
      console.log('Search term:', searchTerm, 'Filtered cities:', filtered); // Debug log
    }
    setHighlightedIndex(-1);
  }, [searchTerm]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex(prev => 
          prev < filteredCities.length - 1 ? prev + 1 : 0
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex(prev => 
          prev > 0 ? prev - 1 : filteredCities.length - 1
        );
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightedIndex >= 0 && filteredCities[highlightedIndex]) {
          handleCitySelect(filteredCities[highlightedIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        onToggle();
        break;
    }
  };

  const handleCitySelect = (city: City) => {
    onCitySelect(city);
    setSearchTerm('');
    onToggle();
  };

  // Calculate dropdown position when showing results
  useLayoutEffect(() => {
    if ((searchTerm || isOpen) && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setDropdownPosition({
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width
      });
    }
  }, [searchTerm, isOpen]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current && 
        !dropdownRef.current.contains(event.target as Node) &&
        containerRef.current &&
        !containerRef.current.contains(event.target as Node) &&
        isOpen
      ) {
        onToggle();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onToggle]);

  return (
    <>
      <div className="city-search-container" ref={containerRef}>
        <div 
          className="city-search-header"
          onTouchStart={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!isOpen) {
              onToggle();
              setTimeout(() => {
                if (inputRef.current) {
                  inputRef.current.focus();
                }
              }, 100);
            }
          }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!isOpen) {
              onToggle();
              setTimeout(() => {
                if (inputRef.current) {
                  inputRef.current.focus();
                }
              }, 100);
            }
          }}
        >
          <span className="city-icon">🌍</span>
          <input
            ref={inputRef}
            type="text"
            className="city-search-input"
            placeholder="Search cities..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={(e) => {
              e.stopPropagation();
              if (!isOpen) onToggle();
            }}
          />
          {searchTerm && (
            <button 
              className="city-search-clear" 
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setSearchTerm('');
              }}
              onTouchStart={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setSearchTerm('');
              }}
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </div>
      </div>
      
      {searchTerm && filteredCities.length > 0 && (
        <div 
          className="city-search-results" 
          ref={dropdownRef}
          style={{
            top: dropdownPosition.top,
            left: dropdownPosition.left,
            width: dropdownPosition.width
          }}
        >
          {filteredCities.map((city, index) => (
            <div
              key={city.id}
              className={`city-result-item ${
                index === highlightedIndex ? 'highlighted' : ''
              } ${currentCity?.id === city.id ? 'current' : ''}`}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleCitySelect(city);
              }}
              onMouseEnter={() => setHighlightedIndex(index)}
              onTouchStart={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onTouchEnd={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleCitySelect(city);
              }}
            >
              <div className="city-result-main">
                <span className="city-result-name">{city.name}</span>
                <span className="city-result-country">{city.country}</span>
              </div>
              {currentCity?.id === city.id && (
                <span className="current-indicator">✓</span>
              )}
            </div>
          ))}
        </div>
      )}
      
      {searchTerm && filteredCities.length === 0 && (
        <div 
          className="city-search-results"
          style={{
            top: dropdownPosition.top,
            left: dropdownPosition.left,
            width: dropdownPosition.width
          }}
        >
          <div className="no-results">No cities found for "{searchTerm}"</div>
        </div>
      )}
    </>
  );
}