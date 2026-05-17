"use client"

import { useEffect, useRef } from "react"

// World map coordinates as latitude/longitude pairs for dot placement
// These represent continental landmasses in a simplified dot-matrix style
const worldCoordinates = [
  // North America
  { lat: 65, lng: -160 }, { lat: 65, lng: -150 }, { lat: 65, lng: -140 }, { lat: 65, lng: -130 },
  { lat: 60, lng: -165 }, { lat: 60, lng: -155 }, { lat: 60, lng: -145 }, { lat: 60, lng: -135 }, { lat: 60, lng: -125 }, { lat: 60, lng: -115 },
  { lat: 55, lng: -165 }, { lat: 55, lng: -155 }, { lat: 55, lng: -145 }, { lat: 55, lng: -135 }, { lat: 55, lng: -125 }, { lat: 55, lng: -115 }, { lat: 55, lng: -105 }, { lat: 55, lng: -95 }, { lat: 55, lng: -85 }, { lat: 55, lng: -75 }, { lat: 55, lng: -65 },
  { lat: 50, lng: -130 }, { lat: 50, lng: -120 }, { lat: 50, lng: -110 }, { lat: 50, lng: -100 }, { lat: 50, lng: -90 }, { lat: 50, lng: -80 }, { lat: 50, lng: -70 }, { lat: 50, lng: -60 },
  { lat: 45, lng: -125 }, { lat: 45, lng: -115 }, { lat: 45, lng: -105 }, { lat: 45, lng: -95 }, { lat: 45, lng: -85 }, { lat: 45, lng: -75 }, { lat: 45, lng: -65 },
  { lat: 40, lng: -125 }, { lat: 40, lng: -115 }, { lat: 40, lng: -105 }, { lat: 40, lng: -95 }, { lat: 40, lng: -85 }, { lat: 40, lng: -75 },
  { lat: 35, lng: -120 }, { lat: 35, lng: -110 }, { lat: 35, lng: -100 }, { lat: 35, lng: -90 }, { lat: 35, lng: -80 },
  { lat: 30, lng: -115 }, { lat: 30, lng: -105 }, { lat: 30, lng: -95 }, { lat: 30, lng: -85 },
  { lat: 25, lng: -110 }, { lat: 25, lng: -100 }, { lat: 25, lng: -90 },
  
  // Central America & Caribbean
  { lat: 20, lng: -105 }, { lat: 20, lng: -100 }, { lat: 20, lng: -90 }, { lat: 20, lng: -85 }, { lat: 20, lng: -80 }, { lat: 20, lng: -75 },
  { lat: 15, lng: -95 }, { lat: 15, lng: -90 }, { lat: 15, lng: -85 },
  { lat: 10, lng: -85 }, { lat: 10, lng: -80 }, { lat: 10, lng: -75 },
  
  // South America
  { lat: 5, lng: -80 }, { lat: 5, lng: -75 }, { lat: 5, lng: -70 }, { lat: 5, lng: -65 }, { lat: 5, lng: -60 }, { lat: 5, lng: -55 },
  { lat: 0, lng: -80 }, { lat: 0, lng: -75 }, { lat: 0, lng: -70 }, { lat: 0, lng: -65 }, { lat: 0, lng: -60 }, { lat: 0, lng: -55 }, { lat: 0, lng: -50 },
  { lat: -5, lng: -80 }, { lat: -5, lng: -75 }, { lat: -5, lng: -70 }, { lat: -5, lng: -65 }, { lat: -5, lng: -60 }, { lat: -5, lng: -55 }, { lat: -5, lng: -50 }, { lat: -5, lng: -45 }, { lat: -5, lng: -40 }, { lat: -5, lng: -35 },
  { lat: -10, lng: -78 }, { lat: -10, lng: -70 }, { lat: -10, lng: -65 }, { lat: -10, lng: -60 }, { lat: -10, lng: -55 }, { lat: -10, lng: -50 }, { lat: -10, lng: -45 }, { lat: -10, lng: -40 }, { lat: -10, lng: -35 },
  { lat: -15, lng: -75 }, { lat: -15, lng: -70 }, { lat: -15, lng: -65 }, { lat: -15, lng: -60 }, { lat: -15, lng: -55 }, { lat: -15, lng: -50 }, { lat: -15, lng: -45 }, { lat: -15, lng: -40 },
  { lat: -20, lng: -70 }, { lat: -20, lng: -65 }, { lat: -20, lng: -60 }, { lat: -20, lng: -55 }, { lat: -20, lng: -50 }, { lat: -20, lng: -45 },
  { lat: -25, lng: -70 }, { lat: -25, lng: -65 }, { lat: -25, lng: -60 }, { lat: -25, lng: -55 }, { lat: -25, lng: -50 },
  { lat: -30, lng: -72 }, { lat: -30, lng: -65 }, { lat: -30, lng: -60 }, { lat: -30, lng: -55 },
  { lat: -35, lng: -72 }, { lat: -35, lng: -65 }, { lat: -35, lng: -60 },
  { lat: -40, lng: -73 }, { lat: -40, lng: -68 },
  { lat: -45, lng: -73 }, { lat: -45, lng: -70 },
  { lat: -50, lng: -75 }, { lat: -50, lng: -70 },
  
  // Europe
  { lat: 70, lng: 25 }, { lat: 70, lng: 30 },
  { lat: 65, lng: 10 }, { lat: 65, lng: 15 }, { lat: 65, lng: 20 }, { lat: 65, lng: 25 }, { lat: 65, lng: 30 },
  { lat: 60, lng: 5 }, { lat: 60, lng: 10 }, { lat: 60, lng: 15 }, { lat: 60, lng: 20 }, { lat: 60, lng: 25 }, { lat: 60, lng: 30 }, { lat: 60, lng: 35 }, { lat: 60, lng: 40 },
  { lat: 55, lng: -10 }, { lat: 55, lng: -5 }, { lat: 55, lng: 0 }, { lat: 55, lng: 5 }, { lat: 55, lng: 10 }, { lat: 55, lng: 15 }, { lat: 55, lng: 20 }, { lat: 55, lng: 25 }, { lat: 55, lng: 30 }, { lat: 55, lng: 35 }, { lat: 55, lng: 40 }, { lat: 55, lng: 45 }, { lat: 55, lng: 50 }, { lat: 55, lng: 55 }, { lat: 55, lng: 60 },
  { lat: 50, lng: -5 }, { lat: 50, lng: 0 }, { lat: 50, lng: 5 }, { lat: 50, lng: 10 }, { lat: 50, lng: 15 }, { lat: 50, lng: 20 }, { lat: 50, lng: 25 }, { lat: 50, lng: 30 }, { lat: 50, lng: 35 }, { lat: 50, lng: 40 }, { lat: 50, lng: 45 }, { lat: 50, lng: 50 }, { lat: 50, lng: 55 }, { lat: 50, lng: 60 }, { lat: 50, lng: 65 }, { lat: 50, lng: 70 }, { lat: 50, lng: 75 }, { lat: 50, lng: 80 },
  { lat: 45, lng: -10 }, { lat: 45, lng: -5 }, { lat: 45, lng: 0 }, { lat: 45, lng: 5 }, { lat: 45, lng: 10 }, { lat: 45, lng: 15 }, { lat: 45, lng: 20 }, { lat: 45, lng: 25 }, { lat: 45, lng: 30 }, { lat: 45, lng: 35 }, { lat: 45, lng: 40 }, { lat: 45, lng: 45 }, { lat: 45, lng: 50 }, { lat: 45, lng: 55 }, { lat: 45, lng: 60 }, { lat: 45, lng: 65 }, { lat: 45, lng: 70 }, { lat: 45, lng: 75 }, { lat: 45, lng: 80 }, { lat: 45, lng: 85 },
  { lat: 40, lng: -10 }, { lat: 40, lng: -5 }, { lat: 40, lng: 0 }, { lat: 40, lng: 5 }, { lat: 40, lng: 10 }, { lat: 40, lng: 15 }, { lat: 40, lng: 20 }, { lat: 40, lng: 25 }, { lat: 40, lng: 30 }, { lat: 40, lng: 35 }, { lat: 40, lng: 40 }, { lat: 40, lng: 45 }, { lat: 40, lng: 50 }, { lat: 40, lng: 55 }, { lat: 40, lng: 60 }, { lat: 40, lng: 65 }, { lat: 40, lng: 70 }, { lat: 40, lng: 75 }, { lat: 40, lng: 80 }, { lat: 40, lng: 85 }, { lat: 40, lng: 90 },
  { lat: 35, lng: -10 }, { lat: 35, lng: -5 }, { lat: 35, lng: 0 }, { lat: 35, lng: 5 }, { lat: 35, lng: 10 }, { lat: 35, lng: 25 }, { lat: 35, lng: 30 }, { lat: 35, lng: 35 }, { lat: 35, lng: 40 }, { lat: 35, lng: 45 }, { lat: 35, lng: 50 }, { lat: 35, lng: 55 }, { lat: 35, lng: 60 }, { lat: 35, lng: 65 }, { lat: 35, lng: 70 }, { lat: 35, lng: 75 }, { lat: 35, lng: 80 }, { lat: 35, lng: 85 }, { lat: 35, lng: 90 }, { lat: 35, lng: 95 }, { lat: 35, lng: 100 }, { lat: 35, lng: 105 }, { lat: 35, lng: 110 }, { lat: 35, lng: 115 }, { lat: 35, lng: 120 }, { lat: 35, lng: 125 }, { lat: 35, lng: 130 }, { lat: 35, lng: 135 }, { lat: 35, lng: 140 },
  
  // Africa
  { lat: 35, lng: -5 }, { lat: 35, lng: 0 }, { lat: 35, lng: 5 }, { lat: 35, lng: 10 },
  { lat: 30, lng: -10 }, { lat: 30, lng: -5 }, { lat: 30, lng: 0 }, { lat: 30, lng: 5 }, { lat: 30, lng: 10 }, { lat: 30, lng: 15 }, { lat: 30, lng: 20 }, { lat: 30, lng: 25 }, { lat: 30, lng: 30 }, { lat: 30, lng: 35 },
  { lat: 25, lng: -15 }, { lat: 25, lng: -10 }, { lat: 25, lng: -5 }, { lat: 25, lng: 0 }, { lat: 25, lng: 5 }, { lat: 25, lng: 10 }, { lat: 25, lng: 15 }, { lat: 25, lng: 20 }, { lat: 25, lng: 25 }, { lat: 25, lng: 30 }, { lat: 25, lng: 35 },
  { lat: 20, lng: -17 }, { lat: 20, lng: -10 }, { lat: 20, lng: -5 }, { lat: 20, lng: 0 }, { lat: 20, lng: 5 }, { lat: 20, lng: 10 }, { lat: 20, lng: 15 }, { lat: 20, lng: 20 }, { lat: 20, lng: 25 }, { lat: 20, lng: 30 }, { lat: 20, lng: 35 }, { lat: 20, lng: 40 },
  { lat: 15, lng: -17 }, { lat: 15, lng: -10 }, { lat: 15, lng: -5 }, { lat: 15, lng: 0 }, { lat: 15, lng: 5 }, { lat: 15, lng: 10 }, { lat: 15, lng: 15 }, { lat: 15, lng: 20 }, { lat: 15, lng: 25 }, { lat: 15, lng: 30 }, { lat: 15, lng: 35 }, { lat: 15, lng: 40 }, { lat: 15, lng: 45 },
  { lat: 10, lng: -15 }, { lat: 10, lng: -10 }, { lat: 10, lng: -5 }, { lat: 10, lng: 0 }, { lat: 10, lng: 5 }, { lat: 10, lng: 10 }, { lat: 10, lng: 15 }, { lat: 10, lng: 20 }, { lat: 10, lng: 25 }, { lat: 10, lng: 30 }, { lat: 10, lng: 35 }, { lat: 10, lng: 40 }, { lat: 10, lng: 45 },
  { lat: 5, lng: -10 }, { lat: 5, lng: -5 }, { lat: 5, lng: 0 }, { lat: 5, lng: 5 }, { lat: 5, lng: 10 }, { lat: 5, lng: 15 }, { lat: 5, lng: 20 }, { lat: 5, lng: 25 }, { lat: 5, lng: 30 }, { lat: 5, lng: 35 }, { lat: 5, lng: 40 },
  { lat: 0, lng: 10 }, { lat: 0, lng: 15 }, { lat: 0, lng: 20 }, { lat: 0, lng: 25 }, { lat: 0, lng: 30 }, { lat: 0, lng: 35 }, { lat: 0, lng: 40 },
  { lat: -5, lng: 12 }, { lat: -5, lng: 17 }, { lat: -5, lng: 22 }, { lat: -5, lng: 27 }, { lat: -5, lng: 32 }, { lat: -5, lng: 37 }, { lat: -5, lng: 40 },
  { lat: -10, lng: 13 }, { lat: -10, lng: 18 }, { lat: -10, lng: 23 }, { lat: -10, lng: 28 }, { lat: -10, lng: 33 }, { lat: -10, lng: 38 },
  { lat: -15, lng: 15 }, { lat: -15, lng: 20 }, { lat: -15, lng: 25 }, { lat: -15, lng: 30 }, { lat: -15, lng: 35 },
  { lat: -20, lng: 15 }, { lat: -20, lng: 20 }, { lat: -20, lng: 25 }, { lat: -20, lng: 30 }, { lat: -20, lng: 35 }, { lat: -20, lng: 45 },
  { lat: -25, lng: 18 }, { lat: -25, lng: 23 }, { lat: -25, lng: 28 }, { lat: -25, lng: 33 },
  { lat: -30, lng: 20 }, { lat: -30, lng: 25 }, { lat: -30, lng: 30 },
  { lat: -35, lng: 20 }, { lat: -35, lng: 25 },
  
  // Asia
  { lat: 70, lng: 70 }, { lat: 70, lng: 80 }, { lat: 70, lng: 90 }, { lat: 70, lng: 100 }, { lat: 70, lng: 110 }, { lat: 70, lng: 120 }, { lat: 70, lng: 130 }, { lat: 70, lng: 140 }, { lat: 70, lng: 150 }, { lat: 70, lng: 160 }, { lat: 70, lng: 170 },
  { lat: 65, lng: 60 }, { lat: 65, lng: 70 }, { lat: 65, lng: 80 }, { lat: 65, lng: 90 }, { lat: 65, lng: 100 }, { lat: 65, lng: 110 }, { lat: 65, lng: 120 }, { lat: 65, lng: 130 }, { lat: 65, lng: 140 }, { lat: 65, lng: 150 }, { lat: 65, lng: 160 }, { lat: 65, lng: 170 }, { lat: 65, lng: 180 },
  { lat: 60, lng: 60 }, { lat: 60, lng: 70 }, { lat: 60, lng: 80 }, { lat: 60, lng: 90 }, { lat: 60, lng: 100 }, { lat: 60, lng: 110 }, { lat: 60, lng: 120 }, { lat: 60, lng: 130 }, { lat: 60, lng: 140 }, { lat: 60, lng: 150 }, { lat: 60, lng: 160 },
  { lat: 30, lng: 45 }, { lat: 30, lng: 50 }, { lat: 30, lng: 55 }, { lat: 30, lng: 60 }, { lat: 30, lng: 65 }, { lat: 30, lng: 70 }, { lat: 30, lng: 75 }, { lat: 30, lng: 80 }, { lat: 30, lng: 85 }, { lat: 30, lng: 90 }, { lat: 30, lng: 95 }, { lat: 30, lng: 100 }, { lat: 30, lng: 105 }, { lat: 30, lng: 110 }, { lat: 30, lng: 115 }, { lat: 30, lng: 120 },
  { lat: 25, lng: 50 }, { lat: 25, lng: 55 }, { lat: 25, lng: 60 }, { lat: 25, lng: 65 }, { lat: 25, lng: 70 }, { lat: 25, lng: 75 }, { lat: 25, lng: 80 }, { lat: 25, lng: 85 }, { lat: 25, lng: 90 }, { lat: 25, lng: 95 }, { lat: 25, lng: 100 }, { lat: 25, lng: 105 }, { lat: 25, lng: 110 }, { lat: 25, lng: 115 }, { lat: 25, lng: 120 },
  { lat: 20, lng: 70 }, { lat: 20, lng: 75 }, { lat: 20, lng: 80 }, { lat: 20, lng: 85 }, { lat: 20, lng: 90 }, { lat: 20, lng: 95 }, { lat: 20, lng: 100 }, { lat: 20, lng: 105 }, { lat: 20, lng: 110 }, { lat: 20, lng: 115 },
  { lat: 15, lng: 75 }, { lat: 15, lng: 80 }, { lat: 15, lng: 100 }, { lat: 15, lng: 105 }, { lat: 15, lng: 110 },
  { lat: 10, lng: 77 }, { lat: 10, lng: 100 }, { lat: 10, lng: 105 },
  { lat: 5, lng: 80 }, { lat: 5, lng: 100 }, { lat: 5, lng: 105 }, { lat: 5, lng: 115 },
  { lat: 0, lng: 100 }, { lat: 0, lng: 105 }, { lat: 0, lng: 110 }, { lat: 0, lng: 115 }, { lat: 0, lng: 120 }, { lat: 0, lng: 125 }, { lat: 0, lng: 130 },
  { lat: -5, lng: 105 }, { lat: -5, lng: 110 }, { lat: -5, lng: 115 }, { lat: -5, lng: 120 }, { lat: -5, lng: 125 }, { lat: -5, lng: 130 }, { lat: -5, lng: 135 }, { lat: -5, lng: 140 },
  
  // Australia
  { lat: -15, lng: 125 }, { lat: -15, lng: 130 }, { lat: -15, lng: 135 }, { lat: -15, lng: 140 }, { lat: -15, lng: 145 },
  { lat: -20, lng: 115 }, { lat: -20, lng: 120 }, { lat: -20, lng: 125 }, { lat: -20, lng: 130 }, { lat: -20, lng: 135 }, { lat: -20, lng: 140 }, { lat: -20, lng: 145 }, { lat: -20, lng: 150 },
  { lat: -25, lng: 115 }, { lat: -25, lng: 120 }, { lat: -25, lng: 125 }, { lat: -25, lng: 130 }, { lat: -25, lng: 135 }, { lat: -25, lng: 140 }, { lat: -25, lng: 145 }, { lat: -25, lng: 150 }, { lat: -25, lng: 153 },
  { lat: -30, lng: 115 }, { lat: -30, lng: 120 }, { lat: -30, lng: 125 }, { lat: -30, lng: 130 }, { lat: -30, lng: 135 }, { lat: -30, lng: 140 }, { lat: -30, lng: 145 }, { lat: -30, lng: 150 }, { lat: -30, lng: 153 },
  { lat: -35, lng: 117 }, { lat: -35, lng: 135 }, { lat: -35, lng: 140 }, { lat: -35, lng: 145 }, { lat: -35, lng: 150 },
  
  // New Zealand
  { lat: -38, lng: 175 },
  { lat: -42, lng: 172 }, { lat: -42, lng: 175 },
  { lat: -45, lng: 170 },
]

