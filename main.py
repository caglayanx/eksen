import os

os.environ.setdefault("CREWAI_DISABLE_TELEMETRY", "1")
os.environ.setdefault("OTEL_SDK_DISABLED", "true")

import asyncio
import json
import logging
import tempfile
import threading
import time
from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field

from location_service import (
    get_elevation,
    get_country,
    validate_country,
    UnsupportedRegionException,
    SUPPORTED_COUNTRIES,
    SUPPORTED_COUNTRY_CODES,
)
from rag_engine import initialize_knowledge_base
from agents import run_analysis, _build_safe_inputs, _ensure_master_report_headings, classify_region_context
from pdf_generator import generate_tactical_pdf

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("connectivity_copilot.api")

def _build_demo_master_report(
    request: "SiteAnalysisRequest",
    country_code: str,
    country_name: str,
    elevation: float,
    region_label: str,
) -> tuple[str, dict[str, str]]:
    safe_inputs = _build_safe_inputs(
        latitude=request.latitude,
        longitude=request.longitude,
        elevation=elevation,
        personnel_count=request.personnel_count,
        data_profile=request.data_profile,
        country_code=country_code,
        country_name=country_name,
        region_label=region_label,
    )
    primary_provider = safe_inputs["ana_geo_saglayici"]
    alternate_provider = safe_inputs["alternatif_geo_saglayici"]
    install_cost = safe_inputs["anten_kurulum_maliyeti"]
    three_year_tco = safe_inputs["uc_yillik_tco"]
    terrain_profile = safe_inputs["zorluk_profili"]
    decision_rule = safe_inputs["saglayici_karar_kurali"]
    mission_context = safe_inputs["gorev_baglamı"]
    protection_focus = safe_inputs["koruma_odagi"]

    report = f"""**SEÇİLEN OPSİYON: 120 CM C/KU-BAND ANTEN + IDIRECT 9000 MODEM + {primary_provider} ANA OMURGALI HİBRİT MİMARİ**

## Güvenlik ve Regülasyon Analizi Raporu - {safe_inputs["konum_bolge"]}

## **1. YÖNETİCİ ÖZETİ**
Konum / Bölge: {safe_inputs["konum_bolge"]}

OpenRouter kota sigortası devrede olduğu için bu rapor statik şablondan değil, seçilen koordinat, ülke, bölge tipi ve sağlayıcı matrisinden türetilmiş güvenli failover çıktısıdır. {country_name} sahası için ana GEO omurgası {primary_provider} olarak belirlenmiştir; alternatif kapasite {alternate_provider} olarak tutulmalıdır.

Kritik karar gerekçesi: {decision_rule}

Görev bağlamı: {mission_context}

## **2. KARŞILAŞTIRMALI MİMARİ TABLOSU**
| Mimari Tipi | Güçlü Yön | Risk | Uygunluk |
| --- | --- | --- | --- |
| {primary_provider} GEO Omurga | {protection_focus} için kurumsal kapsama | Lisans ve koordinasyon süreci gerekir | Yüksek |
| {alternate_provider} Yedek Kapasite | Alternatif taşıyıcı esnekliği | Sözleşme ve saha erişim koşulları değişebilir | Orta-Yüksek |
| Hibrit LEO/GEO | Yedeklilik ve süreklilik | Daha yüksek CAPEX ve regülasyon kontrolü | En Uygun |

## **3. MALİYET ANALİZİ VE 3 YILLIK TCO**
| Kalem | Tahmini Maliyet |
| --- | ---: |
| 120 cm C/Ku-band anten ve RF ekipman | {install_cost} |
| iDirect 9000 modem ve ağ bileşenleri | 4.000 - 7.000 USD |
| Yedek erişim terminali | 600 - 2.500 USD |
| 3 yıllık servis ve bakım TCO | {three_year_tco} |

Topoğrafik profil: {terrain_profile}

## **4. NİHAİ ÖNERİ VE UYGULAMA YOL HARİTASI**
Nihai öneri: {primary_provider} ana omurgalı hibrit mimari, 120 cm C/Ku-band anten ve iDirect 9000 modem ile uygulanmalıdır. Gerekçe: {protection_focus}.

1. Ay: Saha keşfi, frekans ve regülasyon kontrolü tamamlanmalıdır.
2. Ay: VSAT anten, modem, yönlendirici ve yedek erişim terminali kurulmalıdır.
3. Ay: Yük devretme testleri, güvenlik politikaları ve operasyonel kabul süreci tamamlanmalıdır.

Kurumsal sonuç: Sağlayıcı seçimi ülke, koordinat ve regülasyon matrisine bağlandığı için ezbere sağlayıcı şablonu basılmaz."""
    return _ensure_master_report_headings(report, safe_inputs), safe_inputs


