# MetroMesh Testing Guide

This project uses Cypress for comprehensive end-to-end testing of all major game functions and UI components.

## Running Tests

### Prerequisites
- Make sure the development server is running: `npm run dev`
- The application should be accessible at `http://localhost:5173/metromesh/`

### Test Commands
```bash
# Run all tests headlessly
npm test

# Open Cypress Test Runner (GUI)
npm run test:open

# Run only E2E tests
npm run test:e2e

# Run component tests (when available)
npm run test:component
```

## Test Structure

### E2E Tests (`cypress/e2e/`)

1. **01-game-initialization.cy.ts**
   - Application loading and setup
   - Initial UI state verification
   - Map canvas initialization

2. **02-station-spawning.cy.ts**
   - Automatic station spawning over time
   - Station display in UI
   - Passenger accumulation
   - Station limit enforcement

3. **03-route-creation.cy.ts**
   - Route creation via drag operations
   - Route preview functionality
   - Train spawning on routes
   - Route extension and connection logic

4. **04-visualization-modes.cy.ts**
   - Toggle between parallel and simple visualization
   - Route rendering differences
   - UI state preservation across modes
   - Mobile vs desktop UI behavior

5. **05-train-movement.cy.ts**
   - Train physics and realistic speed calculations
   - Train reversal at route endpoints
   - Passenger pickup and delivery
   - Multi-train coordination

6. **06-game-over-conditions.cy.ts**
   - Station overload detection (20+ passengers for 5+ seconds)
   - Game over screen and statistics
   - Game reset functionality

7. **07-user-interface.cy.ts**
   - Desktop vs mobile UI adaptation
   - Interactive elements functionality
   - Real-time stat updates
   - Station list and selection

8. **08-performance-stress.cy.ts**
   - Maximum station handling
   - Rapid user interactions
   - Memory cleanup verification
   - High passenger count scenarios

## Test Data

### Data Test IDs
The following data-testid attributes are available for reliable element selection:

- `data-testid="score"` - Current game score
- `data-testid="stations-count"` - Number of stations
- `data-testid="passengers-count"` - Total passenger count

### Custom Commands
Available in `cypress/support/commands.ts`:

- `cy.waitForMapLoad()` - Wait for MapLibre map initialization
- `cy.toggleVisualization()` - Toggle between visualization modes

## Test Configuration

### Cypress Configuration (`cypress.config.ts`)
- Base URL: `http://localhost:5173/metromesh/`
- Viewport: 1280x720 (desktop), 375x667 (mobile testing)
- Screenshots on failure enabled
- Video recording disabled for faster execution

### Browser Support
Tests are designed to work with:
- Chrome (primary)
- Firefox
- Edge

## Writing New Tests

### Best Practices
1. **Use data-testid attributes** for reliable element selection
2. **Wait for async operations** using `cy.wait()` or `cy.should()` with timeouts
3. **Test both mobile and desktop viewports** for responsive features
4. **Mock external dependencies** when necessary
5. **Keep tests independent** - each test should work in isolation

### Example Test Structure
```typescript
describe('Feature Name', () => {
  beforeEach(() => {
    cy.visit('/')
    cy.waitForMapLoad()
  })

  it('should perform expected behavior', () => {
    // Test implementation
    cy.get('[data-testid="element"]').should('be.visible')
  })
})
```

### Testing Game Timing
Many game features involve timing (station spawning, passenger accumulation):
- Station spawning: 15-20 seconds between spawns
- Passenger spawning: ~6.5% chance per 100ms game loop
- Game over: 5 seconds of station overload (20+ passengers)

Adjust `cy.wait()` timeouts accordingly, with generous timeouts for CI/CD environments.

## Debugging Tests

### Running in GUI Mode
Use `npm run test:open` to run tests interactively with the Cypress Test Runner. This allows:
- Real-time test execution viewing
- Debug breakpoints
- Step-by-step execution
- Network and console inspection

### Screenshots and Videos
- Screenshots are automatically taken on test failures
- Enable video recording in `cypress.config.ts` if needed for debugging

### Console Logs
Game state and debug information can be viewed in the browser console during test execution.

## CI/CD Integration

For automated testing in CI/CD pipelines:
1. Start the development server
2. Wait for server to be ready
3. Run `npm test` 
4. Collect test artifacts (screenshots, reports)

Example GitHub Actions workflow:
```yaml
- name: Install dependencies
  run: npm ci

- name: Start dev server
  run: npm run dev &
  
- name: Wait for server
  run: npx wait-on http://localhost:5173

- name: Run tests
  run: npm test
```

## Known Test Limitations

1. **Three.js Rendering**: Visual verification of 3D elements is limited
2. **Precise Coordinate Testing**: Mouse interactions use approximated positions
3. **Timing-Dependent Tests**: Some tests depend on game timing configurations
4. **Route Creation**: Simplified drag simulation may not always trigger route creation

These limitations are balanced with comprehensive testing of game logic, UI behavior, and user interactions.