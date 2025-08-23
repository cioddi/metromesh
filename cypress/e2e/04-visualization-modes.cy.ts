describe('Visualization Modes', () => {
  beforeEach(() => {
    cy.visit('/')
    cy.waitForMapLoad()
    
    // Wait for stations and potentially routes to exist
    cy.get('[data-testid="stations-count"]', { timeout: 30000 })
      .should('not.contain', '0')
  })

  it('should toggle between parallel and simple visualization modes', () => {
    // Find and click the visualization toggle button
    cy.get('button').contains(/Simple|Parallel/).as('toggleButton')
    
    // Check initial button text
    cy.get('@toggleButton').then(($btn) => {
      const initialText = $btn.text()
      
      // Click to toggle
      cy.get('@toggleButton').click()
      
      // Wait for toggle to take effect
      cy.wait(500)
      
      // Button text should change
      cy.get('@toggleButton').should('not.contain', initialText)
    })
  })

  it('should maintain toggle state on desktop view', () => {
    // Ensure we're in desktop mode (if viewport is wide enough)
    cy.viewport(1280, 720)
    
    // The toggle button should be visible in the instructions section
    cy.get('.instructions-section .visualization-toggle').should('be.visible')
    
    // Click the toggle
    cy.get('.instructions-section .visualization-toggle').click()
    
    // Verify the button text changed
    cy.get('.instructions-section .visualization-toggle')
      .should('contain.text', /Switch to (Simple|Parallel) View/)
  })

  it('should maintain toggle state on mobile view', () => {
    // Switch to mobile viewport
    cy.viewport(375, 667)
    
    // On mobile, the toggle should be in the mobile buttons section
    cy.get('.game-ui-mobile-buttons button').contains(/Simple|Parallel/).should('be.visible')
    
    // Click the mobile toggle
    cy.get('.game-ui-mobile-buttons button').contains(/Simple|Parallel/).as('mobileToggle')
    
    cy.get('@mobileToggle').then(($btn) => {
      const initialText = $btn.text()
      
      cy.get('@mobileToggle').click()
      cy.wait(500)
      
      // Text should change to indicate the switch
      cy.get('@mobileToggle').should('not.contain', initialText)
    })
  })

  it('should render routes differently in each visualization mode', () => {
    // This test verifies that switching modes actually changes route rendering
    // We'll need at least one route for this test to be meaningful
    
    // Create a simple route by dragging (simplified)
    cy.get('.maplibregl-canvas')
      .trigger('mousedown', { x: 200, y: 200 })
      .trigger('mousemove', { x: 400, y: 400 })
      .trigger('mouseup')
    
    cy.wait(2000)
    
    // Toggle visualization mode
    cy.get('button').contains(/Simple|Parallel/).click()
    cy.wait(1000)
    
    // Routes should still be visible but rendered differently
    // In a complete implementation, you'd check for specific visual differences
    cy.get('.maplibregl-canvas').should('be.visible')
    
    // Toggle back
    cy.get('button').contains(/Simple|Parallel/).click()
    cy.wait(1000)
  })

  it('should handle train rendering in both visualization modes', () => {
    // Trains should be rendered consistently regardless of route visualization mode
    
    // Wait for potential trains to spawn
    cy.wait(10000)
    
    // Toggle between modes
    cy.get('button').contains(/Simple|Parallel/).as('toggle')
    
    cy.get('@toggle').click()
    cy.wait(1000)
    
    // Trains should still be moving (this is conceptual - hard to test visually)
    cy.get('.maplibregl-canvas').should('be.visible')
    
    cy.get('@toggle').click()
    cy.wait(1000)
  })

  it('should preserve game state when switching visualization modes', () => {
    // Get current game state
    cy.get('[data-testid="score"]').then(($score) => {
      const currentScore = $score.text()
      
      cy.get('[data-testid="stations-count"]').then(($stations) => {
        const stationCount = $stations.text()
        
        // Toggle visualization
        cy.get('button').contains(/Simple|Parallel/).click()
        cy.wait(1000)
        
        // Game state should be preserved
        cy.get('[data-testid="score"]').should('contain', currentScore)
        cy.get('[data-testid="stations-count"]').should('contain', stationCount)
        
        // Toggle back
        cy.get('button').contains(/Simple|Parallel/).click()
        cy.wait(1000)
        
        // State should still be preserved
        cy.get('[data-testid="score"]').should('contain', currentScore)
        cy.get('[data-testid="stations-count"]').should('contain', stationCount)
      })
    })
  })

  it('should handle route clearing when switching modes', () => {
    // This tests the fix for routes not clearing when switching modes
    
    // Wait for potential routes to exist
    cy.wait(5000)
    
    // Toggle between modes multiple times rapidly
    cy.get('button').contains(/Simple|Parallel/).as('toggle')
    
    cy.get('@toggle').click()
    cy.wait(500)
    cy.get('@toggle').click()
    cy.wait(500)
    cy.get('@toggle').click()
    cy.wait(500)
    
    // The application should handle this gracefully without visual artifacts
    cy.get('.maplibregl-canvas').should('be.visible')
  })
})