def _is_openrouter_quota_error(error_text: str) -> bool:
    normalized = error_text.lower()
    quota_markers = (
        "402",
        "429",
        "rate limit",
        "rate_limit",
        "free-models-per-min",
        "free-models-per-day",
        "quota",
        "insufficient credits",
        "api status error",
        "apistatuserror",
    )
    return any(marker in normalized for marker in quota_markers)


def _build_demo_result(request: "SiteAnalysisRequest", country_code: str, country_name: str, elevation: float, region_label: str) -> dict:
    demo_master_report, safe_inputs = _build_demo_master_report(request, country_code, country_name, elevation, region_label)
    return {
        "status": "success",
        "demo_mode": True,
        "country_code": country_code,
        "country_name": country_name,
        "region_label": safe_inputs["konum_bolge"],
        "input": {
            "latitude": request.latitude,
            "longitude": request.longitude,
            "elevation": elevation,
            "personnel_count": request.personnel_count,
            "data_profile": request.data_profile,
            "region_label": safe_inputs["konum_bolge"],
            "primary_geo_provider": safe_inputs["ana_geo_saglayici"],
            "alternate_geo_provider": safe_inputs["alternatif_geo_saglayici"],
            "blocked_providers": safe_inputs["yasakli_saglayicilar"],
        },
        "results": {
            "regulation_and_coverage_analysis": "Demo failover: regülasyon akışı kota hatası nedeniyle güvenli yedek raporla sürdürüldü.",
            "feasibility_report": "Demo failover: fizibilite akışı kota hatası nedeniyle güvenli yedek raporla sürdürüldü.",
            "master_report": demo_master_report,
        },
        "raw_output": demo_master_report,
    }


class Coordinate(BaseModel):
    latitude: float = Field(
        ...,
        ge=-90,
        le=90,
        description="Saha enlem koordinati (-90 ile 90 arasi)",
        examples=[39.9208],
    )
    longitude: float = Field(
        ...,
        ge=-180,
        le=180,
        description="Saha boylam koordinati (-180 ile 180 arasi)",
        examples=[32.8541],
    )
    elevation: float | None = Field(
        default=None,
        description="Google Elevation API'den metre cinsinden rakim/yukseklik",
        examples=[156.4],
    )

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Global Field Connectivity Copilot v3.1 baslatiliyor...")
    try:
        codes = sorted(SUPPORTED_COUNTRY_CODES)
        initialize_knowledge_base(codes)
        logger.info("RAG bilgi tabani hazir (%d ulke): %s", len(codes), ", ".join(codes))
    except Exception as exc:
        logger.warning("Bilgi tabani baslatma hatasi: %s", exc)
    yield
    logger.info("Servis kapatiliyor...")


