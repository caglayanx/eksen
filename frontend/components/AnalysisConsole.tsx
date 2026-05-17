"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Download, FileText, Loader2, Radio, Satellite, Shield, TerminalSquare } from "lucide-react"
import { toast } from "sonner"

import { MarkdownRenderer } from "@/components/markdown"
import type { AnalysisResult, SiteAnalysisRequest } from "@/lib/types"
import { cn } from "@/lib/utils"

type ConsoleStatus = "dual" | "merging" | "single" | "done"

type LocationSnapshot = {
  country: string
  city?: string | null
  province?: string | null
  regionLabel?: string | null
  lat: number
  lng: number
  elevation: number
}

type AnalysisConsoleProps = {
  location?: LocationSnapshot
  request?: SiteAnalysisRequest
  className?: string
  onBack?: () => void
  onFatalError?: (message: string) => void
}

type TerminalPaneProps = {
  title: string
  subtitle: string
  icon: React.ReactNode
  text: string
  tone: "green" | "blue" | "cyan"
  isStreaming?: boolean
  className?: string
  scrollRef?: React.RefObject<HTMLDivElement | null>
}

const ANSI_ESCAPE_RE = /\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g
const ANSI_COLOR_FRAGMENT_RE = /\[[0-9;]{1,4}m/g
const FRAME_LINE_RE = /^[\s╭╰╯╮│─┌┐└┘═║╔╗╚╝╠╣╦╩╬]+$/

const defaultLocation: LocationSnapshot = {
  country: "KUZEY IRAK",
  city: "Erbil",
  province: "Erbil",
  regionLabel: "Erbil Sınır Bölgesi",
  lat: 36.19,
  lng: 44.01,
  elevation: 412,
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function defaultRequestFromLocation(location: LocationSnapshot): SiteAnalysisRequest {
  return {
    latitude: location.lat,
    longitude: location.lng,
    elevation: location.elevation,
    personnel_count: 50,
    data_profile: "anlık veri akışı",
  }
}

function sanitizeIncomingText(text: string) {
  return text
    .replace(ANSI_ESCAPE_RE, "")
    .replace(ANSI_COLOR_FRAGMENT_RE, "")
    .split("\n")
    .filter((line) => !FRAME_LINE_RE.test(line.trim()))
    .join("\n")
}

function resolveTokenAgent(agent: string | undefined, token: string) {
  if (agent === "agent1" || token.includes("[A1]")) {
    return "agent1"
  }
  if (agent === "agent2" || token.includes("[A2]")) {
    return "agent2"
  }
  if (agent === "agent3" || token.includes("[A3]")) {
    return "agent3"
  }
  return null
}

function normalizeMasterReportText(text: string) {
  return text
    .replace(/[\u0600-\u06FF\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF]+/g, "")
    .replace(/\b(ve|ile)(?=[A-ZÇĞİÖŞÜ])/g, "$1 ")
    .replace(/\b(ve|ile)_+([A-Za-zÇĞİÖŞÜçğıöşü]+)/g, "$1 $2")
    .replace(/\n?\s*RAPORU\s+TEKN[İI]K\s+RAPOR[\s\S]*$/gi, "")
    .replaceAll("Oneri", "Öneri")
    .replaceAll("ONERI", "ÖNERİ")
    .replaceAll("Ozet", "Özet")
    .replaceAll("OZET", "ÖZET")
    .replaceAll("Cozum", "Çözüm")
    .replaceAll("COZUM", "ÇÖZÜM")
    .replaceAll("Cosullari", "Koşulları")
    .replaceAll("Kosullari", "Koşulları")
    .replaceAll("Hava Kosullari", "Hava Koşulları")
    .replaceAll("Bant Genisligi", "Bant Genişliği")
    .replaceAll("Bolge", "Bölge")
    .replaceAll("bolge", "bölge")
    .replaceAll("satelliitler", "Uydu Şebekeleri")
    .replaceAll("dezaneteler", "Dezavantajlar")
    .replaceAll("Mimarilik", "Mimari Tipi")
    .replaceAll("Komponent", "Bileşen")
    .replaceAll("komponent", "bileşen")
    .replaceAll("Bilesen", "Bileşen")
    .replaceAll("Hazirlanmis", "Hazırlanmış")
    .replaceAll("Sekilde", "Şekilde")
}

function splitSelectedOption(content: string) {
  const normalized = content.trim()
  const lines = normalized.split(/\r?\n/)
  const firstMeaningfulLineIndex = lines.findIndex((line) => line.trim().length > 0)

  if (firstMeaningfulLineIndex === -1) {
    return { selectedOption: null, reportBody: normalized }
  }

  const firstLine = lines[firstMeaningfulLineIndex].trim()
  const optionMatch = firstLine.match(/^\*{0,2}SEÇİLEN OPSİYON\s*:\s*(.+?)\*{0,2}$/i)

  if (!optionMatch) {
    return { selectedOption: null, reportBody: normalized }
  }

  const remainingLines = [
    ...lines.slice(0, firstMeaningfulLineIndex),
    ...lines.slice(firstMeaningfulLineIndex + 1),
  ]

  return {
    selectedOption: `SEÇİLEN OPSİYON: ${optionMatch[1].replace(/\*+/g, "").trim()}`,
    reportBody: remainingLines.join("\n").trim(),
  }
}

function getLocalFallbackContext(location: LocationSnapshot) {
  const regionLabel = location.regionLabel ?? location.province ?? `${location.country} Bölgesi`
  const isInterior = regionLabel.includes("İç Altyapı") || regionLabel.includes("Stratejik Sanayi")
  const isTurkiye = location.country.toLocaleLowerCase("tr-TR").includes("türkiye")
  const primaryProvider = isTurkiye ? "TÜRKSAT GEO VSAT" : "EUTELSAT / INTELSAT BÖLGESEL GEO OMURGA"
  const missionContext = isInterior
    ? "Merkezi Altyapı Redundancy ve Stratejik İletişim Güvenliği"
    : "Bölgesel haberleşme sürekliliği ve taktik yedek erişim güvenliği"
  const protectionFocus = isInterior
    ? "karasal hatların çökmesine karşı merkezi yedekleme"
    : "saha haberleşme sürekliliği"

  return {
    regionLabel,
    primaryProvider,
    missionContext,
    protectionFocus,
    installCost: isInterior ? "8.000 - 12.000 USD" : "8.000 - 12.000 USD",
    threeYearTco: isInterior ? "45.000 - 75.000 USD" : "50.000 - 75.000 USD",
  }
}

function buildLocalFallbackReport(location: LocationSnapshot) {
  const context = getLocalFallbackContext(location)

  return `**SEÇİLEN OPSİYON: ${context.primaryProvider} ANA OMURGA + 120 CM C/KU-BAND ANTEN + IDIRECT 9000 MODEM + REGÜLASYONA UYGUN YEDEK ERİŞİMLİ HİBRİT MİMARİ**

## Güvenlik ve Regülasyon Analizi Raporu - ${context.regionLabel}

### 1. YÖNETİCİ ÖZETİ
**Konum / Bölge:** ${context.regionLabel}

Sunucu hatası veya kota sınırı nedeniyle kurşungeçirmez yerel protokol devreye alınmıştır. Bu rapor seçilen koordinat ve bölge bağlamından dinamik olarak üretilmiştir. Görev bağlamı: **${context.missionContext}**.

Bu saha için en dengeli çözüm, ${context.primaryProvider} ana omurgası, C/Ku-band dayanıklılığına sahip 120 cm sınıfı anten, iDirect 9000 modem ve ${context.protectionFocus} için yapılandırılmış hibrit yedek erişim mimarisidir.

### 2. KARŞILAŞTIRMALI MİMARİ TABLOSU
| Mimari Tipi | Güçlü Yön | Risk | Uygunluk |
| --- | --- | --- | --- |
| **GEO VSAT (${context.primaryProvider})** | Kararlı kapsama ve kurumsal veri güvenliği omurgası | Yüksek gecikme | **Kritik / Birincil** |
| **Yedek Erişim Hattı** | Hızlı bypass ve alternatif taşıyıcı esnekliği | Regülasyon ve servis sürekliliği kontrolü gerekir | Yardımcı |
| **Hibrit Mimari** | Karasal çöküşlerde görev sürekliliği | Yüksek CAPEX | **En Optimum** |

### 3. MALİYET ANALİZİ VE 3 YILLIK TCO
| Yatırım Kalemi | Tahmini Maliyet (USD) |
| --- | ---: |
| 120 cm C/Ku-band anten ve endüstriyel RF ekipman grubu | ${context.installCost} |
| iDirect 9000 modem ve kriptolu ağ bileşenleri | 4.000 - 7.000 USD |
| 3 yıllık operasyonel servis, bakım ve SLA TCO | ${context.threeYearTco} |

### 4. NİHAİ ÖNERİ VE UYGULAMA YOL HARİTASI
1. **1. Ay:** Frekans koordinasyonu, BTK/regülasyon analizi ve saha keşfi tamamlanmalıdır.
2. **2. Ay:** ${context.primaryProvider} ana terminal montajı ve yönlendirici entegrasyonu yapılmalıdır.
3. **3. Ay:** Karasal hat kesinti senaryoları ve otomatik yük devretme validasyonu tamamlanmalıdır.

Nihai öneri: ${context.primaryProvider} ana omurgalı hibrit mimari, ${context.protectionFocus} amacıyla uygulanmalıdır.`
}

function parseSSEMessage(message: string) {
  const eventLine = message.split("\n").find((line) => line.startsWith("event: "))
  const dataLine = message.split("\n").find((line) => line.startsWith("data: "))

  if (!dataLine) {
    return null
  }

  return {
    event: eventLine?.replace("event: ", "").trim() ?? "message",
    data: JSON.parse(dataLine.replace("data: ", "")) as {
      agent?: "system" | "agent1" | "agent2" | "agent3"
      token?: string
      phase?: "merge"
      result?: AnalysisResult
      detail?: string
    },
  }
}

function TerminalPane({ title, subtitle, icon, text, tone, isStreaming, className, scrollRef }: TerminalPaneProps) {
  const toneClass = {
    green: "text-[#00BFFF]",
    blue: "text-[#00BFFF]",
    cyan: "text-[#00BFFF]",
  }[tone]

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 18, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -20, scale: 0.88, filter: "blur(6px)" }}
      transition={{ duration: 0.45, ease: "easeOut" }}
      className={cn(
        "overflow-hidden rounded-2xl border border-blue-300/15 bg-[#02050a] shadow-[0_20px_80px_rgba(0,0,0,0.55)]",
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-blue-300/10 bg-blue-400/[0.035] px-4 py-3">
        <div className="flex items-center gap-3">
          <div className={cn("flex size-9 items-center justify-center rounded-xl border border-blue-300/10 bg-black/30", toneClass)}>
            {icon}
          </div>
          <div>
            <p className="font-mono text-sm font-semibold tracking-[0.18em] text-blue-100">{title}</p>
            <p className="mt-0.5 text-xs text-blue-100/45">{subtitle}</p>
          </div>
        </div>
        {isStreaming && <Loader2 className={cn("size-4 animate-spin", toneClass)} />}
      </div>

      <div
        ref={scrollRef}
        className="max-h-[55vh] min-h-[340px] overflow-y-auto whitespace-pre-wrap break-words p-4 font-mono text-xs leading-6 text-[#00BFFF]"
      >
        {text || <span className="text-blue-400/45">Bağlantı bekleniyor...</span>}
        {isStreaming && (
          <span className={cn("inline-block h-4 w-2 animate-pulse rounded-sm bg-current align-middle", toneClass)} />
        )}
      </div>
    </motion.div>
  )
}

export function AnalysisConsole({ location = defaultLocation, request, className, onBack, onFatalError }: AnalysisConsoleProps) {
  const [status, setStatus] = useState<ConsoleStatus>("dual")
  const [agentOneText, setAgentOneText] = useState("")
  const [agentTwoText, setAgentTwoText] = useState("")
  const [synthText, setSynthText] = useState("")
  const [reportContent, setReportContent] = useState("")
  const [isExporting, setIsExporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [completedAgents, setCompletedAgents] = useState<Record<"agent1" | "agent2" | "agent3", boolean>>({
    agent1: false,
    agent2: false,
    agent3: false,
  })
  const reportRef = useRef<HTMLDivElement | null>(null)
  const finalSectionRef = useRef<HTMLDivElement | null>(null)
  const agentOneScrollRef = useRef<HTMLDivElement | null>(null)
  const agentTwoScrollRef = useRef<HTMLDivElement | null>(null)
  const synthScrollRef = useRef<HTMLDivElement | null>(null)

  const headerLocation = useMemo(
    () => {
      const regionLabel = location.regionLabel ?? location.province ?? `${location.country} Bölgesi`
      const regionPrefix = regionLabel.includes("İç Altyapı") ? "Bölge / Konum" : "Sınır / Bölge"
      return `Ülke: ${location.country.toUpperCase()} | ${regionPrefix}: ${regionLabel} | Koordinat: ${location.lat.toFixed(2)}, ${location.lng.toFixed(
          2,
        )} | Rakım: ${Math.round(location.elevation)}m`
    },
    [location.country, location.elevation, location.lat, location.lng, location.province, location.regionLabel],
  )

  const finalReportContent = normalizeMasterReportText(reportContent.trim() ? reportContent : synthText)
  const { selectedOption, reportBody } = useMemo(
    () => splitSelectedOption(finalReportContent),
    [finalReportContent],
  )
  const canDownloadPdf = status === "done" && completedAgents.agent3 && finalReportContent.trim().length > 0

  const recoverToSelection = useCallback((message: string) => {
    console.error("[AnalysisConsole] Tactical analysis stream failed:", message)
    toast.error("Taktiksel analiz hatası", {
      description: message,
    })
    setStatus("dual")
    setCompletedAgents({ agent1: true, agent2: true, agent3: true })
    window.setTimeout(() => {
      if (onBack) {
        onBack()
        return
      }
      onFatalError?.(message)
    }, 3000)
  }, [onBack, onFatalError])

  useEffect(() => {
    agentOneScrollRef.current?.scrollTo({
      top: agentOneScrollRef.current.scrollHeight,
      behavior: "smooth",
    })
  }, [agentOneText])

  useEffect(() => {
    agentTwoScrollRef.current?.scrollTo({
      top: agentTwoScrollRef.current.scrollHeight,
      behavior: "smooth",
    })
  }, [agentTwoText])

  useEffect(() => {
    synthScrollRef.current?.scrollTo({
      top: synthScrollRef.current.scrollHeight,
      behavior: "smooth",
    })
  }, [synthText])

  useEffect(() => {
    if (status === "done") {
      setProgress(100)
      return
    }

    const target = status === "single" ? 100 : status === "merging" ? 85 : 60
    const interval = window.setInterval(() => {
      setProgress((current) => {
        if (current >= target) {
          return current
        }
        const step = status === "single" ? 3 : status === "merging" ? 5 : 10
        return Math.min(current + step, target)
      })
    }, 1000)

    return () => window.clearInterval(interval)
  }, [status])

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()

    async function runRealAnalysis() {
      setStatus("dual")
      setProgress(10)
      setAgentOneText(
        "[SYS] Ajan 1 terminali aktif. Regülasyon kanalı açıldı.\n[A1] Sinyal taranıyor, kapsama ve uluslararası lisans verileri analiz ediliyor...\n[SYS] BTK ve global spektrum veri tabanına bağlanılıyor...\n",
      )
      setAgentTwoText(
        "[SYS] Ajan 2 terminali aktif. Fizibilite kanalı açıldı.\n[A2] Topografya, donanım matrisi ve CAPEX/OPEX hesaplamaları başlatıldı...\n[SYS] Mikron-coğrafi arazi ve rakım verileri çekiliyor...\n",
      )
      setSynthText("")
      setReportContent("")
      setCompletedAgents({ agent1: false, agent2: false, agent3: false })

      const activateLocalFallback = async (reason: string) => {
        if (cancelled) {
          return
        }

        console.warn("[EKSEN] Sunucu hatası veya kota sınırı. Kurşungeçirmez Yerel Protokol aktif.", reason)
        const fallbackReport = buildLocalFallbackReport(location)

        setAgentOneText((current) => current + `[SYS] Yerel güvenli protokol aktif: ${reason}\n`)
        setAgentTwoText((current) => current + "[SYS] Dinamik yerel fizibilite profili oluşturuldu.\n")
        setSynthText(fallbackReport)
        setReportContent(fallbackReport)
        setCompletedAgents({ agent1: true, agent2: true, agent3: true })
        setProgress(100)
        setStatus("done")
        toast.warning("Yerel güvenli rapor modu aktif", {
          description: "Backend yanıt veremedi; seçilen bölgeye göre yerel fallback raporu üretildi.",
        })
        await wait(160)
        finalSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
      }

      try {
        const response = await fetch("/api/tactical-analysis", {
          method: "POST",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(request ?? defaultRequestFromLocation(location)),
          signal: controller.signal,
        })

        if (!response.ok || !response.body) {
          const message = `Taktiksel analiz akışı başlatılamadı. HTTP ${response.status}`
          setAgentOneText((current) => current + `[SYS] ${message}\n`)
          setAgentTwoText((current) => current + `[SYS] ${message}\n`)
          await activateLocalFallback(message)
          return
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""
        let receivedResult = false
        let receivedAgentThreeToken = false

        while (true) {
          let readResult: ReadableStreamReadResult<Uint8Array>
          try {
            readResult = await reader.read()
          } catch (streamError) {
            console.warn("[AnalysisConsole] Soket kesintisi yakalandı, eldeki veriler korunuyor.", streamError)
            break
          }

          const { done, value } = readResult
          if (done) {
            break
          }

          buffer += decoder.decode(value, { stream: true })
          const messages = buffer.split("\n\n")
          buffer = messages.pop() ?? ""

          for (const message of messages) {
            const parsed = parseSSEMessage(message)
            if (!parsed || cancelled) {
              continue
            }

            if (parsed.event === "error") {
              const message = parsed.data.detail ?? "Taktiksel analiz sırasında hata oluştu."
              setAgentOneText((current) => current + `[ERR] ${message}\n`)
              setAgentTwoText((current) => current + `[ERR] ${message}\n`)
              console.warn("[AnalysisConsole] SSE hata event'i alındı, mevcut terminal durumu korunuyor:", message)
              if (!receivedResult && !receivedAgentThreeToken) {
                await activateLocalFallback(message)
                return
              }
              continue
            }

            if (parsed.event === "phase" && parsed.data.phase === "merge") {
              setProgress(85)
              setStatus("merging")
              await wait(900)
              if (!cancelled) {
                setStatus("single")
              }
              continue
            }

            if (parsed.event === "agent_done" && parsed.data.agent) {
              setCompletedAgents((current) => {
                if (parsed.data.agent === "agent1") {
                  return { ...current, agent1: true }
                }
                if (parsed.data.agent === "agent2") {
                  return { ...current, agent2: true }
                }
                if (parsed.data.agent === "agent3") {
                  return { ...current, agent3: true }
                }
                return current
              })
              continue
            }

            if (parsed.event === "result" && parsed.data.result) {
              const master = parsed.data.result.results.master_report
              receivedResult = true
              setReportContent(master)
              setCompletedAgents((current) => ({
                ...current,
                agent3: true,
              }))
              continue
            }

            if (parsed.event === "done") {
              continue
            }

            if (parsed.data.token) {
              const token = sanitizeIncomingText(parsed.data.token)
              if (!token) {
                continue
              }
              const tokenAgent = resolveTokenAgent(parsed.data.agent, token)

              if (tokenAgent === "agent1") {
                setAgentOneText((current) => current + token)
              } else if (tokenAgent === "agent2") {
                setAgentTwoText((current) => current + token)
              } else if (tokenAgent === "agent3") {
                receivedAgentThreeToken = true
                setProgress((current) => Math.max(current, 95))
                setSynthText((current) => current + token)
                setReportContent((current) => current + token)
              } else {
                setAgentOneText((current) => current + token)
              }
            }
          }
        }

        if (cancelled) return
        if (!receivedResult && !receivedAgentThreeToken && !reportContent.trim()) {
          await activateLocalFallback("Backend stream boş tamamlandı.")
          return
        }
        setProgress(100)
        setStatus("done")
        await wait(160)
        finalSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
      } catch (error) {
        if (!cancelled && !(error instanceof DOMException && error.name === "AbortError")) {
          const message = error instanceof Error ? error.message : "SSE akışı okunamadı."
          setAgentOneText((current) => current + `[ERR] ${message}\n`)
          setAgentTwoText((current) => current + `[ERR] ${message}\n`)
          await activateLocalFallback(message)
        }
      }
    }

    void runRealAnalysis()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [location, request, recoverToSelection])

  const downloadPDF = async () => {
    if (!canDownloadPdf) {
      toast.error("PDF hazır değil", { description: "Nihai master rapor tamamlandıktan sonra tekrar deneyin." })
      return
    }

    const reportText = finalReportContent
    const currentMetadata = {
      country: location.country,
      regionLabel: location.regionLabel ?? location.province ?? `${location.country} Sınır Bölgesi`,
      latitude: location.lat,
      longitude: location.lng,
      elevation: location.elevation,
      selectedOption,
    }

    setIsExporting(true)
    toast.loading("PDF Raporu hazırlanıyor...", { id: "pdf-download" })

    try {
      const response = await fetch("/api/v1/download-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          analysisId: `eksen-${Date.now()}`,
          report: reportText,
          text: reportText,
          metadata: currentMetadata,
        }),
      })

      if (!response.ok) {
        throw new Error("Backend PDF motoru yanıt vermedi, tarayıcı baskı moduna geçiliyor.")
      }

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = `EKSEN_Master_Analiz_Raporu_${new Date().toISOString().split("T")[0]}.pdf`
      document.body.appendChild(anchor)
      anchor.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(anchor)

      toast.success("PDF başarıyla indirildi!", { id: "pdf-download" })
    } catch (error) {
      console.warn(
        "[AnalysisConsole] Backend PDF motoru es geçildi, Tarayıcı Baskı Modu (Fallback) tetikleniyor.",
        error,
      )

      const reportElement = document.getElementById("report-content-id")
      const printWindow = window.open("", "_blank", "noopener,noreferrer")

      if (!printWindow) {
        toast.error("PDF baskı penceresi açılamadı.", {
          id: "pdf-download",
          description: "Tarayıcı açılır pencere engelini kapatıp tekrar deneyin.",
        })
        return
      }

      const escapeHtml = (value: string) =>
        value
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;")
          .replaceAll("'", "&#039;")

      const reportHtml =
        reportElement?.innerHTML ??
        `<pre class="plain-report">${escapeHtml(reportText || "Rapor verisi yüklenemedi.")}</pre>`
      const safeSelectedOption = selectedOption ? escapeHtml(selectedOption) : null

      printWindow.document.write(`<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>EKSEN Master Analiz Raporu</title>
    <style>
      @page { size: A4; margin: 16mm; }
      * { box-sizing: border-box; }
      body { font-family: Arial, Helvetica, sans-serif; padding: 0; color: #1a202c; line-height: 1.6; background: #ffffff; }
      .header { background: #1a202c; color: #ffffff; padding: 20px; margin-bottom: 20px; border-radius: 10px; }
      .header h1 { margin: 0 0 8px; font-size: 24px; letter-spacing: 0.04em; }
      .header p { margin: 0; color: #e2e8f0; }
      .metadata { margin: 0 0 18px; padding: 12px 14px; border: 1px solid #cbd5e0; border-radius: 8px; background: #f7fafc; font-size: 12px; color: #2d3748; }
      .badge { background: #ebf8ff; color: #2b6cb0; border: 1px solid #bee3f8; border-radius: 8px; padding: 12px 14px; font-weight: 700; margin-bottom: 20px; }
      #print-report-root { color: #1a202c; }
      #print-report-root div { box-shadow: none !important; filter: none !important; }
      h1, h2, h3, h4 { color: #2d3748; page-break-after: avoid; }
      h1 { font-size: 24px; margin: 28px 0 14px; }
      h2 { border-left: 4px solid #3182ce; padding-left: 10px; font-size: 19px; margin: 26px 0 12px; }
      h3 { font-size: 16px; margin: 18px 0 8px; }
      p, li { font-size: 12px; color: #2d3748; }
      table { width: 100%; border-collapse: collapse; margin: 18px 0; page-break-inside: avoid; font-size: 11px; }
      th { background: #2d3748; color: #ffffff; padding: 9px; text-align: left; }
      td { border: 1px solid #e2e8f0; padding: 9px; color: #2d3748; vertical-align: top; }
      tr:nth-child(even) { background: #f7fafc; }
      pre.plain-report { white-space: pre-wrap; font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #2d3748; }
      .text-\\[\\#00BFFF\\], .text-blue-100, .text-blue-200, .text-blue-50\\/85, .text-\\[\\#dbeafe\\] { color: #2d3748 !important; }
      .bg-\\[\\#05080d\\], .bg-\\[\\#02050a\\], .bg-\\[\\#00BFFF\\]\\/10 { background: transparent !important; }
      .border-\\[\\#00BFFF\\] { border-color: #3182ce !important; }
      @media print {
        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .header, .badge, th { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      }
    </style>
  </head>
  <body>
    <div class="header">
      <h1>EKSEN MASTER ANALİZ RAPORU</h1>
      <p>Taktiksel Uydu Altyapı ve Haberleşme Optimizasyonu</p>
    </div>
    <div class="metadata">
      Ülke: ${escapeHtml(currentMetadata.country)} |
      Bölge: ${escapeHtml(currentMetadata.regionLabel)} |
      Koordinat: ${currentMetadata.latitude.toFixed(4)}, ${currentMetadata.longitude.toFixed(4)} |
      Rakım: ${Math.round(currentMetadata.elevation)}m
    </div>
    ${safeSelectedOption ? `<div class="badge">${safeSelectedOption}</div>` : ""}
    <main id="print-report-root">${reportHtml}</main>
    <script>
      window.onload = function () {
        window.focus();
        window.setTimeout(function () { window.print(); }, 150);
      };
    </script>
  </body>
</html>`)
      printWindow.document.close()
      toast.success("PDF Baskı Profili hazır!", { id: "pdf-download" })
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-[2rem] border border-blue-300/10 bg-[#05080d] p-4 text-blue-50 shadow-[0_30px_120px_rgba(0,0,0,0.55)] md:p-6",
        className,
      )}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(0,145,255,0.16),transparent_28%),radial-gradient(circle_at_80%_10%,rgba(24,255,214,0.08),transparent_26%)]" />
      <div className="relative z-10">
        <div className="sticky top-4 z-20 mb-6 flex flex-col gap-3 rounded-2xl border border-blue-300/15 bg-[#02050a]/90 px-4 py-3 shadow-[0_16px_50px_rgba(0,0,0,0.45)] backdrop-blur md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <Satellite className="size-5 text-[oklch(0.72_0.12_240)]" />
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.28em] text-blue-300/70">EKSEN Tactical Analysis</p>
              <p className="mt-1 font-mono text-sm text-blue-100">{headerLocation}</p>
            </div>
          </div>
          {canDownloadPdf && (
            <button
              type="button"
              onClick={() => void downloadPDF()}
              disabled={isExporting}
              className="inline-flex items-center justify-center gap-2 rounded-full border border-blue-300/20 bg-blue-400/10 px-4 py-2 font-mono text-xs font-semibold text-blue-100 transition hover:border-blue-300/45 hover:bg-blue-400/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isExporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              PDF İndir
            </button>
          )}
        </div>

        <AnimatePresence mode="wait">
          {status === "dual" && (
            <motion.div
              key="dual"
              exit={{ opacity: 0, scale: 0.92, filter: "blur(8px)" }}
              transition={{ duration: 0.55 }}
              className="grid gap-4 lg:grid-cols-2"
            >
              <TerminalPane
                title="AJAN 1"
                subtitle="Regülasyon ve İthalat Analisti"
                icon={<Shield className="size-4" />}
                text={agentOneText}
                tone="green"
                isStreaming={!completedAgents.agent1}
                scrollRef={agentOneScrollRef}
              />
              <TerminalPane
                title="AJAN 2"
                subtitle="Topografya ve Fizibilite Analisti"
                icon={<Radio className="size-4" />}
                text={agentTwoText}
                tone="blue"
                isStreaming={!completedAgents.agent2}
                scrollRef={agentTwoScrollRef}
              />
            </motion.div>
          )}

          {status === "merging" && (
            <motion.div
              key="merging"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="flex min-h-[360px] items-center justify-center rounded-2xl border border-blue-300/15 bg-[#02050a]"
            >
              <div className="text-center">
                <motion.div
                  animate={{ rotate: 360, scale: [1, 1.12, 1] }}
                  transition={{ repeat: Infinity, duration: 1.8, ease: "linear" }}
                  className="mx-auto flex size-16 items-center justify-center rounded-2xl border border-blue-300/25 bg-blue-400/10 text-blue-200"
                >
                  <TerminalSquare className="size-8" />
                </motion.div>
                <p className="mt-5 font-mono text-sm uppercase tracking-[0.35em] text-blue-200">
                  Paralel ajan çıktıları birleştiriliyor
                </p>
              </div>
            </motion.div>
          )}

          {status === "single" && (
            <motion.div
              key="single"
              initial={{ opacity: 0, y: 26, scaleX: 0.82 }}
              animate={{ opacity: 1, y: 0, scaleX: 1 }}
              exit={{ opacity: 0, y: -18 }}
              transition={{ duration: 0.55, ease: "easeOut" }}
            >
              <TerminalPane
                title="AJAN 3"
                subtitle="Sentezleyici / Master Rapor Motoru"
                icon={<FileText className="size-4" />}
                text={synthText}
                tone="cyan"
                isStreaming={!completedAgents.agent3}
                className="w-full"
                scrollRef={synthScrollRef}
              />
            </motion.div>
          )}

          {status === "done" && (
            <motion.div
              key="done"
              ref={finalSectionRef}
              initial={{ opacity: 0, y: 32 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, ease: "easeOut" }}
              className="rounded-2xl border border-blue-300/15 bg-black/20 p-4 md:p-6"
            >
              <div className="rounded-2xl border border-[rgba(147,197,253,0.18)] bg-[#05080d] p-5 text-[#dbeafe] md:p-8">
                <div className="mb-6 border-b border-blue-300/10 pb-4">
                  <p className="font-mono text-xs uppercase tracking-[0.32em] text-[#93c5fd]">Nihai Rapor</p>
                  <h2 className="mt-2 text-2xl font-semibold text-[#dbeafe]">Taktiksel Uydu Optimizasyon Çıktısı</h2>
                </div>
                <div
                  id="report-content-id"
                  ref={reportRef}
                  className="rounded-xl bg-[#05080d] p-4 text-[#dbeafe] md:p-6"
                >
                  {selectedOption && (
                    <div className="mb-7 rounded-2xl border border-[#00BFFF]/70 bg-[#00BFFF]/10 px-5 py-4 shadow-[0_0_22px_rgba(0,191,255,0.32)]">
                      <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.32em] text-[#93c5fd]">
                        Taktiksel Emir
                      </p>
                      <h1 className="mt-2 border-b-2 border-[#00BFFF] pb-3 text-2xl font-black uppercase leading-snug tracking-[0.06em] text-[#00BFFF] md:text-3xl">
                        {selectedOption}
                      </h1>
                    </div>
                  )}
                  <MarkdownRenderer content={reportBody || finalReportContent} />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.24em] text-blue-200/55">
            <span>Analiz ilerlemesi</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-800">
            <div
              className={cn(
                "h-full rounded-full bg-[#00BFFF] shadow-[0_0_15px_#00BFFF] transition-all duration-1000 ease-out",
                progress < 100 && "animate-pulse",
              )}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>
    </section>
  )
}
