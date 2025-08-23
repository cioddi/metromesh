describe('Game Initialization', () => {
  beforeEach(() => {
    cy.visit('/')
  })

  it('should load the application successfully', () => {
    // Check that the main components are present
    cy.get('.maplibregl-map').should('exist')
    cy.contains('MetroMesh').should('be.visible')
    cy.contains('Score').should('be.visible')
    cy.contains('Stations').should('be.visible')
    cy.contains('Passengers').should('be.visible')
  })

  it('should display initial game state', () => {
    cy.waitForMapLoad()
    
    // Initial score should be 0
    cy.contains('Score').parent().should('contain', '0')
    
    // Should show instructions
    cy.contains('Stations spawn automatically').should('be.visible')
    cy.contains('Drag between stations to connect').should('be.visible')
    cy.contains('Trains pick up waiting passengers').should('be.visible')
  })

  it('should have visualization toggle button', () => {
    cy.waitForMapLoad()
    
    // Check for visualization toggle button
    cy.get('button').contains(/Simple|Parallel/).should('be.visible')
  })

  it('should start with no stations initially', () => {
    cy.waitForMapLoad()
    
    // Initial station count should be 0
    cy.contains('Stations').parent().should('contain', '0')
  })

  it('should have proper map canvas setup', () => {
    cy.waitForMapLoad()
    
    // Map canvas should be interactive
    cy.get('.maplibregl-canvas').should('be.visible')
    cy.get('.maplibregl-canvas').should('have.attr', 'width')
    cy.get('.maplibregl-canvas').should('have.attr', 'height')
  })
})