app = FastAPI(
    title="Global Field Connectivity Copilot",
    description=(
        "10 hedef ulke (Turkiye ve yakin cevresi) icin uzak saha lokasyonlarinda "
        "uydu baglantisi fizibilite analizi yapan AI destekli RAG mikroservisi. "
        "3 asenkron CrewAI ajani, Google Maps ile konum tespiti, "
        "Server-Sent Events (SSE) ile anlik log akisi ve kapsamli master rapor sunar."
    ),
    version="3.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://0.0.0.0:3000",
    ],
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class SiteAnalysisRequest(Coordinate):
    personnel_count: int = Field(
        ...,
        gt=0,
        le=10000,
        description="Sahada bulunan personel sayisi",
        examples=[50],
    )
    data_profile: str = Field(
        ...,
        min_length=2,
        max_length=200,
        description="Veri kullanim profili (orn: 'anlik veri akisi', 'goruntulu gorusme')",
        examples=["anlik veri akisi"],
    )
    city: str | None = Field(
        default=None,
        max_length=120,
        description="Client reverse geocode ile cozumlenen ilce/sehir bilgisi",
    )
    province: str | None = Field(
        default=None,
        max_length=120,
        description="Client reverse geocode ile cozumlenen il/eyalet bilgisi",
    )
    region_label: str | None = Field(
        default=None,
        max_length=240,
        description="Kurumsal konum etiketi, orn: Denizli - Afyonkarahisar Sinir Hatti",
    )


def _format_region_label(request: SiteAnalysisRequest, country_name: str) -> str:
    province = request.province.strip() if request.province and request.province.strip() else None
    city = request.city.strip() if request.city and request.city.strip() else None
    region_context = classify_region_context(
        latitude=request.latitude,
        longitude=request.longitude,
        country_code="TR" if country_name.strip().lower() in {"türkiye", "turkiye", "turkey"} else "",
        country_name=country_name,
        province=province,
    )

    if request.region_label and request.region_label.strip():
        raw_label = request.region_label.strip()
        if region_context["region_type"] == "interior":
            location_name = province or city or raw_label.replace("Sınır Bölgesi", "").strip(" -") or country_name
            return f"{location_name} Stratejik Sanayi ve Üretim Bölgesi (İç Altyapı Omurgası)"
        return raw_label

    if province:
        if region_context["region_type"] == "interior":
            return f"{province} Stratejik Sanayi ve Üretim Bölgesi (İç Altyapı Omurgası)"
        return f"{province} Sınır Bölgesi"

    if region_context["region_type"] == "interior":
        return f"{country_name} İç Altyapı Bölgesi"
    return f"{country_name} Sınır Bölgesi"


class ElevationResponse(BaseModel):
    lat: float
    lon: float
    elevation: float


class PdfDownloadRequest(BaseModel):
    analysisId: str | None = None
    report: str | None = None


@app.get("/", tags=["Health"])
async def root():
    return {
        "service": "Global Field Connectivity Copilot",
        "version": "3.1.0",
        "status": "operational",
        "supported_countries": len(SUPPORTED_COUNTRIES),
    }


@app.get("/health", tags=["Health"])
async def health_check():
    return {"status": "healthy"}


@app.get(
    "/api/v1/elevation",
    response_model=ElevationResponse,
    responses={
        500: {"description": "Sunucu hatasi"},
        503: {"description": "Google Elevation API gecici olarak kullanilamiyor"},
        422: {"description": "Gecersiz koordinat verisi"},
    },
    tags=["Analysis"],
    summary="Koordinat icin Google Elevation API rakim verisi",
)
async def elevation_lookup(
    latitude: float = Query(..., ge=-90, le=90),
    longitude: float = Query(..., ge=-180, le=180),
):
    try:
        elevation = await get_elevation(latitude=latitude, longitude=longitude)
    except ValueError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return {
        "lat": latitude,
        "lon": longitude,
        "elevation": elevation,
    }


