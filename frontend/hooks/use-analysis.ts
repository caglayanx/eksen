"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import { analyzeSite } from "@/lib/api"
import type { AnalysisProgress, AnalysisResult, AnalysisStatus, SiteAnalysisRequest } from "@/lib/types"

function detectProgress(message: string, elapsed: number): AnalysisProgress {
  const normalized = message.toLocaleLowerCase("tr-TR")

  if (
    normalized.includes("rapor") ||
    normalized.includes("ajan 3") ||
    normalized.includes("master") ||
    normalized.includes("birleştir") ||
    normalized.includes("birlestir")
  ) {
    return { step: 3, message: "Master rapor oluşturuluyor", elapsed }
  }

  if (
    normalized.includes("fizibilite") ||
    normalized.includes("ajan 2") ||
    normalized.includes("mühendis") ||
    normalized.includes("muhendis")
  ) {
    return { step: 2, message: "Fizibilite hesaplaması yapılıyor", elapsed }
  }

  if (
    normalized.includes("regülasyon") ||
    normalized.includes("regulasyon") ||
    normalized.includes("ajan 1") ||
    normalized.includes("arama_araci")
  ) {
    return { step: 1, message: "Regülasyon analizi yapılıyor", elapsed }
  }

  if (
    normalized.includes("ülke tespit") ||
    normalized.includes("ulke tespit") ||
    normalized.includes("geocoding") ||
    normalized.includes("elevation")
  ) {
    return { step: 0, message: "Konum doğrulanıyor", elapsed }
  }

  return { step: 0, message, elapsed }
}

function describeError(error: string) {
  const normalized = error.toLocaleLowerCase("tr-TR")

  if (normalized.includes("kapsadığı 10 hedef ülke") || normalized.includes("kapsadigi 10 hedef ulke")) {
    return {
      title: "Desteklenmeyen Bölge",
      description: "Seçilen lokasyon projenin kapsadığı 10 hedef ülke dışında.",
    }
  }

  if (normalized.includes("zaman aş") || normalized.includes("zaman as")) {
    return {
      title: "Zaman Aşımı",
      description: "Analiz 120 saniyede tamamlanamadı. Lütfen tekrar deneyin.",
    }
  }

  if (normalized.includes("bağlanılamadı") || normalized.includes("baglanilamadi")) {
    return {
      title: "Bağlantı Hatası",
      description: "Backend sunucusuna bağlanılamadı. Sunucunun çalıştığını kontrol edin.",
    }
  }

  if (normalized.includes("503") || normalized.includes("servis")) {
    return {
      title: "Servis Kullanılamıyor",
      description: "Google servisleri veya analiz servisi geçici olarak yanıt vermiyor.",
    }
  }

  return {
    title: "Analiz Hatası",
    description: error,
  }
}

export function useAnalysis() {
  const [status, setStatus] = useState<AnalysisStatus>("idle")
  const [logs, setLogs] = useState<string[]>([])
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<AnalysisProgress | null>(null)
  const [startTime, setStartTime] = useState<number | null>(null)
  const [elapsed, setElapsed] = useState(0)

  const abortControllerRef = useRef<AbortController | null>(null)
  const intervalRef = useRef<number | null>(null)
  const startTimeRef = useRef<number | null>(null)

  const clearTimer = useCallback(() => {
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  const resetAnalysis = useCallback(() => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    clearTimer()
    startTimeRef.current = null
    setStatus("idle")
    setLogs([])
    setResult(null)
    setError(null)
    setProgress(null)
    setStartTime(null)
    setElapsed(0)
  }, [clearTimer])

  const cancelAnalysis = useCallback(() => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    clearTimer()
    setStatus("idle")
    setProgress(null)
    toast.warning("Analiz iptal edildi", {
      description: "Devam eden analiz akışı durduruldu.",
    })
  }, [clearTimer])

  const startAnalysis = useCallback(
    (request: SiteAnalysisRequest) => {
      abortControllerRef.current?.abort()
      clearTimer()

      const startedAt = performance.now()
      startTimeRef.current = startedAt
      setStartTime(startedAt)
      setElapsed(0)
      setStatus("connecting")
      setLogs([])
      setResult(null)
      setError(null)
      setProgress({ step: 0, message: "Backend bağlantısı kuruluyor", elapsed: 0 })

      intervalRef.current = window.setInterval(() => {
        if (startTimeRef.current === null) {
          return
        }
        setElapsed((performance.now() - startTimeRef.current) / 1000)
      }, 100)

      abortControllerRef.current = analyzeSite(request, {
        onLog: (message) => {
          const currentElapsed =
            startTimeRef.current === null ? 0 : (performance.now() - startTimeRef.current) / 1000
          setStatus("streaming")
          setLogs((currentLogs) => [...currentLogs, message])
          setProgress(detectProgress(message, currentElapsed))
        },
        onResult: (nextResult) => {
          const currentElapsed =
            startTimeRef.current === null ? 0 : (performance.now() - startTimeRef.current) / 1000
          setResult(nextResult)
          setStatus("completed")
          setProgress({ step: 3, message: "Analiz tamamlandı", elapsed: currentElapsed })
          toast.success("Analiz Tamamlandı", {
            description: "Rapor gösterime hazır.",
          })
        },
        onError: (nextError) => {
          const errorInfo = describeError(nextError)
          setError(nextError)
          setStatus("error")
          setProgress(null)
          if (errorInfo.title === "Zaman Aşımı") {
            toast.warning(errorInfo.title, { description: errorInfo.description })
          } else {
            toast.error(errorInfo.title, { description: errorInfo.description })
          }
        },
        onDone: () => {
          clearTimer()
        },
      })
    },
    [clearTimer],
  )

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort()
      clearTimer()
    }
  }, [clearTimer])

  return {
    status,
    logs,
    result,
    error,
    progress,
    startTime,
    elapsed,
    startAnalysis,
    cancelAnalysis,
    resetAnalysis,
  }
}
