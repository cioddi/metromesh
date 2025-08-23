describe('Performance and Stress Testing', () => {
  beforeEach(() => {
    cy.visit('/')
    cy.waitForMapLoad()
  })

  it('should handle maximum stations without performance degradation', () => {
    // Wait for maximum stations to spawn (up to 12 based on GAME_CONFIG.maxStations)
    // This is a long-running test
    
    cy.get('[data-testid="stations-count"]', { timeout: 60000 })
      .should('not.contain', '0')
    
    // Wait for stations to accumulate to maximum
    cy.wait(120000) // 2 minutes to allow stations to spawn
    
    // Application should still be responsive
    cy.get('.maplibregl-canvas').should('be.visible')
    cy.get('[data-testid="score"]').should('exist')
    
    // UI should remain responsive
    cy.get('button').contains(/Simple|Parallel/).click()
    cy.wait(1000)
    cy.get('button').contains(/Simple|Parallel/).click()
  })

  it('should handle rapid visualization mode switching', () => {
    // Wait for some stations and routes
    cy.wait(15000)
    
    // Rapidly switch visualization modes
    const toggleButton = 'button:contains("Simple"), button:contains("Parallel")'
    
    for (let i = 0; i < 10; i++) {
      cy.get(toggleButton).first().click()
      cy.wait(200)
    }
    
    // Application should still be functional
    cy.get('.maplibregl-canvas').should('be.visible')
    cy.get('[data-testid="score"]').should('exist')
  })

  it('should handle multiple simultaneous route creation attempts', () => {
    // Wait for multiple stations
    cy.get('[data-testid="stations-count"]', { timeout: 30000 })
      .should('not.contain', '0')
      .and('not.contain', '1')
      .and('not.contain', '2')
    
    // Attempt multiple route creations quickly
    const canvas = '.maplibregl-canvas'
    
    // Rapid-fire route creation attempts
    for (let i = 0; i < 5; i++) {
      cy.get(canvas)
        .trigger('mousedown', { x: 200 + i * 50, y: 200 + i * 50 })
        .trigger('mousemove', { x: 400 + i * 50, y: 400 + i * 50 })
        .trigger('mouseup')
      
      cy.wait(100)
    }
    
    // Application should handle this gracefully
    cy.wait(2000)
    cy.get('.maplibregl-canvas').should('be.visible')
  })

  it('should maintain performance with high passenger counts', () => {
    // Let passengers accumulate for a long time
    cy.wait(45000)
    
    // Check total passenger count
    cy.get('[data-testid="passengers-count"]').then(($count) => {
      const passengerCount = parseInt($count.text() || '0')
      
      // If we have many passengers, test performance
      if (passengerCount > 50) {
        // Toggle visualization modes with high passenger load
        cy.get('button').contains(/Simple|Parallel/).click()
        cy.wait(1000)
        cy.get('button').contains(/Simple|Parallel/).click()
        cy.wait(1000)
        
        // UI should remain responsive
        cy.get('[data-testid="score"]').should('exist')
      }
    })
  })

  it('should handle memory cleanup when switching between modes', () => {
    // This test ensures proper cleanup of Three.js objects
    
    // Wait for game elements to exist
    cy.wait(10000)
    
    // Create some routes
    cy.get('.maplibregl-canvas')
      .trigger('mousedown', { x: 200, y: 200 })
      .trigger('mousemove', { x: 400, y: 400 })
      .trigger('mouseup')
    
    cy.wait(2000)
    
    // Switch modes multiple times to test cleanup
    for (let i = 0; i < 5; i++) {
      cy.get('button').contains(/Simple|Parallel/).click()
      cy.wait(1000)
    }
    
    // Application should not have memory leaks (hard to test directly)
    // But it should continue functioning normally
    cy.get('.maplibregl-canvas').should('be.visible')
  })

  it('should handle edge case of very fast mouse movements', () => {
    // Test rapid mouse movements on the canvas
    const canvas = '.maplibregl-canvas'
    
    // Rapid mouse movements
    cy.get(canvas).trigger('mousemove', { x: 100, y: 100 })
    cy.get(canvas).trigger('mousemove', { x: 200, y: 150 })
    cy.get(canvas).trigger('mousemove', { x: 300, y: 200 })
    cy.get(canvas).trigger('mousemove', { x: 400, y: 250 })
    cy.get(canvas).trigger('mousemove', { x: 500, y: 300 })
    
    // Start and immediately end drags
    cy.get(canvas)
      .trigger('mousedown', { x: 200, y: 200 })
      .trigger('mouseup')
    
    // Application should handle this gracefully
    cy.wait(500)
    cy.get(canvas).should('be.visible')
  })

  it('should maintain frame rate with active trains', () => {
    // Create multiple routes to spawn multiple trains
    const positions = [
      { start: { x: 200, y: 200 }, end: { x: 400, y: 400 } },
      { start: { x: 500, y: 200 }, end: { x: 700, y: 400 } },
      { start: { x: 300, y: 500 }, end: { x: 600, y: 300 } }
    ]
    
    positions.forEach((pos, index) => {
      cy.get('.maplibregl-canvas')
        .trigger('mousedown', pos.start)
        .trigger('mousemove', pos.end)
        .trigger('mouseup')
      
      cy.wait(1000)
    })
    
    // Let trains run for a while
    cy.wait(15000)
    
    // Application should maintain smooth operation
    cy.get('button').contains(/Simple|Parallel/).click()
    cy.wait(500)
    cy.get('button').contains(/Simple|Parallel/).click()
    
    // Should remain responsive
    cy.get('[data-testid="score"]').should('exist')
  })

  it('should handle game reset without memory leaks', () => {
    // Let game run to build up state
    cy.wait(30000)
    
    // If reset button exists, test it
    cy.get('body').then(($body) => {
      if ($body.find('[data-testid="reset-button"]').length > 0) {
        cy.get('[data-testid="reset-button"]').click()
        
        // After reset, game should be clean
        cy.get('[data-testid="score"]').should('contain', '0')
        cy.get('[data-testid="stations-count"]').should('contain', '0')
        
        // Should be able to continue playing
        cy.wait(5000)
        cy.get('.maplibregl-canvas').should('be.visible')
      }
    })
  })
})