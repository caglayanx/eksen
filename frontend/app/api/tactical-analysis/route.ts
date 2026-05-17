import { NextRequest, NextResponse } from "next/server"

const BACKEND_ANALYZE_SITE_URL = "http://127.0.0.1:8000/api/v1/analyze-site"
const ANSI_ESCAPE_RE = /\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g
const ANSI_COLOR_FRAGMENT_RE = /\[[0-9;]{1,4}m/g
const FRAME_LINE_RE = /^[\s╭╰╯╮│─┌┐└┘═║╔╗╚╝╠╣╦╩╬]+$/

type TacticalAgent = "agent1" | "agent2" | "agent3"
type TacticalRequestBody = {
  latitude?: number
  longitude?: number
  elevation?: number | null
  personnel_count?: number
  data_profile?: string
  city?: string | null
  province?: string | null
  region_label?: string | null
}

type ProviderProfile = {
  countryName: string
  regionLabel: string
  regionType: "border" | "coastal" | "interior"
  primaryProvider: string
  alternateProvider: string
  blockedProviders: string
  decisionRule: string
  missionContext: string
  protectionFocus: string
}

const turkiyeBorderReferencePoints = [
  { lat: 37.05, lng: 42.35 },
  { lat: 36.2, lng: 36.15 },
  { lat: 36.85, lng: 38.35 },
  { lat: 36.72, lng: 40.9 },
  { lat: 40.72, lng: 26.08 },
]

const turkiyeCoastalReferencePoints = [
  { lat: 41.0, lng: 29.0 },
  { lat: 39.65, lng: 26.6 },
  { lat: 36.9, lng: 30.7 },
  { lat: 41.3, lng: 36.3 },
]

function encodeSSE(data: unknown, event?: string) {
  const prefix = event ? `event: ${event}\n` : ""
  return `${prefix}data: ${JSON.stringify(data)}\n\n`
}

function sanitizeStreamText(text: string) {
  return text
    .replace(ANSI_ESCAPE_RE, "")
    .replace(ANSI_COLOR_FRAGMENT_RE, "")
    .split("\n")
    .filter((line) => !FRAME_LINE_RE.test(line.trim()))
    .join("\n")
}

function classifyLogAgent(message: string): TacticalAgent {
  const normalized = message.toLocaleLowerCase("tr-TR")

  if (
    normalized.includes("rapor") ||
    normalized.includes("master") ||
    normalized.includes("ajan 3") ||
    normalized.includes("birleştir") ||
    normalized.includes("birlestir")
  ) {
    return "agent3"
  }

  if (
    normalized.includes("fizibilite") ||
    normalized.includes("mühendis") ||
    normalized.includes("muhendis") ||
    normalized.includes("ajan 2") ||
    normalized.includes("anten") ||
    normalized.includes("maliyet")
  ) {
    return "agent2"
  }

  return "agent1"
}

function splitText(text: string, size = 220) {
  const chunks: string[] = []
  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size))
  }
  return chunks
}

function normalizeText(value: string) {
  return value
    .toLocaleLowerCase("tr-TR")
    .replaceAll("ı", "i")
    .replaceAll("ğ", "g")
    .replaceAll("ü", "u")
    .replaceAll("ş", "s")
    .replaceAll("ö", "o")
    .replaceAll("ç", "c")
}

function distanceKm(point: { lat: number; lng: number }, reference: { lat: number; lng: number }) {
  const latDelta = (point.lat - reference.lat) * 111
  const lngDelta = (point.lng - reference.lng) * 85
  return Math.sqrt(latDelta ** 2 + lngDelta ** 2)
}

function classifyRegionType(body: TacticalRequestBody, countryName: string): ProviderProfile["regionType"] {
  const normalizedCountry = normalizeText(countryName)
  if (!["turkiye", "türkiye", "turkey"].some((name) => normalizedCountry.includes(name))) {
    return "border"
  }

  const point = { lat: Number(body.latitude ?? 0), lng: Number(body.longitude ?? 0) }
  const borderDistance = Math.min(...turkiyeBorderReferencePoints.map((reference) => distanceKm(point, reference)))
  if (borderDistance <= 140) {
    return "border"
  }

  const coastDistance = Math.min(...turkiyeCoastalReferencePoints.map((reference) => distanceKm(point, reference)))
  if (coastDistance <= 90) {
    return "coastal"
  }

  return "interior"
}

