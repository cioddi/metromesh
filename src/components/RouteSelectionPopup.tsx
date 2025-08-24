import React from "react";
import type { Route } from "../types";

interface RouteSelectionPopupProps {
  isVisible: boolean;
  routes: Route[];
  position: { x: number; y: number };
  onRouteSelect: (routeId: string) => void;
  onCancel: () => void;
}

const RouteSelectionPopup: React.FC<RouteSelectionPopupProps> = ({
  isVisible,
  routes,
  position,
  onRouteSelect,
  onCancel,
}) => {
  if (!isVisible || routes.length === 0) {
    return null;
  }

  return (
    <>
      {/* Backdrop to capture clicks outside popup */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50"
        style={{
          zIndex: 10001,
          backdropFilter: "blur(2px)",
        }}
        onClick={onCancel}
      />

      {/* Popup container - matching metro-legend styling */}
      <div
        style={{
          position: "fixed",
          left: `${position.x}px`,
          top: `${position.y}px`,
          transform: "translate(-50%, -50%)",
          zIndex: 10002,
          width: "320px",
          background: "white",
          color: "#333",
          borderRadius: "12px",
          boxShadow: "0 8px 32px rgba(0, 0, 0, 0.12)",
          border: "1px solid rgba(0, 0, 0, 0.08)",
          overflow: "hidden",
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        }}
      >
        {/* Header matching metro-legend style */}
        <div
          style={{
            textShadow: "0 1px 2px rgba(0, 0, 0, 0.2)",
            padding: "16px 16px 8px 16px",
            textAlign: "center",
          }}
        >
          <h3
            style={{
              margin: "0",
              fontSize: "16px",
              fontWeight: "600",
              color: "black",
              textShadow: "none",
            }}
          >
            Select Route to Extend
          </h3>
          <p style={{ margin: "8px 0 0 0", fontSize: "12px", opacity: "0.9" }}>
            Choose which route to extend from this station
          </p>
        </div>

        {/* Route selection buttons */}
        <div style={{ padding: "16px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {routes.map((route) => (
              <button
                key={route.id}
                onClick={() => onRouteSelect(route.id)}
                style={{
                  width: "100%",
                  padding: "12px",
                  borderRadius: "8px",
                  border: "1px solid rgba(0, 0, 0, 0.08)",
                  backgroundColor: "white",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  transition: "all 0.15s ease",
                  boxShadow: "0 2px 8px rgba(0, 0, 0, 0.06)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = "#f8f9fa";
                  e.currentTarget.style.transform = "translateY(-1px)";
                  e.currentTarget.style.boxShadow =
                    "0 4px 12px rgba(0, 0, 0, 0.12)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "white";
                  e.currentTarget.style.transform = "translateY(0)";
                  e.currentTarget.style.boxShadow =
                    "0 2px 8px rgba(0, 0, 0, 0.06)";
                }}
              >
                <div
                  style={{
                    width: "20px",
                    height: "20px",
                    borderRadius: "50%",
                    backgroundColor: route.color,
                    border: "2px solid white",
                    boxShadow: "0 2px 4px rgba(0, 0, 0, 0.1)",
                    flexShrink: 0,
                  }}
                />
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-start",
                    textAlign: "left",
                  }}
                >
                  <span
                    style={{
                      fontSize: "14px",
                      fontWeight: "600",
                      color: "#333",
                      lineHeight: "1.2",
                    }}
                  >
                    Route {route.id.slice(-4)}
                  </span>
                  <span
                    style={{
                      fontSize: "12px",
                      color: "#666",
                      opacity: "0.8",
                    }}
                  >
                    {route.stations.length} stations
                  </span>
                </div>
              </button>
            ))}
          </div>

          {/* Cancel button */}
          <div
            style={{
              marginTop: "16px",
              paddingTop: "12px",
              borderTop: "1px solid rgba(0, 0, 0, 0.08)",
            }}
          >
            <button
              onClick={onCancel}
              style={{
                width: "100%",
                padding: "10px",
                borderRadius: "6px",
                border: "1px solid rgba(0, 0, 0, 0.08)",
                backgroundColor: "#f8f9fa",
                color: "#666",
                cursor: "pointer",
                fontSize: "13px",
                fontWeight: "500",
                transition: "all 0.15s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = "#e9ecef";
                e.currentTarget.style.color = "#333";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "#f8f9fa";
                e.currentTarget.style.color = "#666";
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default RouteSelectionPopup;
