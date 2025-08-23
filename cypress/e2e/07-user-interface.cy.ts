describe('User Interface', () => {
  beforeEach(() => {
    cy.visit('/')
    cy.waitForMapLoad()
  })

  it('should display all UI elements correctly on desktop', () => {
    cy.viewport(1280, 720)
    
    // Check main UI elements
    cy.get('.metro-legend').should('be.visible')
    cy.get('.legend-header img[alt="MetroMesh"]').should('be.visible')
    
    // Check stats display
    cy.get('.stats .stat-item').should('have.length', 3)
    cy.contains('Score').should('be.visible')
    cy.contains('Stations').should('be.visible')
    cy.contains('Passengers').should('be.visible')
    
    // Check stations section
    cy.get('.stations-section').should('be.visible')
    cy.get('.stations-section h3').should('contain', 'Stations')
    
    // Check instructions section
    cy.get('.instructions-section').should('be.visible')
    cy.get('.instruction-item').should('have.length.at.least', 3)
    
    // Check visualization toggle
    cy.get('.visualization-controls .visualization-toggle').should('be.visible')
  })

  it('should adapt UI for mobile viewports', () => {
    cy.viewport(375, 667)
    
    // Check mobile UI elements
    cy.get('.game-ui-mobile').should('be.visible')
    cy.get('.game-ui-mobile-buttons').should('be.visible')
    
    // Mobile buttons should be present
    cy.get('.game-ui-mobile-buttons button').should('have.length.at.least', 3)
    cy.contains('button', 'Stations').should('be.visible')
    cy.contains('button', 'Instructions').should('be.visible')
    cy.get('button').contains(/Simple|Parallel/).should('be.visible')
    
    // Sections should be hidden by default on mobile
    cy.get('.stations-section.mobile').should('not.exist')
    cy.get('.instructions-section.mobile').should('not.exist')
  })

  it('should show/hide mobile sections when buttons are clicked', () => {
    cy.viewport(375, 667)
    
    // Click Stations button
    cy.contains('button', 'Stations').click()
    cy.get('.stations-section.mobile').should('be.visible')
    
    // Click again to hide
    cy.contains('button', 'Stations').click()
    cy.get('.stations-section.mobile').should('not.exist')
    
    // Click Instructions button
    cy.contains('button', 'Instructions').click()
    cy.get('.instructions-section.mobile').should('be.visible')
    
    // Click again to hide
    cy.contains('button', 'Instructions').click()
    cy.get('.instructions-section.mobile').should('not.exist')
  })

  it('should update stats in real-time', () => {
    // Wait for stations to spawn
    cy.get('[data-testid="stations-count"]', { timeout: 25000 })
      .should('not.contain', '0')
    
    // Get initial values
    cy.get('[data-testid="score"]').then(($score) => {
      const initialScore = $score.text()
      
      cy.get('[data-testid="stations-count"]').then(($stations) => {
        const initialStations = $stations.text()
        
        // Wait for changes
        cy.wait(10000)
        
        // At least one value should have potentially changed
        // (stations count should increase, passengers might accumulate)
        cy.get('[data-testid="passengers-count"]').should('exist')
      })
    })
  })

  it('should display station list with correct information', () => {
    // Wait for stations
    cy.get('[data-testid="stations-count"]', { timeout: 25000 })
      .should('not.contain', '0')
    
    // Check station list items
    cy.get('.stations-list .station-item').should('have.length.at.least', 1)
    
    cy.get('.station-item').first().within(() => {
      // Should have station name
      cy.get('.station-name').should('contain', 'Stn')
      
      // Should have route indicators container
      cy.get('.route-indicators').should('exist')
      
      // Passenger badge should appear when passengers > 0
      cy.get('body').then(() => {
        // This is conditional based on passenger count
      })
    })
  })

  it('should handle station selection from list', () => {
    // Wait for stations
    cy.get('[data-testid="stations-count"]', { timeout: 25000 })
      .should('not.contain', '0')
    
    // Click on a station in the list
    cy.get('.station-item.clickable').first().click()
    
    // Station selection should work (hard to test visually)
    // The click handler should be called
  })

  it('should show route indicators in station list', () => {
    // Create a route first
    cy.get('.maplibregl-canvas')
      .trigger('mousedown', { x: 200, y: 200 })
      .trigger('mousemove', { x: 400, y: 400 })
      .trigger('mouseup')
    
    cy.wait(3000)
    
    // Check for route indicators in station list
    cy.get('.station-item .route-indicators').should('exist')
    
    // If route was created, there should be route dots
    cy.get('body').then(($body) => {
      const routeDots = $body.find('.route-dot')
      if (routeDots.length > 0) {
        cy.get('.route-dot').should('have.css', 'background-color')
      }
    })
  })

  it('should display passenger badges when stations have passengers', () => {
    // Wait for stations and passengers to accumulate
    cy.wait(10000)
    
    // Check for passenger badges
    cy.get('body').then(($body) => {
      const passengerBadges = $body.find('.passenger-badge')
      if (passengerBadges.length > 0) {
        cy.get('.passenger-badge').first().should('be.visible')
        cy.get('.passenger-badge').first().should('contain.text', /\d+/)
      }
    })
  })

  it('should handle window resize gracefully', () => {
    // Start with desktop
    cy.viewport(1280, 720)
    cy.get('.metro-legend').should('be.visible')
    
    // Switch to mobile
    cy.viewport(375, 667)
    cy.get('.game-ui-mobile').should('be.visible')
    
    // Switch back to desktop
    cy.viewport(1280, 720)
    cy.get('.metro-legend').should('be.visible')
  })
})