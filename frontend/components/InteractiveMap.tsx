"use client"

import { useEffect, useState } from "react"
import { geoContains } from "d3-geo"
import type { Feature, Geometry } from "geojson"
import {
  APIProvider,
  InfoWindow,
  Map as GoogleMap,
  Marker as GoogleMarker,
  type MapMouseEvent,
  useMap,
} from "@vis.gl/react-google-maps"
import {
  ComposableMap,
  Geographies,
  Geography,
  Marker,
  ZoomableGroup,
} from "react-simple-maps"

import type {
  AnalysisLaunchPayload,
  CoordinateAxis,
  CoordinatePoint,
  CountryId,
  CountryMeta,
  MapFocus,
  SelectedPoint,
} from "@/lib/types"

const geoUrl = "https://unpkg.com/world-atlas@2.0.2/countries-110m.json"
const defaultDataProfile = "anlık veri akışı"

type CountryFeature = Feature<Geometry> & {
  id?: string | number
  rsmKey?: string
}

type SelectedCountry = CountryMeta & {
  geography: CountryFeature
}

type InteractiveMapProps = {
  onConfirmSelection?: (payload: AnalysisLaunchPayload) => void
}

const countryMetaById: Record<CountryId, CountryMeta> = {
  "031": {
    id: "031",
    name: "AZERBAYCAN",
    coordinates: [47.6, 40.1],
    zoom: 7,
    dx: 24,
    dy: -8,
  },
  "051": {
    id: "051",
    name: "ERMENİSTAN",
    coordinates: [44.9, 40.2],
    zoom: 8,
    dx: 4,
    dy: 18,
  },
  "100": {
    id: "100",
    name: "BULGARİSTAN",
    coordinates: [25.3, 42.7],
    zoom: 7,
    dx: -10,
    dy: -10,
  },
  "196": {
    id: "196",
    name: "KIBRIS",
    coordinates: [33.4, 35.1],
    zoom: 8,
    dx: 10,
    dy: 18,
  },
  "268": {
    id: "268",
    name: "GÜRCİSTAN",
    coordinates: [43.4, 42.1],
    zoom: 8,
    dx: 16,
    dy: -12,
  },
  "300": {
    id: "300",
    name: "YUNANİSTAN",
    coordinates: [22.7, 39.1],
    zoom: 6,
    dx: -18,
    dy: 10,
  },
  "364": {
    id: "364",
    name: "İRAN",
    coordinates: [53.7, 32.4],
    zoom: 5,
    dx: 8,
    dy: 8,
  },
  "368": {
    id: "368",
    name: "IRAK",
    coordinates: [43.7, 33.2],
    zoom: 6,
    dx: -14,
    dy: 12,
  },
  "760": {
    id: "760",
    name: "SURİYE",
    coordinates: [38.5, 35.0],
    zoom: 7,
    dx: -18,
    dy: 10,
  },
  "792": {
    id: "792",
    name: "TÜRKİYE",
    coordinates: [35.2, 39.0],
    zoom: 6,
    dx: 0,
    dy: -4,
  },
}

const countryIds = new Set<string>(Object.keys(countryMetaById))

function normalizeGeoId(id: string | number | undefined) {
  return String(id ?? "").padStart(3, "0")
}

function GoogleMapViewport({ focus }: { focus: MapFocus | null }) {
  const map = useMap()

  useEffect(() => {
    if (!map || !focus) {
      return
    }

    map.panTo(focus.center)
    map.setZoom(focus.zoom)
  }, [focus, map])

  return null
}

function formatElevation(elevation: number | null) {
  if (elevation === null) {
    return "Yükleniyor"
  }

  return `${elevation.toFixed(1)} m`
}

function clampPersonCount(value: number) {
  return Math.min(1000, Math.max(1, Math.round(value)))
}

function clampLatitude(value: number) {
  return Math.min(90, Math.max(-90, value))
}

function clampLongitude(value: number) {
  return Math.min(180, Math.max(-180, value))
}

function parseCoordinateInput(raw: string) {
  const normalized = raw.trim().replace(",", ".")
  if (normalized === "" || normalized === "-" || normalized === "." || normalized === "-.") {
    return Number.NaN
  }
  return Number(normalized)
}

type GeocodedRegion = {
  city: string | null
  province: string | null
}