// Key hub locations for network visualization
const hubLocations = [
  { lat: 40.7, lng: -74, name: "New York" },
  { lat: 51.5, lng: -0.1, name: "London" },
  { lat: 35.7, lng: 139.7, name: "Tokyo" },
  { lat: 1.3, lng: 103.8, name: "Singapore" },
  { lat: -33.9, lng: 151.2, name: "Sydney" },
  { lat: 37.4, lng: -122, name: "San Francisco" },
  { lat: 52.5, lng: 13.4, name: "Berlin" },
  { lat: 25.3, lng: 55.3, name: "Dubai" },
]

// Network connections between hubs
const connections = [
  { from: 0, to: 1 }, // NY to London
  { from: 1, to: 6 }, // London to Berlin
  { from: 1, to: 7 }, // London to Dubai
  { from: 0, to: 5 }, // NY to SF
  { from: 5, to: 2 }, // SF to Tokyo
  { from: 2, to: 3 }, // Tokyo to Singapore
  { from: 3, to: 4 }, // Singapore to Sydney
  { from: 3, to: 7 }, // Singapore to Dubai
  { from: 6, to: 2 }, // Berlin to Tokyo
]

function latLngToXY(lat: number, lng: number, width: number, height: number) {
  const x = ((lng + 180) / 360) * width
  const y = ((90 - lat) / 180) * height
  return { x, y }
}