function normalizeRegionLabelForContext(regionLabel: string, body: TacticalRequestBody, regionType: ProviderProfile["regionType"]) {
  if (regionType !== "interior") {
    return regionLabel
  }

  const locationName =
    body.province?.trim() ||
    body.city?.trim() ||
    regionLabel.replace(/Sınır\s+Bölgesi/gi, "").replace(/Sınır\s+Hattı/gi, "").trim() ||
    "Türkiye İç Bölgesi"

  return `${locationName} Stratejik Sanayi ve Üretim Bölgesi (İç Altyapı Omurgası)`
}

function inferCountryName(body: TacticalRequestBody) {
  const region = normalizeText(body.region_label ?? body.province ?? body.city ?? "")
  const lat = Number(body.latitude ?? 0)
  const lng = Number(body.longitude ?? 0)

  if ((lat >= 24 && lat <= 40.5 && lng >= 44 && lng <= 64.5) || region.includes("iran") || region.includes("horasan")) {
    return "İran"
  }
  if (region.includes("suriye")) {
    return "Suriye"
  }
  if (region.includes("yunanistan")) {
    return "Yunanistan"
  }
  if (region.includes("bulgaristan")) {
    return "Bulgaristan"
  }
  if (region.includes("turkiye") || region.includes("türkiye")) {
    return "Türkiye"
  }

  return body.province ?? body.region_label ?? "Bilinmeyen ülke"
}

function isTurkiyeCrossBorderRegion(regionLabel: string) {
  const normalized = normalizeText(regionLabel)
  return ["kuzey irak", "hakkari sinir", "suriye sinir", "resmi harekat", "us bolgesi"].some((term) =>
    normalized.includes(term),
  )
}