function extractRegionFromGeocodeResult(results: google.maps.GeocoderResult[] | null): GeocodedRegion {
  if (!results?.length) {
    return { city: null, province: null }
  }

  const getComponent = (types: string[]) => {
    for (const result of results) {
      const component = result.address_components.find((addressComponent) =>
        types.some((type) => addressComponent.types.includes(type)),
      )
      if (component?.long_name) {
        return component.long_name
      }
    }
    return null
  }

  return {
    city: getComponent(["locality", "administrative_area_level_2", "postal_town", "sublocality"]),
    province: getComponent(["administrative_area_level_1"]),
  }
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

function distanceKm(point: CoordinatePoint, reference: CoordinatePoint) {
  const latDelta = (point.lat - reference.lat) * 111
  const lngDelta = (point.lng - reference.lng) * 85
  return Math.sqrt(latDelta ** 2 + lngDelta ** 2)
}

function normalizeRegionText(value: string) {
  return value
    .toLocaleLowerCase("tr-TR")
    .replaceAll("ı", "i")
    .replaceAll("ğ", "g")
    .replaceAll("ü", "u")
    .replaceAll("ş", "s")
    .replaceAll("ö", "o")
    .replaceAll("ç", "c")
}

function classifyRegionType(point: CoordinatePoint, countryName: string) {
  const normalizedCountry = normalizeRegionText(countryName)
  if (!["turkiye", "türkiye", "turkey"].some((name) => normalizedCountry.includes(name))) {
    return "border"
  }

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

function buildRegionLabel(
  point: CoordinatePoint,
  province: string | null,
  neighborProvince: string | null,
  countryName: string,
) {
  const regionType = classifyRegionType(point, countryName)
  if (regionType === "interior") {
    const locationName = province ?? countryName
    return `${locationName} Stratejik Sanayi ve Üretim Bölgesi (İç Altyapı Omurgası)`
  }
  if (province && neighborProvince && province !== neighborProvince) {
    return `${province} - ${neighborProvince} Sınır Hattı`
  }
  if (province) {
    return regionType === "coastal" ? `${province} Kıyı ve Bölgesel Altyapı Bölgesi` : `${province} Sınır Bölgesi`
  }
  return regionType === "coastal" ? `${countryName} Kıyı ve Bölgesel Altyapı Bölgesi` : `${countryName} Sınır Bölgesi`
}

function regionDisplayPrefix(regionLabel: string | null | undefined) {
  return regionLabel?.includes("İç Altyapı") ? "Bölge / Konum" : "Sınır / Bölge"
}

export function InteractiveMap({ onConfirmSelection }: InteractiveMapProps) {
  const [activeCountry, setActiveCountry] = useState<CountryMeta | null>(null)
  const [selectedCountry, setSelectedCountry] = useState<SelectedCountry | null>(null)
  const [selectedPoint, setSelectedPoint] = useState<SelectedPoint | null>(null)
  const [regionError, setRegionError] = useState<string | null>(null)
  const [personCount, setPersonCount] = useState(1)
  const [isEditingPersonCount, setIsEditingPersonCount] = useState(false)
  const [personCountInput, setPersonCountInput] = useState("1")
  const [coordinateEditAxis, setCoordinateEditAxis] = useState<CoordinateAxis | null>(null)
  const [latInput, setLatInput] = useState("")
  const [lngInput, setLngInput] = useState("")
  const [mapFocus, setMapFocus] = useState<MapFocus | null>(null)
  const [selectionMessage, setSelectionMessage] = useState<string | null>(null)
  const [locationMessage, setLocationMessage] = useState<string | null>(null)
  const [elevationError, setElevationError] = useState<string | null>(null)
  const [countryElevations, setCountryElevations] = useState<Record<string, number | null>>({})

  const googleMapsApiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

  const openCoordinateSelector = (country: CountryMeta, geography: CountryFeature) => {
    setSelectedCountry({ ...country, geography })
    setSelectedPoint(null)
    setRegionError(null)
    setPersonCount(1)
    setPersonCountInput("1")
    setIsEditingPersonCount(false)
    setCoordinateEditAxis(null)
    setLatInput("")
    setLngInput("")
    setSelectionMessage(null)
    setLocationMessage(null)
    setElevationError(null)
    setMapFocus({
      center: {
        lat: country.coordinates[1],
        lng: country.coordinates[0],
      },
      zoom: country.zoom,
    })
  }

  const closeCoordinateSelector = () => {
    setSelectedCountry(null)
    setSelectedPoint(null)
    setRegionError(null)
    setSelectionMessage(null)
    setLocationMessage(null)
    setElevationError(null)
    setCoordinateEditAxis(null)
    setLatInput("")
    setLngInput("")
    setMapFocus(null)
  }

  const updatePersonCount = (value: number) => {
    const nextCount = clampPersonCount(value)
    setPersonCount(nextCount)
    setPersonCountInput(String(nextCount))
  }

  const startEditingPersonCount = () => {
    setPersonCountInput(String(personCount))
    setIsEditingPersonCount(true)
  }

  const commitPersonCountInput = () => {
    const parsedCount = Number(personCountInput)
    updatePersonCount(Number.isFinite(parsedCount) ? parsedCount : personCount)
    setIsEditingPersonCount(false)
  }

  const startEditingCoordinate = (axis: CoordinateAxis) => {
    if (!selectedPoint) {
      return
    }

    if (axis === "lat") {
      setLatInput(selectedPoint.lat.toFixed(6))
    } else {
      setLngInput(selectedPoint.lng.toFixed(6))
    }

    setCoordinateEditAxis(axis)
  }

  const cancelCoordinateEdit = () => {
    if (selectedPoint) {
      setLatInput(selectedPoint.lat.toFixed(6))
      setLngInput(selectedPoint.lng.toFixed(6))
    }
    setCoordinateEditAxis(null)
  }

  const commitCoordinateEdit = () => {
    if (!selectedCountry || !selectedPoint || coordinateEditAxis === null) {
      setCoordinateEditAxis(null)
      return
    }

    const parsedLat = parseCoordinateInput(latInput)
    const parsedLng = parseCoordinateInput(lngInput)

    let nextLat = selectedPoint.lat
    let nextLng = selectedPoint.lng

    if (coordinateEditAxis === "lat") {
      if (!Number.isFinite(parsedLat)) {
        cancelCoordinateEdit()
        return
      }
      nextLat = clampLatitude(parsedLat)
      nextLng = selectedPoint.lng
    } else {
      if (!Number.isFinite(parsedLng)) {
        cancelCoordinateEdit()
        return
      }
      nextLat = selectedPoint.lat
      nextLng = clampLongitude(parsedLng)
    }

    setCoordinateEditAxis(null)
    setLatInput(nextLat.toFixed(6))
    setLngInput(nextLng.toFixed(6))

    void validateAndSetPoint({ lat: nextLat, lng: nextLng })
    setMapFocus((currentFocus) => ({
      center: { lat: nextLat, lng: nextLng },
      zoom: currentFocus?.zoom ?? selectedCountry.zoom ?? 11,
    }))
  }

  const fetchElevation = async (point: CoordinatePoint) => {
    if (!window.google?.maps?.ElevationService) {
      throw new Error("Google Maps Elevation servisi henüz hazır değil.")
    }

    const elevationService = new window.google.maps.ElevationService()

    return new Promise<number>((resolve, reject) => {
      elevationService.getElevationForLocations(
        {
          locations: [{ lat: point.lat, lng: point.lng }],
        },
        (results, status) => {
          if (status === window.google.maps.ElevationStatus.OK && results?.[0]) {
            resolve(Number(results[0].elevation.toFixed(2)))
            return
          }

          reject(new Error(`Rakım verisi alınamadı. Google durumu: ${status}`))
        },
      )
    })
  }

  const fetchRegion = async (point: CoordinatePoint, countryName: string) => {
    if (!window.google?.maps?.Geocoder) {
      throw new Error("Google Maps Geocoder servisi henüz hazır değil.")
    }

    const geocoder = new window.google.maps.Geocoder()
    const geocodePoint = (targetPoint: CoordinatePoint) =>
      new Promise<GeocodedRegion>((resolve, reject) => {
        geocoder.geocode(
          {
            location: { lat: targetPoint.lat, lng: targetPoint.lng },
            language: "tr",
          },
          (results, status) => {
            if (status === window.google.maps.GeocoderStatus.OK) {
              resolve(extractRegionFromGeocodeResult(results))
              return
            }

            if (status === window.google.maps.GeocoderStatus.ZERO_RESULTS) {
              resolve({ city: null, province: null })
              return
            }

            reject(new Error(`Bölge bilgisi alınamadı. Google durumu: ${status}`))
          },
        )
      })

    const baseRegion = await geocodePoint(point)
    const neighborCandidates = await Promise.all(
      [
        { lat: point.lat + 0.18, lng: point.lng },
        { lat: point.lat - 0.18, lng: point.lng },
        { lat: point.lat, lng: point.lng + 0.18 },
        { lat: point.lat, lng: point.lng - 0.18 },
      ].map((candidatePoint) => geocodePoint(candidatePoint).catch(() => ({ city: null, province: null }))),
    )

    const neighborProvince =
      neighborCandidates.find((candidate) => candidate.province && candidate.province !== baseRegion.province)?.province ?? null

    return {
      ...baseRegion,
      regionLabel: buildRegionLabel(point, baseRegion.province, neighborProvince, countryName),
    }
  }

  const handleCountryEnter = (country: CountryMeta) => {
    setActiveCountry(country)

    if (country.id in countryElevations) {
      return
    }

    setCountryElevations((currentElevations) => ({
      ...currentElevations,
      [country.id]: null,
    }))

    void fetchElevation({
      lat: country.coordinates[1],
      lng: country.coordinates[0],
    })
      .then((elevation) => {
        setCountryElevations((currentElevations) => ({
          ...currentElevations,
          [country.id]: elevation,
        }))
      })
      .catch(() => {
        setCountryElevations((currentElevations) => {
          const nextElevations = { ...currentElevations }
          delete nextElevations[country.id]
          return nextElevations
        })
      })
  }

  const validateAndSetPoint = async (point: CoordinatePoint) => {
    if (!selectedCountry) {
      return
    }

    setCoordinateEditAxis(null)
    setLatInput(point.lat.toFixed(6))
    setLngInput(point.lng.toFixed(6))

    const isInsideSelectedCountry = geoContains(selectedCountry.geography, [point.lng, point.lat])

    setSelectedPoint({ ...point, elevation: null, city: null, province: null, regionLabel: null })
    setRegionError(isInsideSelectedCountry ? null : "Desteklenmeyen Bölge")
    setSelectionMessage(null)
    setElevationError(null)

    try {
      const [elevation, region] = await Promise.all([fetchElevation(point), fetchRegion(point, selectedCountry.name)])
      setSelectedPoint((currentPoint) => {
        if (!currentPoint || currentPoint.lat !== point.lat || currentPoint.lng !== point.lng) {
          return currentPoint
        }

        return {
          ...currentPoint,
          elevation,
          city: region.city,
          province: region.province,
          regionLabel: region.regionLabel,
        }
      })
    } catch (error) {
      setElevationError(error instanceof Error ? error.message : "Rakım verisi alınamadı.")
      setSelectedPoint((currentPoint) => {
        if (!currentPoint || currentPoint.lat !== point.lat || currentPoint.lng !== point.lng) {
          return currentPoint
        }

        return {
          ...currentPoint,
          elevation: null,
          city: currentPoint.city ?? null,
          province: currentPoint.province ?? null,
          regionLabel: currentPoint.regionLabel ?? null,
        }
      })
    }
  }

  const handleGoogleMapClick = (event: MapMouseEvent) => {
    if (!event.detail.latLng) {
      return
    }

    void validateAndSetPoint({
      lat: event.detail.latLng.lat,
      lng: event.detail.latLng.lng,
    })
  }

  const handleFindLocation = () => {
    setLocationMessage(null)
    setSelectionMessage(null)

    if (!navigator.geolocation) {
      setLocationMessage("Tarayıcı konum servisini desteklemiyor.")
      return
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const point = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        }

        void validateAndSetPoint(point)
        setMapFocus({
          center: point,
          zoom: 11,
        })
        setLocationMessage("Konumunuz harita üzerinde işaretlendi.")
      },
      () => {
        setLocationMessage("Konum izni alınamadı veya konum bilgisi bulunamadı.")
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
      },
    )
  }

  const handleConfirmSelection = () => {
    if (!selectedCountry || !selectedPoint) {
      setSelectionMessage("Analiz için önce desteklenen bir koordinat seçin.")
      return
    }

    if (regionError) {
      setSelectionMessage("Desteklenmeyen bölge için analiz başlatılamaz.")
      return
    }

    if (selectedPoint.elevation === null) {
      setSelectionMessage("Rakım verisi hazır olmadan analiz başlatılamaz.")
      return
    }

    const trimmedDataProfile = defaultDataProfile.trim()
    const fallbackRegionLabel = buildRegionLabel(
      selectedPoint,
      selectedPoint.province,
      null,
      selectedCountry.name,
    )
    const confirmedRegionLabel = selectedPoint.regionLabel ?? fallbackRegionLabel

    setSelectionMessage(
      `${confirmedRegionLabel} için ${personCount} kişi, ${selectedPoint.elevation.toFixed(1)} m rakım ve seçilen koordinat onaylandı. Analiz başlatılıyor.`,
    )

    onConfirmSelection?.({
      location: {
        country: selectedCountry.name,
        city: selectedPoint.city,
        province: selectedPoint.province,
        regionLabel: confirmedRegionLabel,
        lat: selectedPoint.lat,
        lng: selectedPoint.lng,
        elevation: selectedPoint.elevation,
      },
      request: {
        latitude: selectedPoint.lat,
        longitude: selectedPoint.lng,
        elevation: selectedPoint.elevation,
        personnel_count: personCount,
        data_profile: trimmedDataProfile,
        city: selectedPoint.city,
        province: selectedPoint.province,
        region_label: confirmedRegionLabel,
      },
    })
  }

  return (
    <div className="w-full rounded-[2rem] border border-blue-400/10 bg-[#05080d] p-4 shadow-[0_24px_80px_rgba(0,0,0,0.45)] md:p-8">
      <div className="mb-6 flex flex-col gap-2 text-center">
        <p className="text-sm font-medium uppercase tracking-[0.35em] text-[oklch(0.62_0.10_240)]">
          Etkileşimli Bölge Haritası
        </p>
        <h2 className="text-3xl font-semibold tracking-tight text-foreground md:text-5xl">
          Türkiye ve Komşu Bağlantı Ağı
        </h2>
        <p className="mx-auto max-w-2xl text-sm leading-6 text-muted-foreground md:text-base">
          Ülkelerin üzerine gelerek bölgesel bağlantı noktalarını keşfedin.
        </p>
      </div>

      <div className="relative overflow-hidden rounded-[1.5rem] border border-blue-300/10 bg-[radial-gradient(circle_at_50%_45%,rgba(53,111,191,0.18),transparent_58%),linear-gradient(145deg,#080d14,#030407)] p-4">
        <ComposableMap
          projection="geoMercator"
          projectionConfig={{
            center: [39, 38],
            scale: 1500,
          }}
          width={980}
          height={620}
          className="interactive-region-map h-[420px] w-full md:h-[560px]"
          aria-label="Türkiye ve komşu ülkeleri gösteren etkileşimli TopoJSON harita"
        >
          <defs>
            <linearGradient id="countryBlue" x1="0%" x2="100%" y1="0%" y2="100%">
              <stop offset="0%" stopColor="#2d6fa8" />
              <stop offset="100%" stopColor="#143f66" />
            </linearGradient>
            <linearGradient id="countryHoverBlue" x1="0%" x2="100%" y1="0%" y2="100%">
              <stop offset="0%" stopColor="#7cc8ff" />
              <stop offset="100%" stopColor="#1687ff" />
            </linearGradient>
          </defs>

          <ZoomableGroup center={[39, 38]} zoom={1} minZoom={1} maxZoom={1}>
            <Geographies geography={geoUrl}>
              {({ geographies }) =>
                geographies
                  .filter((geo) => countryIds.has(normalizeGeoId(geo.id)))
                  .map((geo) => {
                    const countryId = normalizeGeoId(geo.id) as CountryId
                    const country = countryMetaById[countryId]
                    const isActive = activeCountry?.id === country.id

                    return (
                      <Geography
                        key={geo.rsmKey}
                        geography={geo}
                        className="country-shape cursor-pointer stroke-[#7cc8ff]/35 transition-all duration-300 ease-out"
                        fill={isActive ? "url(#countryHoverBlue)" : "url(#countryBlue)"}
                        strokeWidth={isActive ? 2.2 : 1.2}
                        tabIndex={0}
                        aria-label={country.name}
                        onMouseEnter={() => handleCountryEnter(country)}
                        onMouseLeave={() => setActiveCountry(null)}
                        onFocus={() => handleCountryEnter(country)}
                        onBlur={() => setActiveCountry(null)}
                        onClick={() => openCoordinateSelector(country, geo as CountryFeature)}
                        style={{
                          default: { outline: "none" },
                          hover: { outline: "none" },
                          pressed: { outline: "none" },
                        }}
                      >
                        <title>{country.name}</title>
                      </Geography>
                    )
                  })
              }
            </Geographies>

            {Object.values(countryMetaById).map((country) => (
              <Marker key={country.id} coordinates={country.coordinates}>
                <text
                  x={country.dx ?? 0}
                  y={country.dy ?? 0}
                  textAnchor="middle"
                  className="pointer-events-none select-none fill-white font-sans text-[13px] font-semibold tracking-[0.12em]"
                  paintOrder="stroke"
                  stroke="#02050a"
                  strokeWidth={3.5}
                  strokeLinejoin="round"
                >
                  {country.name}
                </text>
              </Marker>
            ))}
          </ZoomableGroup>
        </ComposableMap>

        {activeCountry && (
          <div className="pointer-events-none absolute left-1/2 top-6 -translate-x-1/2 rounded-2xl border border-blue-200/20 bg-[#08111d]/90 px-5 py-3 text-center text-sm font-semibold text-blue-100 shadow-[0_0_28px_rgba(64,156,255,0.28)] backdrop-blur">
            <p className="tracking-[0.18em]">{activeCountry.name}</p>
            <p className="mt-1 font-mono text-xs tracking-normal text-blue-100/75">
              Rakım: {formatElevation(countryElevations[activeCountry.id] ?? null)}
            </p>
          </div>
        )}
      </div>

      {selectedCountry && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-4 py-6 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="coordinate-selector-title"
        >
          <div className="relative flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-[1.5rem] border border-blue-300/15 bg-[#05080d] shadow-[0_30px_100px_rgba(0,0,0,0.65)]">
            <div className="flex flex-col gap-4 border-b border-blue-300/10 px-5 py-5 md:flex-row md:items-start md:justify-between md:px-7">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.35em] text-blue-300/80">
                  Google Maps Koordinat Seçimi
                </p>
                <h3 id="coordinate-selector-title" className="mt-2 text-2xl font-semibold text-foreground">
                  {selectedCountry.name}
                </h3>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                  Harita seçtiğiniz ülkeye ölçeklendi. Google Maps üzerinde bir koordinat seçin;
                  seçilen nokta bu ülkenin dışında kalırsa sistem desteklenmeyen bölge hatası verir.
                </p>
              </div>
              <button
                type="button"
                onClick={closeCoordinateSelector}
                className="self-start rounded-full border border-blue-200/15 px-4 py-2 text-sm font-medium text-blue-100 transition hover:border-blue-200/35 hover:bg-blue-400/10"
              >
                Kapat
              </button>
            </div>

            <div className="grid gap-4 p-5 md:grid-cols-[1fr_280px] md:p-7">
              <div className="h-[56vh] min-h-[420px] overflow-hidden rounded-[1.25rem] border border-blue-300/10 bg-[#02050a]">
                {googleMapsApiKey ? (
                  <APIProvider apiKey={googleMapsApiKey}>
                    <GoogleMap
                      key={selectedCountry.id}
                      mapId="coordinate-selector-map"
                      defaultCenter={{
                        lat: selectedCountry.coordinates[1],
                        lng: selectedCountry.coordinates[0],
                      }}
                      defaultZoom={selectedCountry.zoom}
                      colorScheme="DARK"
                      gestureHandling="greedy"
                      disableDefaultUI={false}
                      mapTypeControl={false}
                      streetViewControl={false}
                      fullscreenControl={false}
                      onClick={handleGoogleMapClick}
                      className="h-full w-full"
                    >
                      <GoogleMapViewport focus={mapFocus} />
                      {selectedPoint && (
                        <>
                          <GoogleMarker position={selectedPoint} />
                          <InfoWindow position={selectedPoint} disableAutoPan>
                            <div className="min-w-36 rounded-xl bg-[#05080d] p-2 text-sm text-blue-50">
                              <p className="font-semibold text-blue-100">{selectedCountry.name}</p>
                              <p className="mt-1 text-blue-100/80">
                                {regionDisplayPrefix(selectedPoint.regionLabel)}: {selectedPoint.regionLabel ?? "Belirleniyor"}
                              </p>
                              <p className="mt-1 font-mono">Rakım: {formatElevation(selectedPoint.elevation)}</p>
                            </div>
                          </InfoWindow>
                        </>
                      )}
                    </GoogleMap>
                  </APIProvider>
                ) : (
                  <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                    <p className="text-lg font-semibold text-blue-100">Google Maps API anahtarı gerekli</p>
                    <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">
                      Bu ekranı kullanmak için `.env.local` dosyasına
                      `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` değeri eklenmeli.
                    </p>
                  </div>
                )}
              </div>

              <aside className="rounded-[1.25rem] border border-blue-300/10 bg-white/[0.03] p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-blue-300/80">
                  Seçim Durumu
                </p>

                <div className="mt-5 rounded-2xl border border-blue-300/10 bg-black/20 p-4">
                  <div className="flex items-center justify-between gap-4">
                    <label htmlFor="person-count" className="text-sm font-semibold text-blue-100">
                      Kişi sayısı
                    </label>
                    {isEditingPersonCount ? (
                      <input
                        aria-label="Kişi sayısını elle gir"
                        autoFocus
                        type="number"
                        min={1}
                        max={1000}
                        step={1}
                        value={personCountInput}
                        onChange={(event) => setPersonCountInput(event.target.value)}
                        onBlur={commitPersonCountInput}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            commitPersonCountInput()
                          }

                          if (event.key === "Escape") {
                            setPersonCountInput(String(personCount))
                            setIsEditingPersonCount(false)
                          }
                        }}
                        className="w-20 rounded-full border border-blue-300/20 bg-[#05080d] px-3 py-1 text-right font-mono text-sm text-blue-100 outline-none focus:border-blue-300/45"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={startEditingPersonCount}
                        className="rounded-full bg-blue-400/10 px-3 py-1 font-mono text-sm text-blue-100 transition hover:bg-blue-400/20"
                        aria-label="Kişi sayısını elle düzenle"
                      >
                        {personCount}
                      </button>
                    )}
                  </div>
                  <input
                    id="person-count"
                    type="range"
                    min={1}
                    max={1000}
                    step={1}
                    value={personCount}
                    onChange={(event) => updatePersonCount(Number(event.target.value))}
                    className="mt-4 h-2 w-full cursor-pointer accent-[oklch(0.62_0.12_240)]"
                  />
                  <div className="mt-2 flex justify-between text-[11px] text-muted-foreground">
                    <span>1</span>
                    <span>1000</span>
                  </div>
                </div>

                {regionError ? (
                  <div className="mt-4 rounded-2xl border border-red-400/30 bg-red-500/10 p-4">
                    <p className="text-lg font-semibold text-red-200">Desteklenmeyen Bölge</p>
                    <p className="mt-2 text-sm leading-6 text-red-100/75">
                      Seçilen koordinat {selectedCountry.name} sınırları içinde değil.
                    </p>
                  </div>
                ) : selectedPoint ? (
                  <div className="mt-4 rounded-2xl border border-blue-300/20 bg-blue-400/10 p-4">
                    <p className="text-lg font-semibold text-blue-100">Koordinat destekleniyor</p>
                    <p className="mt-2 text-sm leading-6 text-blue-100/75">
                      Seçilen nokta {selectedPoint.regionLabel ?? buildRegionLabel(selectedPoint, selectedPoint.province, null, selectedCountry.name)} içinde.
                    </p>
                  </div>
                ) : (
                  <p className="mt-4 text-sm leading-6 text-muted-foreground">
                    Henüz koordinat seçilmedi. Google Maps üzerinde bir noktaya tıklayın.
                  </p>
                )}

                {selectedPoint && (
                  <div className="mt-5 space-y-2 rounded-2xl border border-white/10 bg-black/20 p-4 font-mono text-sm text-blue-50">
                    <div className="flex items-center justify-between gap-2">
                      <span className="shrink-0 text-blue-100/80">lat</span>
                      {coordinateEditAxis === "lat" ? (
                        <input
                          aria-label="Enlem düzenle"
                          autoFocus
                          type="text"
                          inputMode="decimal"
                          value={latInput}
                          onChange={(event) => setLatInput(event.target.value)}
                          onBlur={commitCoordinateEdit}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              commitCoordinateEdit()
                            }
                            if (event.key === "Escape") {
                              cancelCoordinateEdit()
                            }
                          }}
                          className="min-w-0 flex-1 rounded-lg border border-blue-300/20 bg-[#05080d] px-2 py-1 text-right text-blue-50 outline-none focus:border-blue-300/45"
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => startEditingCoordinate("lat")}
                          className="min-w-0 flex-1 truncate rounded-lg bg-blue-400/10 px-2 py-1 text-right text-blue-50 transition hover:bg-blue-400/20"
                          aria-label="Enlemi elle düzenle"
                        >
                          {selectedPoint.lat.toFixed(6)}
                        </button>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="shrink-0 text-blue-100/80">lng</span>
                      {coordinateEditAxis === "lng" ? (
                        <input
                          aria-label="Boylam düzenle"
                          autoFocus
                          type="text"
                          inputMode="decimal"
                          value={lngInput}
                          onChange={(event) => setLngInput(event.target.value)}
                          onBlur={commitCoordinateEdit}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              commitCoordinateEdit()
                            }
                            if (event.key === "Escape") {
                              cancelCoordinateEdit()
                            }
                          }}
                          className="min-w-0 flex-1 rounded-lg border border-blue-300/20 bg-[#05080d] px-2 py-1 text-right text-blue-50 outline-none focus:border-blue-300/45"
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => startEditingCoordinate("lng")}
                          className="min-w-0 flex-1 truncate rounded-lg bg-blue-400/10 px-2 py-1 text-right text-blue-50 transition hover:bg-blue-400/20"
                          aria-label="Boylamı elle düzenle"
                        >
                          {selectedPoint.lng.toFixed(6)}
                        </button>
                      )}
                    </div>
                    <p>{regionDisplayPrefix(selectedPoint.regionLabel)}: {selectedPoint.regionLabel ?? "Belirleniyor"}</p>
                    <p>Rakım: {formatElevation(selectedPoint.elevation)}</p>
                  </div>
                )}

                {elevationError && (
                  <p className="mt-4 rounded-2xl border border-amber-300/20 bg-amber-400/10 p-3 text-sm leading-6 text-amber-100/85">
                    {elevationError}
                  </p>
                )}

                {selectionMessage && (
                  <p className="mt-4 rounded-2xl border border-blue-300/20 bg-blue-400/10 p-3 text-sm leading-6 text-blue-100">
                    {selectionMessage}
                  </p>
                )}

                {locationMessage && (
                  <p className="mt-4 rounded-2xl border border-blue-300/10 bg-blue-400/10 p-3 text-sm leading-6 text-blue-100/80">
                    {locationMessage}
                  </p>
                )}

                <div className="mt-5 grid gap-3">
                  <button
                    type="button"
                    onClick={handleFindLocation}
                    className="rounded-full border border-blue-200/20 px-4 py-3 text-sm font-semibold text-blue-100 transition hover:border-blue-200/45 hover:bg-blue-400/10"
                  >
                    Konumumu bul
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleConfirmSelection()}
                    disabled={!selectedPoint || Boolean(regionError) || selectedPoint.elevation === null}
                    className="rounded-full bg-[oklch(0.55_0.10_240)] px-4 py-3 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(53,111,191,0.25)] transition hover:bg-[oklch(0.62_0.12_240)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Onayla
                  </button>
                </div>
              </aside>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .interactive-region-map .country-shape {
          transform-box: fill-box;
          transform-origin: center;
          filter: drop-shadow(0 10px 20px rgba(23, 76, 125, 0.16));
        }

        .interactive-region-map .country-shape:hover,
        .interactive-region-map .country-shape:focus-visible {
          transform: translateY(-5px) scale(1.02);
          filter: drop-shadow(0 0 18px rgba(76, 171, 255, 0.72))
            drop-shadow(0 16px 30px rgba(22, 135, 255, 0.32));
          outline: none;
        }
      `}</style>
    </div>
  )
}
