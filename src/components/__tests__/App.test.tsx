import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import App from '../../App'

jest.mock('@mapcomponents/react-maplibre', () => ({
  MapLibreMap: () => <div data-testid="map" />,
  MapComponentsProvider: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  useMap: () => ({ map: null })
}))

describe('App Component', () => {
  it('renders without crashing', () => {
    render(<App />)
    expect(screen.getByTestId('map')).toBeInTheDocument()
  })

  it('displays game title', () => {
    render(<App />)
    expect(screen.getByText('MetroMesh')).toBeInTheDocument()
  })
})