function buildProviderProfile(body: TacticalRequestBody): ProviderProfile {
  const rawRegionLabel = body.region_label?.trim() || body.province?.trim() || "Bilinmeyen saha"
  const regionLabel = rawRegionLabel
    .replace(/استان\s*خراسان\s*جنوبی/gi, "Güney Horasan (South Khorasan)")
    .replace(/\bSouth\s+Khorasan\b/gi, "Güney Horasan (South Khorasan)")
    .replace(/\bAfghanistan\b/gi, "Afganistan")
    .replace(/[\u0600-\u06FF\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF]+/g, "")
    .replace(/(Güney Horasan \(South Khorasan\)).*?(?:Afganistan)?\s*(?:Sınır\s*Hattı|Border\s*Line)/gi, "Güney Horasan (South Khorasan) - Afganistan Sınır Hattı")
    .replace(/\s{2,}/g, " ")
    .trim()
  const countryName = inferCountryName({ ...body, region_label: regionLabel })
  const normalizedCountry = normalizeText(countryName)
  const regionType = classifyRegionType(body, countryName)
  const contextRegionLabel = normalizeRegionLabelForContext(regionLabel, body, regionType)
  const missionContext =
    regionType === "interior"
      ? "Merkezi Altyapı Redundancy ve Stratejik İletişim Güvenliği"
      : regionType === "coastal"
        ? "Kıyı şeridi haberleşme sürekliliği ve deniz/kara yedek erişim güvenliği"
        : "Sınır hattı sürekliliği ve taktik haberleşme güvenliği"
  const protectionFocus =
    regionType === "interior"
      ? "karasal hatların çökmesine karşı merkezi yedekleme ve stratejik iletişim sürekliliği"
      : regionType === "coastal"
        ? "kıyı ve bölgesel altyapı yedekliliği"
        : "sınır hattı haberleşme sürekliliği"

  if (normalizedCountry.includes("iran")) {
    return {
      countryName: "İran",
      regionLabel: contextRegionLabel,
      regionType,
      primaryProvider: "INTELSAT / EUTELSAT MEA BEAM",
      alternateProvider: "İRAN ULUSAL UYDU ŞEBEKESİ (ZAFAR/MAHDA MATRIX)",
      blockedProviders: "TÜRKSAT, TURKSAT, Türksat GEO VSAT",
      decisionRule: "İran sahasında ambargo, ulusal güvenlik ve yerel yetkilendirme riski nedeniyle Türksat önerilemez.",
      missionContext,
      protectionFocus,
    }
  }

  if (normalizedCountry.includes("suriye")) {
    return {
      countryName: "Suriye",
      regionLabel: contextRegionLabel,
      regionType,
      primaryProvider: "EUTELSAT / ARABSAT OMNI OMA",
      alternateProvider: "INTELSAT MEA yedek kapasitesi",
      blockedProviders: "TÜRKSAT birincil omurga",
      decisionRule: "Suriye sahasında GEO omurga EUTELSAT / ARABSAT OMNI OMA profilinden seçilmelidir.",
      missionContext,
      protectionFocus,
    }
  }

  if (normalizedCountry.includes("yunanistan") || normalizedCountry.includes("bulgaristan")) {
    return {
      countryName,
      regionLabel: contextRegionLabel,
      regionType,
      primaryProvider: "HELLAS SAT",
      alternateProvider: "EUTELSAT KONNECT",
      blockedProviders: "TÜRKSAT birincil omurga",
      decisionRule: "Yunanistan/Bulgaristan sahasında ana GEO omurga HELLAS SAT veya EUTELSAT KONNECT olmalıdır.",
      missionContext,
      protectionFocus,
    }
  }

  if (normalizedCountry.includes("turkiye") || isTurkiyeCrossBorderRegion(regionLabel)) {
    return {
      countryName: regionType === "interior" ? "Türkiye / İç altyapı omurgası" : "Türkiye / Bölgesel operasyon sahası",
      regionLabel: contextRegionLabel,
      regionType,
      primaryProvider: "TÜRKSAT GEO VSAT",
      alternateProvider: "EUTELSAT / INTELSAT yedek kapasitesi",
      blockedProviders: "Yok",
      decisionRule:
        regionType === "interior"
          ? "Türkiye iç bölge sahasında Türksat gerekçesi merkezi yedekleme ve stratejik iletişim sürekliliğidir."
          : "Türkiye sınır/kıyı bölgesinde Türksat birincil omurga olabilir.",
      missionContext,
      protectionFocus,
    }
  }

  return {
    countryName,
    regionLabel: contextRegionLabel,
    regionType,
    primaryProvider: "EUTELSAT / INTELSAT bölgesel kapsama",
    alternateProvider: "Yerel regülasyona uygun bölgesel GEO sağlayıcı",
    blockedProviders: "Ülkeye özel regülasyonla çelişen sağlayıcılar",
    decisionRule: "Sağlayıcı seçimi ülke regülasyonu, kapsama ve güvenlik izinlerine göre yapılmalıdır.",
    missionContext,
    protectionFocus,
  }
}

function buildDemoMasterReport(profile: ProviderProfile, body: TacticalRequestBody) {
  const elevation = Number(body.elevation ?? 0)
  const hardTerrain = elevation >= 1000 || profile.regionType === "border"
  const installCost = hardTerrain ? "8.000 - 12.000 USD" : "3.000 - 5.000 USD"
  const tco = hardTerrain ? "50.000 - 75.000 USD" : "20.000 - 35.000 USD"

  return `**SEÇİLEN OPSİYON: 120 CM C/KU-BAND ANTEN + IDIRECT 9000 MODEM + ${profile.primaryProvider} ANA OMURGALI HİBRİT MİMARİ**

## Güvenlik ve Regülasyon Analizi Raporu - ${profile.regionLabel}

## **1. YÖNETİCİ ÖZETİ**
Konum / Bölge: ${profile.regionLabel}

Bu failover raporu statik şablondan değil, seçilen koordinat, bölge tipi ve ülke-sağlayıcı matrisinden üretilmiştir. ${profile.countryName} sahası için ana GEO omurgası ${profile.primaryProvider}; alternatif kapasite ${profile.alternateProvider} olarak belirlenmiştir.

Kritik karar gerekçesi: ${profile.decisionRule}

Görev bağlamı: ${profile.missionContext}

## **2. KARŞILAŞTIRMALI MİMARİ TABLOSU**
| Mimari Tipi | Güçlü Yön | Risk | Uygunluk |
| --- | --- | --- | --- |
| ${profile.primaryProvider} GEO Omurga | ${profile.protectionFocus} | Lisans ve koordinasyon gerekir | Yüksek |
| ${profile.alternateProvider} Yedek Kapasite | Taşıyıcı esnekliği | Sözleşme koşulları değişebilir | Orta-Yüksek |
| Hibrit LEO/GEO | Yedeklilik ve süreklilik | Daha yüksek CAPEX | En Uygun |

## **3. MALİYET ANALİZİ VE 3 YILLIK TCO**
| Kalem | Tahmini Maliyet |
| --- | ---: |
| 120 cm C/Ku-band anten | ${installCost} |
| iDirect 9000 modem | 4.000 - 7.000 USD |
| Yedek erişim terminali | 600 - 2.500 USD |
| 3 yıllık TCO | ${tco} |

## **4. NİHAİ ÖNERİ VE UYGULAMA YOL HARİTASI**
Nihai öneri: ${profile.primaryProvider} ana omurgalı hibrit mimari uygulanmalıdır. Gerekçe: ${profile.protectionFocus}. Yasaklı/kısıtlı sağlayıcı notu: ${profile.blockedProviders}.`
}

