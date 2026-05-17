import { NextRequest, NextResponse } from "next/server"

const BACKEND_INTERNAL_URL = (process.env.BACKEND_INTERNAL_URL ?? "http://localhost:8000").replace(/\/$/, "")

export async function POST(request: NextRequest) {
  const body = await request.text()

  const backendResponse = await fetch(`${BACKEND_INTERNAL_URL}/api/v1/analyze-site`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body,
  })

  if (!backendResponse.body) {
    return NextResponse.json(
      { detail: "Backend analiz akışı okunamadı." },
      { status: backendResponse.status || 502 },
    )
  }

  return new NextResponse(backendResponse.body, {
    status: backendResponse.status,
    headers: {
      "Content-Type": backendResponse.headers.get("Content-Type") ?? "text/event-stream",
      "Cache-Control": backendResponse.headers.get("Cache-Control") ?? "no-cache",
      Connection: backendResponse.headers.get("Connection") ?? "keep-alive",
      "X-Accel-Buffering": backendResponse.headers.get("X-Accel-Buffering") ?? "no",
    },
  })
}
