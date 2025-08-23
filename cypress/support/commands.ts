/// <reference types="cypress" />
// ***********************************************
// This example commands.ts shows you how to
// create various custom commands and overwrite
// existing commands.
//
// For more comprehensive examples of custom
// commands please read more here:
// https://on.cypress.io/custom-commands
// ***********************************************

// Custom commands for MetroMesh game testing
declare global {
  namespace Cypress {
    interface Chainable {
      /**
       * Wait for the map to be fully loaded
       */
      waitForMapLoad(): Chainable<void>
      
      /**
       * Click on a station at given coordinates
       */
      clickStation(lng: number, lat: number): Chainable<void>
      
      /**
       * Drag between two stations to create a route
       */
      dragBetweenStations(fromLng: number, fromLat: number, toLng: number, toLat: number): Chainable<void>
      
      /**
       * Wait for game to have specified number of stations
       */
      waitForStations(count: number): Chainable<void>
      
      /**
       * Toggle visualization mode
       */
      toggleVisualization(): Chainable<void>
    }
  }
}

Cypress.Commands.add('waitForMapLoad', () => {
  // Wait for MapLibre map canvas to be present and visible
  cy.get('.maplibregl-map', { timeout: 10000 }).should('be.visible')
  
  // Wait a bit more for the map to fully initialize
  cy.wait(1000)
})

Cypress.Commands.add('clickStation', (lng: number, lat: number) => {
  // This is a simplified version - in a real implementation you'd need to
  // convert lng/lat to screen coordinates based on the map's current view
  cy.get('.maplibregl-canvas').click()
})

Cypress.Commands.add('dragBetweenStations', (fromLng: number, fromLat: number, toLng: number, toLat: number) => {
  // This would need proper coordinate conversion for the actual implementation
  cy.get('.maplibregl-canvas')
    .trigger('mousedown')
    .trigger('mousemove')
    .trigger('mouseup')
})

Cypress.Commands.add('waitForStations', (count: number) => {
  cy.get('[data-testid="station-count"]', { timeout: 10000 })
    .should('contain', count.toString())
})

Cypress.Commands.add('toggleVisualization', () => {
  // Look for the visualization toggle button
  cy.contains('button', /Simple|Parallel/).click()
})

export {}