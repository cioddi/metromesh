describe('Station Spawning', () => {
  beforeEach(() => {
    cy.visit('/')
    cy.waitForMapLoad()
  })

  it('should spawn stations automatically over time', () => {
    // Wait for first station to spawn (can take up to 20 seconds based on config)
    cy.get('[data-testid="stations-count"]', { timeout: 25000 })
      .should('not.contain', '0')
    
    // Verify station count increases
    cy.get('[data-testid="stations-count"]').then(($count) => {
      const initialCount = parseInt($count.text())
      expect(initialCount).to.be.at.least(1)
      
      // Wait for more stations to spawn
      cy.wait(10000)
      cy.get('[data-testid="stations-count"]').should('not.contain', initialCount.toString())
    })
  })

  it('should display stations in the station list', () => {
    // Wait for at least one station
    cy.get('[data-testid="stations-count"]', { timeout: 25000 })
      .should('not.contain', '0')
    
    // Check desktop station list (should be visible by default on desktop)
    cy.get('.stations-list .station-item').should('have.length.at.least', 1)
  })

  it('should show station details in the list', () => {
    // Wait for at least one station
    cy.get('[data-testid="stations-count"]', { timeout: 25000 })
      .should('not.contain', '0')
    
    // Check that station items have the expected structure
    cy.get('.station-item').first().within(() => {
      cy.get('.station-name').should('contain', 'Stn')
      cy.get('.route-indicators').should('exist')
    })
  })

  it('should update passenger counts on stations', () => {
    // Wait for stations to spawn and accumulate passengers
    cy.get('[data-testid="stations-count"]', { timeout: 25000 })
      .should('not.contain', '0')
    
    // Wait for passengers to accumulate
    cy.wait(5000)
    
    // Total passenger count should increase over time
    cy.get('[data-testid="passengers-count"]').then(($count) => {
      const initialPassengers = parseInt($count.text())
      
      cy.wait(5000)
      cy.get('[data-testid="passengers-count"]').should('not.contain', initialPassengers.toString())
    })
  })

  it('should respect maximum station limit', () => {
    // Wait a significant time to see if station spawning stops at limit
    cy.wait(30000)
    
    // Based on GAME_CONFIG.maxStations = 12
    cy.get('[data-testid="stations-count"]').then(($count) => {
      const stationCount = parseInt($count.text())
      expect(stationCount).to.be.at.most(12)
    })
  })
})