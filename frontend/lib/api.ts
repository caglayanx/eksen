import type {
  AnalysisResult,
  ElevationResponse,
  HealthcheckResponse,
  SiteAnalysisRequest,
  SSEErrorMessage,
  SSELogMessage,
} from "@/lib/types"

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000").replace(/\/$/, "")
const DEFAULT_TIMEOUT_MS = 10_000
const ANALYSIS_TIMEOUT_MS = 120_000

export type AnalysisCallbacks = {
  onLog?: (message: string) => void
  onResult?: (result: AnalysisResult) => void
  onError?: (error: string) => void
  onDone?: () => void
}

function getErrorMessage(status: number, fallback: string) {
  if (status === 400) {
    return "Seçilen lokasyon projenin kapsadığı 10 hedef ülke dışında."
  }
  if (status === 422) {
    return "Geçersiz koordinat veya analiz isteği."
  }
  if (status === 500) {
    return "Analiz sırasında beklenmedik bir sunucu hatası oluştu."
  }
  if (status === 503) {
    return "Google servisleri veya analiz servisi geçici olarak yanıt vermiyor."
  }
  return fallback
}

async function fetchJson<T>(url: string, init?: RequestInit, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    })

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { detail?: string } | null
      throw new Error(payload?.detail ?? getErrorMessage(response.status, "API isteği başarısız oldu."))
    }

    return (await response.json()) as T
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("İstek zaman aşımına uğradı.")
    }
    if (error instanceof TypeError) {
      throw new Error("Backend sunucusuna bağlanılamadı. Sunucunun çalıştığını kontrol edin.")
    }
    throw error
  } finally {
    window.clearTimeout(timeout)
  }
}

export function fetchElevation(lat: number, lng: number) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
  })

  return fetchJson<ElevationResponse>(`${API_BASE_URL}/api/v1/elevation?${params.toString()}`)
}

export function healthCheck() {
  return fetchJson<HealthcheckResponse>(`${API_BASE_URL}/health`)
}

function parseSSEMessage(message: string) {
  const eventLine = message.split("\n").find((line) => line.startsWith("event: "))
  const dataLine = message.split("\n").find((line) => line.startsWith("data: "))

  if (!dataLine) {
    return null
  }

  return {
    event: eventLine?.replace("event: ", "").trim() ?? "message",
    data: JSON.parse(dataLine.replace("data: ", "")) as SSELogMessage | SSEErrorMessage | AnalysisResult,
  }
}

export function analyzeSite(request: SiteAnalysisRequest, callbacks: AnalysisCallbacks): AbortController {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => {
    controller.abort()
    callbacks.onError?.("Analiz zaman aşımına uğradı. Lütfen tekrar deneyin.")
    callbacks.onDone?.()
  }, ANALYSIS_TIMEOUT_MS)

  void (async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/analyze-site`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      })

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { detail?: string } | null
        callbacks.onError?.(payload?.detail ?? getErrorMessage(response.status, "Saha analizi başlatılamadı."))
        callbacks.onDone?.()
        return
      }

      if (!response.body) {
        callbacks.onError?.("Analiz akışı okunamadı.")
        callbacks.onDone?.()
        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }

        buffer += decoder.decode(value, { stream: true })
        const messages = buffer.split("\n\n")
        buffer = messages.pop() ?? ""

        for (const message of messages) {
          const parsed = parseSSEMessage(message)
          if (!parsed) {
            continue
          }

          if (parsed.event === "done") {
            callbacks.onDone?.()
            continue
          }

          if ("type" in parsed.data && parsed.data.type === "log") {
            callbacks.onLog?.(parsed.data.message)
            continue
          }

          if ("status" in parsed.data && parsed.data.status === "error") {
            callbacks.onError?.(parsed.data.detail)
            continue
          }

          if ("status" in parsed.data && parsed.data.status === "success") {
            callbacks.onResult?.(parsed.data)
          }
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        callbacks.onError?.("Analiz iptal edildi veya zaman aşımına uğradı.")
      } else if (error instanceof TypeError) {
        callbacks.onError?.("Backend sunucusuna bağlanılamadı. Sunucunun çalıştığını kontrol edin.")
      } else {
        callbacks.onError?.(error instanceof Error ? error.message : "Analiz sırasında hata oluştu.")
      }
    } finally {
      window.clearTimeout(timeout)
      callbacks.onDone?.()
    }
  })()

  return controller
}