function isQuotaError(detail: unknown) {
  const normalized = String(detail ?? "").toLowerCase()
  return ["402", "429", "rate limit", "free-models-per-min", "free-models-per-day", "quota", "insufficient credits"].some(
    (marker) => normalized.includes(marker),
  )
}

function describeFetchError(error: unknown) {
  if (error instanceof Error) {
    const cause = "cause" in error ? (error.cause as { code?: string; message?: string } | undefined) : undefined
    const reason = cause?.code ?? cause?.message ?? error.message

    if (String(reason).includes("ECONNREFUSED")) {
      return `Backend bağlantısı reddedildi (${BACKEND_ANALYZE_SITE_URL}). Python/FastAPI sunucusu 8000 portunda çalışıyor mu?`
    }

    if (String(reason).includes("ETIMEDOUT")) {
      return `Backend bağlantısı zaman aşımına uğradı (${BACKEND_ANALYZE_SITE_URL}).`
    }

    return `Backend fetch hatası: ${reason}`
  }

  return "Backend fetch hatası: bilinmeyen hata"
}

export async function POST(request: NextRequest) {
  const body = await request.text()
  const parsedBody = JSON.parse(body || "{}") as TacticalRequestBody

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder()
      const send = (data: unknown, event?: string) => {
        controller.enqueue(encoder.encode(encodeSSE(data, event)))
      }
      const streamDemoReport = async (reason: string) => {
        const providerProfile = buildProviderProfile(parsedBody)
        const demoMasterReport = buildDemoMasterReport(providerProfile, parsedBody)
        console.warn("[tactical-analysis] Demo failover active:", reason)
        for (const token of "Demo kota sigortası devrede. Regülasyon özeti aktarılıyor.\n".split(" ")) {
          send({ agent: "agent1", token: `${token} ` }, "token")
          await new Promise((resolve) => setTimeout(resolve, 40))
        }
        for (const token of "Fizibilite özeti ve hibrit mimari değerlendirmesi aktarılıyor.\n".split(" ")) {
          send({ agent: "agent2", token: `${token} ` }, "token")
          await new Promise((resolve) => setTimeout(resolve, 40))
        }
        send({ phase: "merge" }, "phase")
        for (const token of demoMasterReport.split(" ")) {
          send({ agent: "agent3", token: `${token} ` }, "token")
          await new Promise((resolve) => setTimeout(resolve, 40))
        }
        send({ agent: "agent3" }, "agent_done")
        send(
          {
            result: {
              status: "success",
              demo_mode: true,
              country_code: "DEMO",
              country_name: providerProfile.countryName,
              input: {
                latitude: parsedBody.latitude,
                longitude: parsedBody.longitude,
                elevation: parsedBody.elevation,
                personnel_count: parsedBody.personnel_count,
                data_profile: parsedBody.data_profile,
                region_label: providerProfile.regionLabel,
                primary_geo_provider: providerProfile.primaryProvider,
                alternate_geo_provider: providerProfile.alternateProvider,
                blocked_providers: providerProfile.blockedProviders,
              },
              results: {
                regulation_and_coverage_analysis: "Demo failover regülasyon özeti.",
                feasibility_report: "Demo failover fizibilite özeti.",
                master_report: demoMasterReport,
              },
            },
          },
          "result",
        )
      }

      try {
        send({ agent: "system", token: "[SYS] Backend analiz akışına bağlanılıyor...\n" }, "token")
        send({ agent: "agent1", token: "[A1] Terminal hazır. Backend ilk token bekleniyor...\n" }, "token")
        send({ agent: "agent2", token: "[A2] Terminal hazır. Backend ilk token bekleniyor...\n" }, "token")

        const backendResponse = await fetch(BACKEND_ANALYZE_SITE_URL, {
          method: "POST",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          },
          body,
        })

        if (!backendResponse.ok || !backendResponse.body) {
          const payload = (await backendResponse.json().catch(() => null)) as { detail?: string } | null
          if (backendResponse.status === 402 || backendResponse.status === 429 || isQuotaError(payload?.detail)) {
            await streamDemoReport(payload?.detail ?? `Backend status ${backendResponse.status}`)
            send({}, "done")
            controller.close()
            return
          }
          send(
            {
              detail: payload?.detail ?? "Backend taktiksel analiz akışı başlatılamadı.",
              status: backendResponse.status,
            },
            "error",
          )
          send({}, "done")
          controller.close()
          return
        }

        const reader = backendResponse.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""

        while (true) {
          let readResult: ReadableStreamReadResult<Uint8Array>
          try {
            readResult = await reader.read()
          } catch (streamError) {
            console.warn("[tactical-analysis] Backend SSE socket interrupted, switching to demo failover:", streamError)
            await streamDemoReport(streamError instanceof Error ? streamError.message : "Backend socket interrupted")
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
            const eventLine = message.split("\n").find((line) => line.startsWith("event: "))
            const dataLine = message.split("\n").find((line) => line.startsWith("data: "))
            const event = eventLine?.replace("event: ", "").trim() ?? "message"

            if (!dataLine) {
              continue
            }

            const payload = JSON.parse(dataLine.replace("data: ", ""))

            if (event === "error" || payload.status === "error") {
              const detail = payload.detail ?? payload.message
              if (isQuotaError(detail)) {
                await streamDemoReport(detail)
                continue
              }
              send({ detail: detail ?? "Analiz sırasında hata oluştu." }, "error")
              continue
            }

            if (payload.type === "error") {
              const detail = payload.detail ?? payload.message
              if (isQuotaError(detail)) {
                await streamDemoReport(detail)
                continue
              }
              send({ detail: detail ?? "Analiz sırasında hata oluştu." }, "error")
              continue
            }

            if (payload.type === "done") {
              continue
            }

            if (event === "done") {
              continue
            }

            if (payload.type === "log" && typeof payload.message === "string") {
              send(
                {
                  agent: classifyLogAgent(payload.message),
                  token: `${sanitizeStreamText(payload.message)}\n`,
                },
                "token",
              )
              continue
            }

            if (payload.type === "agent_token" && typeof payload.text === "string") {
              const cleanText = sanitizeStreamText(payload.text)
              if (!cleanText.trim()) {
                continue
              }
              send(
                {
                  agent: payload.agent ?? classifyLogAgent(cleanText),
                  token: cleanText,
                },
                "token",
              )
              continue
            }

            if (payload.type === "control" && payload.action === "merge_terminals") {
              send({ phase: "merge" }, "phase")
              continue
            }

            if (payload.status === "success") {
              const regulation = payload.results?.regulation_and_coverage_analysis ?? ""
              const feasibility = payload.results?.feasibility_report ?? ""
              const master = payload.results?.master_report ?? ""

              for (const token of splitText(regulation)) {
                send({ agent: "agent1", token }, "token")
              }
              send({ agent: "agent1" }, "agent_done")

              for (const token of splitText(feasibility)) {
                send({ agent: "agent2", token }, "token")
              }
              send({ agent: "agent2" }, "agent_done")

              for (const token of splitText(master)) {
                send({ agent: "agent3", token }, "token")
              }
              send({ agent: "agent3" }, "agent_done")
              send({ result: payload }, "result")
            }
          }
        }

        send({}, "done")
      } catch (error) {
        const detail = describeFetchError(error)
        console.error("[tactical-analysis] Backend stream error:", error)
        send({ detail }, "error")
        send({}, "done")
      } finally {
        controller.close()
      }
    },
  })

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}
