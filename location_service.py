import asyncio
import os
import logging
from typing import Optional

import requests
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger("connectivity_copilot.location")

GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json"
ELEVATION_URL = "https://maps.googleapis.com/maps/api/elevation/json"
REQUEST_TIMEOUT = 10

SUPPORTED_COUNTRIES: dict[str, str] = {
    "TR": "Turkiye",
    "GR": "Yunanistan",
    "BG": "Bulgaristan",
    "GE": "Gurcistan",
    "AM": "Ermenistan",
    "AZ": "Azerbaycan",
    "IR": "Iran",
    "IQ": "Irak",
    "SY": "Suriye",
    "CY": "Kibris",
}

SUPPORTED_COUNTRY_CODES: set[str] = set(SUPPORTED_COUNTRIES.keys())


class UnsupportedRegionException(ValueError):
    def __init__(self, country_name: str, country_code: str):
        self.country_name = country_name
        self.country_code = country_code
        super().__init__(
            "Secilen lokasyon projenin kapsadigi 10 hedef ulke disinda kalmaktadir."
        )


def _get_google_maps_api_key() -> str:
    api_key = os.getenv("GOOGLE_MAPS_API_KEY") or os.getenv("Maps_API_KEY")
    if not api_key:
        raise ValueError(
            "Google Maps API anahtari bulunamadi. GOOGLE_MAPS_API_KEY "
            "veya Maps_API_KEY ortam degiskenini kontrol edin."
        )
    return api_key


def _validate_google_response(data: dict, service_name: str) -> None:
    status = data.get("status", "")
    if status == "REQUEST_DENIED":
        error_msg = data.get("error_message", "Bilinmeyen hata")
        raise RuntimeError(f"{service_name} erisim reddedildi: {error_msg}")
    if status == "OVER_QUERY_LIMIT":
        raise RuntimeError(f"{service_name} kota asimi.")
    if status == "ZERO_RESULTS":
        raise RuntimeError(f"{service_name} icin sonuc bulunamadi.")
    if status != "OK":
        raise RuntimeError(f"{service_name} beklenmeyen yanit: {status}")


def get_country(latitude: float, longitude: float) -> dict:
    api_key = _get_google_maps_api_key()

    logger.info("Reverse geocoding istegi: lat=%.4f, lon=%.4f", latitude, longitude)

    try:
        response = requests.get(
            GEOCODE_URL,
            params={
                "latlng": f"{latitude},{longitude}",
                "key": api_key,
                "language": "tr",
            },
            timeout=REQUEST_TIMEOUT,
        )
        response.raise_for_status()
        data = response.json()
    except requests.exceptions.Timeout as exc:
        raise RuntimeError(f"Google Maps API zaman asimi ({REQUEST_TIMEOUT}s)") from exc
    except requests.exceptions.ConnectionError as exc:
        raise RuntimeError(f"Google Maps API'ye baglanilamadi: {exc}") from exc
    except requests.exceptions.RequestException as exc:
        raise RuntimeError(f"Google Maps API istek hatasi: {exc}") from exc

    _validate_google_response(data, "Google Maps Geocoding API")
    if not data.get("results"):
        raise RuntimeError(f"Verilen koordinatlar icin sonuc bulunamadi: {latitude}, {longitude}")

    country_name: Optional[str] = None
    country_code: Optional[str] = None

    for result in data.get("results", []):
        for component in result.get("address_components", []):
            if "country" in component.get("types", []):
                country_name = component.get("long_name") or country_name
                country_code = component.get("short_name") or country_code

    if not country_name or not country_code:
        raise RuntimeError(f"Ulke bilgisi cozumlenemedi: lat={latitude}, lon={longitude}")

    logger.info("Tespit edilen ulke: %s (%s)", country_name, country_code)
    return {"country_name": country_name, "country_code": country_code.upper()}


def _get_elevation_sync(latitude: float, longitude: float) -> float:
    api_key = _get_google_maps_api_key()

    logger.info("Elevation istegi: lat=%.4f, lon=%.4f", latitude, longitude)

    try:
        response = requests.get(
            ELEVATION_URL,
            params={
                "locations": f"{latitude},{longitude}",
                "key": api_key,
            },
            timeout=REQUEST_TIMEOUT,
        )
        response.raise_for_status()
        data = response.json()
    except requests.exceptions.Timeout as exc:
        raise RuntimeError(f"Google Elevation API zaman asimi ({REQUEST_TIMEOUT}s)") from exc
    except requests.exceptions.ConnectionError as exc:
        raise RuntimeError(f"Google Elevation API'ye baglanilamadi: {exc}") from exc
    except requests.exceptions.RequestException as exc:
        raise RuntimeError(f"Google Elevation API istek hatasi: {exc}") from exc

    _validate_google_response(data, "Google Elevation API")

    results = data.get("results", [])
    if not results or "elevation" not in results[0]:
        raise RuntimeError(f"Rakim bilgisi cozumlenemedi: lat={latitude}, lon={longitude}")

    return round(float(results[0]["elevation"]), 2)


async def get_elevation(latitude: float, longitude: float) -> float:
    return await asyncio.to_thread(_get_elevation_sync, latitude, longitude)


def validate_country(country_code: str) -> str:
    code = country_code.upper()
    if code not in SUPPORTED_COUNTRY_CODES:
        country_name = SUPPORTED_COUNTRIES.get(code, code)
        raise UnsupportedRegionException(country_name=country_name, country_code=code)
    return code
