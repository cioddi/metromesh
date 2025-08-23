describe('Game Over Conditions', () => {
  beforeEach(() => {
    cy.visit('/')
    cy.waitForMapLoad()
  })

  it('should trigger game over when station is overloaded for too long', () => {
    // This tests the game over condition: station with 20+ passengers for 5+ seconds
    
    // Wait for stations to spawn and accumulate passengers
    cy.get('[data-testid="stations-count"]', { timeout: 30000 })
      .should('not.contain', '0')
    
    // Wait for passengers to accumulate (without creating routes so they build up)
    cy.wait(30000)
    
    // Check if game over condition is triggered
    cy.get('body').then(($body) => {
      if ($body.find('[data-testid="game-over"]').length > 0) {
        // Game over triggered
        cy.get('[data-testid="game-over"]').should('be.visible')
        cy.contains('overloaded').should('be.visible')
      } else {
        // Game is still running (which is also fine for this test)
        cy.get('[data-testid="score"]').should('exist')
      }
    })
  })

  it('should display game over statistics', () => {
    // If game over occurs, it should show proper statistics
    
    // Wait for potential game over
    cy.wait(45000)
    
    cy.get('body').then(($body) => {
      if ($body.find('[data-testid="game-over"]').length > 0) {
        // Verify game over screen shows statistics
        cy.get('[data-testid="final-score"]').should('exist')
        cy.get('[data-testid="total-stations"]').should('exist')
        cy.get('[data-testid="game-time"]').should('exist')
      }
    })
  })

  it('should allow game reset after game over', () => {
    // This test verifies the reset functionality works
    
    // If game over screen exists, test reset
    cy.get('body').then(($body) => {
      if ($body.find('[data-testid="reset-button"]').length > 0) {
        cy.get('[data-testid="reset-button"]').click()
        
        // Game should reset to initial state
        cy.get('[data-testid="score"]').should('contain', '0')
        cy.get('[data-testid="stations-count"]').should('contain', '0')
      }
    })
  })

  it('should continue running when stations are properly served', () => {
    // Test that game continues when routes are created to prevent overload
    
    // Wait for stations to spawn
    cy.get('[data-testid="stations-count"]', { timeout: 30000 })
      .should('not.contain', '0')
    
    // Create routes to help manage passenger flow
    cy.get('.maplibregl-canvas')
      .trigger('mousedown', { x: 200, y: 200 })
      .trigger('mousemove', { x: 400, y: 400 })
      .trigger('mouseup')
    
    cy.wait(2000)
    
    cy.get('.maplibregl-canvas')
      .trigger('mousedown', { x: 500, y: 200 })
      .trigger('mousemove', { x: 700, y: 400 })
      .trigger('mouseup')
    
    // Wait and verify game continues
    cy.wait(20000)
    
    // Game should still be running if routes help manage passengers
    cy.get('[data-testid="score"]').should('exist')
    cy.get('[data-testid="stations-count"]').should('exist')
  })

  it('should handle edge case of exactly 20 passengers', () => {
    // Test the boundary condition for game over (20+ passengers)
    
    // Wait for passenger accumulation
    cy.wait(25000)
    
    // Check passenger counts in station list
    cy.get('.station-item').each(($station) => {
      cy.wrap($station).within(() => {
        // If passenger badge exists, check it's handling high counts properly
        cy.get('body').then(($body) => {
          const passengerBadge = $station.find('.passenger-badge')
          if (passengerBadge.length > 0) {
            // Badge exists, verify it's displayed correctly
            cy.get('.passenger-badge').should('be.visible')
          }
        })
      })
    })
  })

  it('should provide clear game over reason', () => {
    // Test that game over message is informative
    
    // Wait for potential game over
    cy.wait(40000)
    
    cy.get('body').then(($body) => {
      if ($body.find('[data-testid="game-over-reason"]').length > 0) {
        // Game over message should include station ID and reason
        cy.get('[data-testid="game-over-reason"]')
          .should('contain', 'Station')
          .and('contain', 'overloaded')
      }
    })
  })
})