export function WorldMap() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      ctx.scale(dpr, dpr)
      draw(rect.width, rect.height)
    }

    const draw = (width: number, height: number) => {
      ctx.clearRect(0, 0, width, height)

      // Draw connection lines first (behind everything)
      ctx.strokeStyle = "rgba(80, 130, 200, 0.25)"
      ctx.lineWidth = 1

      connections.forEach((conn) => {
        const from = hubLocations[conn.from]
        const to = hubLocations[conn.to]
        const fromPos = latLngToXY(from.lat, from.lng, width, height)
        const toPos = latLngToXY(to.lat, to.lng, width, height)

        ctx.beginPath()
        ctx.moveTo(fromPos.x, fromPos.y)
        
        // Create a curved line
        const midX = (fromPos.x + toPos.x) / 2
        const midY = (fromPos.y + toPos.y) / 2 - 20
        ctx.quadraticCurveTo(midX, midY, toPos.x, toPos.y)
        ctx.stroke()
      })

      // Draw world map dots
      worldCoordinates.forEach((coord) => {
        const { x, y } = latLngToXY(coord.lat, coord.lng, width, height)
        
        ctx.beginPath()
        ctx.arc(x, y, 1.5, 0, Math.PI * 2)
        ctx.fillStyle = "rgba(70, 120, 190, 0.45)"
        ctx.fill()
      })

      // Draw hub markers
      hubLocations.forEach((hub) => {
        const { x, y } = latLngToXY(hub.lat, hub.lng, width, height)

        // Outer ring
        ctx.beginPath()
        ctx.arc(x, y, 8, 0, Math.PI * 2)
        ctx.strokeStyle = "rgba(80, 140, 220, 0.4)"
        ctx.lineWidth = 1
        ctx.stroke()

        // Inner dot
        ctx.beginPath()
        ctx.arc(x, y, 3, 0, Math.PI * 2)
        ctx.fillStyle = "rgba(90, 150, 230, 0.6)"
        ctx.fill()
      })
    }

    resize()
    window.addEventListener("resize", resize)

    return () => window.removeEventListener("resize", resize)
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full"
      style={{ display: "block" }}
      aria-label="Interactive world map showing global network connectivity points"
    />
  )
}
