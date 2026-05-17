import { NextRequest, NextResponse } from "next/server"

const BACKEND_DOWNLOAD_PDF_URL = "http://127.0.0.1:8000/api/v1/download-pdf"

export async function POST(request: NextRequest) {
  const body = await request.text()

  const backendResponse = await fetch(BACKEND_DOWNLOAD_PDF_URL, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/pdf",
    },
    body,
  })

  if (!backendResponse.ok) {
    const detail = await backendResponse.text().catch(() => "PDF sunucudan alınamadı.")
    return NextResponse.json({ detail }, { status: backendResponse.status || 502 })
  }

  const blob = await backendResponse.blob()

  return new NextResponse(blob, {
    status: 200,
    headers: {
      "Content-Type": backendResponse.headers.get("Content-Type") ?? "application/pdf",
      "Content-Disposition":
        backendResponse.headers.get("Content-Disposition") ??
        `attachment; filename="EKSEN_Master_Analiz_Raporu_${new Date().toISOString().split("T")[0]}.pdf"`,
      "Cache-Control": "no-store",
    },
  })
}