@app.post("/api/v1/download-pdf", tags=["Analysis"], summary="Master analiz raporunu PDF olarak indir")
async def download_pdf(payload: PdfDownloadRequest):
    if not payload.report:
        raise HTTPException(status_code=400, detail="PDF oluşturmak için rapor metni gereklidir.")
    report_text = payload.report
    today = datetime.utcnow().strftime("%Y-%m-%d")
    filename = f"EKSEN_Master_Analiz_Raporu_{today}.pdf"
    output_path = os.path.join(tempfile.gettempdir(), filename)
    generate_tactical_pdf(report_text, output_path)

    return FileResponse(
        output_path,
        media_type="application/pdf",
        filename=filename,
    )


@app.post(
    "/api/v1/analyze-site",
    responses={
        400: {"description": "Desteklenmeyen bolge"},
        500: {"description": "Sunucu hatasi"},
        503: {"description": "Servis gecici olarak kullanilamiyor"},
        422: {"description": "Gecersiz istek verisi"},
    },
    tags=["Analysis"],
    summary="Saha uydu baglantisi fizibilite analizi (3 Ajanli SSE stream)",
    description=(
        "Verilen GPS koordinatlari, personel sayisi ve veri profili icin "
        "Google Maps ile ulke tespiti yapar, ardindan 3 asenkron CrewAI ajani "
        "ile kapsamli analizi baslatir. Ajan 1 ve 2 paralel calisir, Ajan 3 "
        "ikisinin ciktisini birlestirerek master raporu olusturur. "
        "Sonuclar Server-Sent Events (SSE) ile canli olarak stream edilir."
    ),
)
async def analyze_site(request: SiteAnalysisRequest):
    elevation = request.elevation
    if elevation is None:
        try:
            elevation = await get_elevation(
                latitude=request.latitude,
                longitude=request.longitude,
            )
        except ValueError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

    try:
        country_info = get_country(
            latitude=request.latitude,
            longitude=request.longitude,
        )
    except ValueError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    country_code = country_info["country_code"]
    country_name = country_info["country_name"]
    region_label = _format_region_label(request, country_name)
    logger.info("Tespit edilen ulke: %s (%s)", country_name, country_code)

    try:
        country_code = validate_country(country_code)
    except UnsupportedRegionException:
        logger.warning("Desteklenmeyen bolge: %s (%s)", country_name, country_code)
        raise HTTPException(
            status_code=400,
            detail="Secilen lokasyon projenin kapsadigi 10 hedef ulke disinda kalmaktadir.",
        )

    stream_queue: asyncio.Queue = asyncio.Queue()
    loop = asyncio.get_running_loop()

    def _run_analysis_thread():
        try:
            result = run_analysis(
                latitude=request.latitude,
                longitude=request.longitude,
                elevation=elevation,
                personnel_count=request.personnel_count,
                data_profile=request.data_profile,
                country_code=country_code,
                country_name=country_name,
                region_label=region_label,
                stream_queue=stream_queue,
                loop=loop,
            )
            asyncio.run_coroutine_threadsafe(
                stream_queue.put({"type": "result", "data": result}),
                loop,
            )
        except Exception as exc:
            logger.exception("Analiz thread hatasi")
            error_text = str(exc)
            if _is_openrouter_quota_error(error_text):
                logger.warning("OpenRouter kota/API hatasi algilandi, demo failover devrede.")
                demo_result = _build_demo_result(request, country_code, country_name, elevation, region_label)
                asyncio.run_coroutine_threadsafe(
                    stream_queue.put({"type": "demo_result", "data": demo_result, "error": error_text}),
                    loop,
                )
            else:
                asyncio.run_coroutine_threadsafe(
                    stream_queue.put({"type": "error", "data": error_text}),
                    loop,
                )

    start_time = time.time()

    async def _event_generator():
        try:
            bootstrap_events = [
                ("agent1", "[A1] Regülasyon ve ithalat terminali başlatıldı.\n"),
                ("agent2", "[A2] Topografya ve fizibilite terminali başlatıldı.\n"),
            ]
            for agent, text in bootstrap_events:
                payload = {"type": "agent_token", "agent": agent, "text": text}
                yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"

            thread = threading.Thread(target=_run_analysis_thread, daemon=True)
            thread.start()

            while True:
                try:
                    item = await asyncio.wait_for(stream_queue.get(), timeout=0.08)
                except asyncio.TimeoutError:
                    if not thread.is_alive():
                        break
                    continue

                msg_type = item.get("type")

                if msg_type == "result":
                    result_data = item["data"]
                    yield f"data: {json.dumps({'type': 'control', 'action': 'merge_terminals'}, ensure_ascii=False)}\n\n"
                    result_data["coordinate"] = {
                        "lat": request.latitude,
                        "lon": request.longitude,
                        "elevation": elevation,
                    }
                    result_data["region_label"] = region_label
                    result_data["processing_time_seconds"] = round(time.time() - start_time, 2)
                    yield f"data: {json.dumps(result_data, ensure_ascii=False)}\n\n"
                    break

                elif msg_type == "demo_result":
                    result_data = item["data"]
                    logger.warning("Demo failover SSE akisi baslatiliyor: %s", item.get("error", "bilinmeyen kota hatasi"))
                    demo_sequences = [
                        ("agent1", "OpenRouter kota sigortası devrede. Regülasyon özeti güvenli demo raporundan aktarılıyor.\n"),
                        ("agent2", "Fizibilite özeti güvenli demo raporundan aktarılıyor. Hibrit mimari değerlendirmesi hazırlanıyor.\n"),
                    ]
                    for agent, text in demo_sequences:
                        for token in text.split(" "):
                            payload = {"type": "agent_token", "agent": agent, "text": f"{token} "}
                            yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
                            await asyncio.sleep(0.04)

                    yield f"data: {json.dumps({'type': 'control', 'action': 'merge_terminals'}, ensure_ascii=False)}\n\n"
                    await asyncio.sleep(0.2)

                    master_report = result_data["results"]["master_report"]
                    for token in master_report.split(" "):
                        payload = {"type": "agent_token", "agent": "agent3", "text": f"{token} "}
                        yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
                        await asyncio.sleep(0.04)

                    result_data["coordinate"] = {
                        "lat": request.latitude,
                        "lon": request.longitude,
                        "elevation": elevation,
                    }
                    result_data["region_label"] = region_label
                    result_data["processing_time_seconds"] = round(time.time() - start_time, 2)
                    yield f"data: {json.dumps(result_data, ensure_ascii=False)}\n\n"
                    break

                elif msg_type == "error":
                    error_data = {
                        "status": "error",
                        "type": "error",
                        "message": item["data"],
                        "detail": item["data"],
                        "processing_time_seconds": round(time.time() - start_time, 2),
                    }
                    yield f"data: {json.dumps(error_data, ensure_ascii=False)}\n\n"
                    break

                elif msg_type == "agent_token":
                    token_entry = {
                        "type": "agent_token",
                        "agent": item.get("agent", "agent1"),
                        "text": item["data"],
                    }
                    yield f"data: {json.dumps(token_entry, ensure_ascii=False)}\n\n"
        except Exception as exc:
            logger.exception("SSE generator guvenli kapanis hatasi")
            safe_token = {
                "type": "agent_token",
                "agent": "agent1",
                "text": "Dinamik güvenli mod aktif. Frontend yerel fallback protokolü hazırlanıyor.\n",
            }
            graceful_error = {
                "type": "error",
                "message": "API_LIMIT",
                "detail": "API_LIMIT",
                "reason": str(exc),
            }
            yield f"data: {json.dumps(safe_token, ensure_ascii=False)}\n\n"
            yield f"data: {json.dumps(graceful_error, ensure_ascii=False)}\n\n"
        finally:
            yield f"data: {json.dumps({'type': 'done'}, ensure_ascii=False)}\n\n"
            yield f"event: done\ndata: {{}}\n\n"

    return StreamingResponse(
        _event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info",
    )
