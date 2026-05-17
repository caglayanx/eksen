export type CoordinatePoint = {
  lat: number
  lng: number
}

export type SelectedPoint = CoordinatePoint & {
  elevation: number | null
  city: string | null
  province: string | null
  regionLabel: string | null
}

export type MapFocus = {
  center: CoordinatePoint
  zoom: number
}

export type CoordinateAxis = "lat" | "lng"

export type CountryMeta = {
  id: string
  name: string
  coordinates: [number, number]
  zoom: number
  dx?: number
  dy?: number
}

export type CountryId =
  | "031"
  | "051"
  | "100"
  | "196"
  | "268"
  | "300"
  | "364"
  | "368"
  | "760"
  | "792"

export type SiteAnalysisRequest = {
  latitude: number
  longitude: number
  elevation: number | null
  personnel_count: number
  data_profile: string
  city?: string | null
  province?: string | null
  region_label?: string | null
}

export type AnalysisLocation = {
  country: string
  city?: string | null
  province?: string | null
  regionLabel?: string | null
  lat: number
  lng: number
  elevation: number
}

export type AnalysisLaunchPayload = {
  location: AnalysisLocation
  request: SiteAnalysisRequest
}

export type AnalysisResult = {
  status: "success"
  country_code: string
  country_name: string
  input: {
    latitude: number
    longitude: number
    elevation: number
    personnel_count: number
    data_profile: string
    region_label?: string
  }
  coordinate: {
    lat: number
    lon: number
    elevation: number
  }
  processing_time_seconds: number
  region_label?: string
  results: {
    regulation_and_coverage_analysis: string
    feasibility_report: string
    master_report: string
  }
  raw_output?: string
}

export type SSELogMessage = {
  type: "log"
  message: string
}

export type SSEErrorMessage = {
  status: "error"
  detail: string
  processing_time_seconds: number
}

export type ElevationResponse = {
  lat: number
  lon: number
  elevation: number
}

export type AnalysisStatus = "idle" | "connecting" | "streaming" | "completed" | "error"

export type AnalysisProgress = {
  step: number
  message: string
  elapsed: number
}

export type HealthcheckResponse = {
  status: string
}

export type RootResponse = {
  service: string
  version: string
  status: string
  supported_countries: number
}
