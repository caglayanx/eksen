import os
import asyncio
import logging
import re
from typing import Any

from dotenv import load_dotenv
from crewai import Agent, Task, Crew, Process, LLM
try:
    from langchain.callbacks.base import BaseCallbackHandler
except ModuleNotFoundError:
    from langchain_core.callbacks import BaseCallbackHandler
from openai import RateLimitError, APIConnectionError, APIStatusError
from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
    retry_if_exception,
    before_sleep_log,
)

from tools import create_search_tool

load_dotenv()

api_key = os.getenv("OPENROUTER_API_KEY")
if not api_key:
    raise ValueError("OPENROUTER_API_KEY ortam degiskeni bulunamadi. .env dosyasini kontrol edin.")
os.environ["OPENROUTER_API_KEY"] = api_key

logger = logging.getLogger("connectivity_copilot.agents")

PRIMARY_MODEL = "openrouter/nvidia/nemotron-nano-9b-v2:free"
FALLBACK_MODEL = "openrouter/openrouter/auto"
DEFAULT_LLM_TEMPERATURE = 0.2
REPORT_LLM_TEMPERATURE = 0.1
AGENT_MAX_TOKENS = 500
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
MAX_RETRY_ATTEMPTS = 6
RETRY_MIN_WAIT = 5
RETRY_MAX_WAIT = 90

TERMINOLOGY_OVERRIDE_RULE = (
    "CRITICAL RULE: Irak bölgesi, Duhok/Dohuk/Duhok hattı veya Hakkari-Irak sınırı hakkında "
    "konuşurken, analiz yaparken veya RAG verisini özetlerken ASLA yerel/yabancı alfabe, "
    "Arapça harf, Kürdistan veya türevi bir ifade kullanma. Bu bölgeyi tanımlamak için "
    "İSTİSNASIZ olarak sadece 'Kuzey Irak - Hakkari Sınır Hattı' ifadesini kullanacaksın. "
    "Bu kural tüm topografik, politik, teknik, mali ve regülasyon analizleri için geçerlidir."
)

REPORT_LANGUAGE_GUARDRAILS = """
KURAL 1: Çıktı KESİNLİKLE %100 kusursuz, profesyonel, kurumsal ve dilbilgisi kurallarına uygun TÜRKÇE olmalıdır.
KURAL 2: Türkçe karakterleri (Ç, Ş, Ğ, Ü, İ, Ö, ç, ş, ğ, ü, ı, ö) kusursuz kullan. Asla "Oneri" yazma, "Öneri" yaz. Asla "Ozet" yazma, "Özet" yaz. Asla "Cozum" yazma, "Çözüm" yaz.
KURAL 3: HALÜSİNASYON YASAKTIR. Metnin içine kesinlikle İngilizce cümleler, Japonca, Korece, Arapça harfler veya "커설atif", "satıcı名告", "seçへぇcement" gibi anlamsız/bozuk kelimeler KARIŞTIRMA.
KURAL 4: Rakamları, teknik terimleri (CAPEX, OPEX, TCO, Mbps, Ku-band, Ka-band, C-band) ve donanım adlarını (Hughes, iDirect, Gilat, Newtec ve ülkeye uygun LEO/terminal adları) bozmadan, uydurma ekler getirmeden ilk iki rapordaki gibi kullan.
KURAL 5: Rapor yalnızca Markdown üretmelidir. İç muhakeme, sistem notu, araç çıktısı, prompt veya görev talimatı yazma.
KURAL 6: Yazdığın tüm rapor, başlıklar ve tablolar KUSURSUZ BİR TÜRKÇE ile yazılmalıdır. İngilizce klavye alışkanlığıyla karakter yutulması KESİNLİKLE YASAKTIR. Şu kelimeleri istisnasız bu şekilde yazacaksın: "Öneri", "Çözüm", "Özet", "Hava Koşulları", "Bant Genişliği", "Bölge", "Dezavantajlar", "Bileşen", "Hazırlanmış", "Şekilde".
KURAL 7: Kelimeler ve bağlaçlar arasında her zaman dilbilgisi kurallarına uygun standart boşluk bırakılacaktır. "veRegülasyon", "ve_hybrid", "veMaliyet" gibi bitişik veya alt çizgili birleşimler KESİNLİKLE YASAKTIR.
KURAL 8: "satelliitler" yazma; bağlama göre "Uydular" veya "Uydu Şebekeleri" yaz. "dezaneteler" yazma; "Dezavantajlar" yaz. "Mimarilik" yazma; "Mimari Tipi" yaz. "Komponent" yazma; "Bileşen" veya "İş Kalemi" yaz.
KURAL 9: "RAPORU TEKNIK RAPOR", "RAPORU TEKNİK RAPOR" veya benzeri kaba üretim notlarıyla başlayan alt not yazma. Rapor kurumsal ve temiz bir kapanış cümlesiyle bitmelidir.
""".strip()

SELECTED_OPTION_RULE = (
    "KURAL: Raporun KESİNLİKLE EN ÜSTÜNDE, başka hiçbir giriş metni olmadan, "
    "analizin sonucunda seçilen en uygun uydu, anten, modem ve mimari opsiyonunu "
    "BÜYÜK HARFLERLE ve KALIN Markdown olarak yazacaksın. Sağlayıcı adını asla sabit şablondan alma; "
    "yalnızca bu istekte verilen 'Ana GEO Sağlayıcısı' alanını kullan. Format yapısı şöyledir: "
    "**SEÇİLEN OPSİYON: [ANTEN] + [MODEM/TERMİNAL] + [DİNAMİK ANA GEO SAĞLAYICISI] ANA OMURGALI HİBRİT MİMARİ**. "
    "Bu başlık, raporun geri kalanından görsel olarak ayrılmalı ve bir Taktiksel Emir netliğinde olmalıdır. "
    "Bu başlık için de kusursuz Türkçe, doğru karakter kullanımı ve halüsinasyon yasağı eksiksiz geçerlidir."
)
REGION_LABEL_RULE = (
    "KURAL: Raporun üst kısımlarında, meta-veri alanlarında ve başlıklarda asla tekil ilçe isimlerini "
    "(ör. Çivril vb.) ana konum etiketi olarak kullanmayacaksın. Bölge tipi 'interior' ise konumu "
    "'[İl] Stratejik Sanayi ve Üretim Bölgesi (İç Altyapı Omurgası)' şeklinde yazacaksın. "
    "Yalnızca dış sınıra yakın gerçek sınır bölgelerinde 'X - Y İl Sınır Hattı' veya '[Bölge] Sınır Bölgesi' "
    "ifadesini kullanabilirsin."
)
DYNAMIC_COST_RULE = (
    "KURAL: Maliyet tablosu statik şablon olmayacaktır. Rakım, Konum / Bölge ve topoğrafik zorluk "
    "parametrelerine göre CAPEX, kurulum ve 3 yıllık TCO aralıklarını dinamik belirleyeceksin. "
    "Düşük rakım ve kolay erişimli sahalarda düşük bant kullan: Anten/Kurulum 3.000 - 5.000 USD, "
    "3 Yıllık TCO 20.000 - 35.000 USD. Irak sınırı, Hakkari hattı, dağlık saha veya 1.000 m üstü "
    "rakımda yüksek bant kullan: Anten/Kurulum 8.000 - 12.000 USD, 3 Yıllık TCO 50.000 - 75.000 USD. "
    "Her raporda aynı maliyetleri kopyalama; maliyet gerekçesini rakım ve saha zorluğuyla açıkla."
)
COUNTRY_PROVIDER_MATRIX_RULE = (
    "KRİTİK ÜLKE-UYDU SAĞLAYICI MATRİSİ: Uydu omurgası önerisini asla ezbere şablondan seçme. "
    "Eğer hedef ülke İran ise Türksat, TURKSAT veya TÜRKSAT GEO VSAT ibaresi KESİNLİKLE yasaktır; "
    "ana GEO omurgası sadece 'INTELSAT / EUTELSAT MEA BEAM' veya "
    "'İRAN ULUSAL UYDU ŞEBEKESİ (ZAFAR/MAHDA MATRIX)' olabilir. "
    "Eğer hedef ülke Suriye ise ana GEO omurgası 'EUTELSAT / ARABSAT OMNI OMA' olmalıdır. "
    "Eğer hedef ülke Yunanistan veya Bulgaristan ise 'HELLAS SAT' veya 'EUTELSAT KONNECT' önerilmelidir. "
    "'TÜRKSAT GEO VSAT' omurgası yalnızca hedef ülke Türkiye olduğunda veya Türkiye'nin resmi sınır ötesi "
    "harekat/üs bölgeleri için birincil omurga olarak önerilebilir. "
    "SEÇİLEN OPSİYON, Yönetici Özeti ve Nihai Öneri bölümlerinde bu matrisle çelişen sağlayıcı yazmak yasaktır."
)
REGION_CONTEXT_RULE = (
    "KRİTİK COĞRAFİ TUTARLILIK KURALI: Bölge tipi 'interior' ise raporda 'Sınır Bölgesi', "
    "'Sınır Hattı', 'Sınır ötesi operasyon sahası', 'resmi sınır ötesi harekat/üs sahası' veya "
    "'sınır hattı koruması' ifadelerini kullanma. İç bölgelerde görev dili "
    "'Merkezi Altyapı Redundancy ve Stratejik İletişim Güvenliği' olmalıdır. "
    "İç bölgede TÜRKSAT GEO VSAT önerilebilir; gerekçe karasal hatların çökmesine karşı "
    "merkezi yedekleme ve stratejik iletişim sürekliliğidir."
)

MASTER_REPORT_HEADINGS = (
    "**1. YÖNETİCİ ÖZETİ**",
    "**2. KARŞILAŞTIRMALI MİMARİ TABLOSU**",
    "**3. MALİYET ANALİZİ VE 3 YILLIK TCO**",
    "**4. NİHAİ ÖNERİ VE UYGULAMA YOL HARİTASI**",
)

BROKEN_SCRIPT_REPLACEMENTS = {
    "Oneri": "Öneri",
    "onerisi": "önerisi",
    "ONERI": "ÖNERİ",
    "Ozet": "Özet",
    "ozet": "özet",
    "OZET": "ÖZET",
    "Cozum": "Çözüm",
    "cozum": "çözüm",
    "COZUM": "ÇÖZÜM",
    "Yonetici": "Yönetici",
    "Karsilastirmali": "Karşılaştırmalı",
    "Maliyet Analizi": "Maliyet Analizi",
    "Nihai Oneri": "Nihai Öneri",
    "Uygulama Yol Haritasi": "Uygulama Yol Haritası",
    "Cosullari": "Koşulları",
    "Kosullari": "Koşulları",
    "kosullari": "koşulları",
    "Hava Kosullari": "Hava Koşulları",
    "Bant Genisligi": "Bant Genişliği",
    "bant genisligi": "bant genişliği",
    "Bolge": "Bölge",
    "bolge": "bölge",
    "Dezavantajlar": "Dezavantajlar",
    "dezaneteler": "Dezavantajlar",
    "satelliitler": "Uydu Şebekeleri",
    "Mimarilik": "Mimari Tipi",
    "Komponent": "Bileşen",
    "komponent": "bileşen",
    "Bilesen": "Bileşen",
    "bilesen": "bileşen",
    "Hazirlanmis": "Hazırlanmış",
    "hazirlanmis": "hazırlanmış",
    "Sekilde": "Şekilde",
    "sekilde": "şekilde",
    "veRegülasyon": "ve Regülasyon",
    "veRegulasyon": "ve Regülasyon",
    "ve_hybrid": "ve hibrit",
    "veHibrit": "ve Hibrit",
    "veMaliyet": "ve Maliyet",
}

NON_TURKISH_SCRIPT_PATTERN = re.compile(r"[\u0600-\u06FF\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF]+")
UGLY_REPORT_NOTE_PATTERN = re.compile(r"\n?\s*RAPORU\s+TEKN[İI]K\s+RAPOR.*$", re.IGNORECASE | re.DOTALL)
JOINED_CONJUNCTION_PATTERN = re.compile(r"\b(ve|ile)(?=[A-ZÇĞİÖŞÜ])")
UNDERSCORE_JOIN_PATTERN = re.compile(r"\b(ve|ile)_+([A-Za-zÇĞİÖŞÜçğıöşü]+)")
SELECTED_OPTION_PATTERN = re.compile(r"^\s*(?:#+\s*)?\*{0,2}SEÇİLEN OPSİYON\s*:", re.IGNORECASE)
TURKSAT_PATTERN = re.compile(r"\b(?:T[ÜU]RKSAT|Turksat|Türksat)(?:\s+(?:GEO|VSAT|GEO\s+VSAT|5A|5B|ana\s+omurga(?:sı)?|omurga(?:sı)?))*", re.IGNORECASE)
IRAQ_REGION_PATTERN = re.compile(
    r"(?:دهوك|duhok|dohuk|irak|iraq|kürdistan|kurdistan|hakkari\s*[-/]\s*irak|irak\s*[-/]\s*hakkari)",
    re.IGNORECASE,
)
EMPTY_MONTH_PATTERN = re.compile(r"(?m)^(\s*[-*]?\s*)Ay\s*:", re.IGNORECASE)
INTERIOR_FORBIDDEN_PHRASES = (
    (re.compile(r"\bSınır\s+Bölgesi\b", re.IGNORECASE), "İç Altyapı Bölgesi"),
    (re.compile(r"\bSınır\s+Hattı\b", re.IGNORECASE), "İç Altyapı Omurgası"),
    (re.compile(r"\bSınır\s*ötesi\s+operasyon\s+sahası\b", re.IGNORECASE), "Stratejik İç Altyapı Sahası"),
    (re.compile(r"\bresmi\s+sınır\s*ötesi\s+harekat/üs\s+sahası\b", re.IGNORECASE), "merkezi iç altyapı sahası"),
    (re.compile(r"\bsınır\s+hattı\s+koruması\b", re.IGNORECASE), "Merkezi Altyapı Redundancy ve Stratejik İletişim Güvenliği"),
    (re.compile(r"\bsınır\s+güvenliği\b", re.IGNORECASE), "merkezi iletişim güvenliği"),
)
TURKIYE_BORDER_POINTS = (
    (37.05, 42.35),  # Hakkari / Irak hattı
    (36.20, 36.15),  # Hatay / Suriye hattı
    (36.85, 38.35),  # Şanlıurfa / Suriye hattı
    (36.72, 40.90),  # Mardin / Suriye hattı
    (40.72, 26.08),  # Edirne / Yunanistan-Bulgaristan hattı
)
TURKIYE_COASTAL_POINTS = (
    (41.00, 29.00),  # Marmara kıyı referansı
    (39.65, 26.60),  # Ege kıyı referansı
    (36.90, 30.70),  # Akdeniz kıyı referansı
    (41.30, 36.30),  # Karadeniz kıyı referansı
)
FOREIGN_REGION_REPLACEMENTS = (
    (re.compile(r"استان\s*خراسان\s*جنوبی", re.IGNORECASE), "Güney Horasan (South Khorasan)"),
    (re.compile(r"\bSouth\s+Khorasan\b", re.IGNORECASE), "Güney Horasan (South Khorasan)"),
    (re.compile(r"\bAfghanistan\b", re.IGNORECASE), "Afganistan"),
)


class AgentStreamingCallback(BaseCallbackHandler):
    """Streams raw LLM tokens into the FastAPI SSE queue without reading stdout."""

    def __init__(self, stream_queue: asyncio.Queue | None, loop: asyncio.AbstractEventLoop | None, agent_name: str):
        self.stream_queue = stream_queue
        self.loop = loop
        self.agent_name = agent_name

    def on_llm_new_token(self, token: str, **kwargs: Any) -> None:
        if not token or self.stream_queue is None or self.loop is None or self.loop.is_closed():
            return

        asyncio.run_coroutine_threadsafe(
            self.stream_queue.put(
                {
                    "type": "agent_token",
                    "agent": self.agent_name,
                    "data": token,
                }
            ),
            self.loop,
        )


def _build_llm(
    model: str,
    temperature: float = DEFAULT_LLM_TEMPERATURE,
    callbacks: list[BaseCallbackHandler] | None = None,
) -> LLM:
    return LLM(
        model=model,
        temperature=temperature,
        api_key=api_key,
        base_url=OPENROUTER_BASE_URL,
        callbacks=callbacks or [],
        stream=bool(callbacks),
        max_tokens=AGENT_MAX_TOKENS,
    )


def _apply_provider_constraints(text: str, safe_inputs: dict[str, str] | None = None) -> str:
    if not safe_inputs:
        return text

    primary_provider = safe_inputs.get("ana_geo_saglayici", "EUTELSAT / INTELSAT bölgesel kapsama")
    blocked_providers = safe_inputs.get("yasakli_saglayicilar", "")
    turksat_is_blocked = "TÜRKSAT" in blocked_providers.upper() or "TURKSAT" in blocked_providers.upper()

    if turksat_is_blocked and primary_provider.upper() != "TÜRKSAT GEO VSAT":
        return TURKSAT_PATTERN.sub(primary_provider, text)

    return text


def _apply_region_context_constraints(text: str, safe_inputs: dict[str, str] | None = None) -> str:
    if not safe_inputs or safe_inputs.get("region_type") != "interior":
        return text

    cleaned = text
    for pattern, replacement in INTERIOR_FORBIDDEN_PHRASES:
        cleaned = pattern.sub(replacement, cleaned)
    return cleaned


def _normalize_south_khorasan_label(text: str) -> str:
    normalized = re.sub(
        r"Güney\s+Horasan\s*\(\s*Güney\s+Horasan\s*\(South\s+Khorasan\)\s*\)?",
        "Güney Horasan (South Khorasan)",
        text,
        flags=re.IGNORECASE,
    )
    return re.sub(
        r"(Güney Horasan \(South Khorasan\)).*?(?:Afganistan)?\s*(?:Sınır\s*Hattı|Border\s*Line)",
        "Güney Horasan (South Khorasan) - Afganistan Sınır Hattı",
        normalized,
        flags=re.IGNORECASE,
    )


def _clean_master_report_language(text: str, safe_inputs: dict[str, str] | None = None) -> str:
    cleaned = IRAQ_REGION_PATTERN.sub("Kuzey Irak - Hakkari Sınır Hattı", text)
    for pattern, replacement in FOREIGN_REGION_REPLACEMENTS:
        cleaned = pattern.sub(replacement, cleaned)
    cleaned = NON_TURKISH_SCRIPT_PATTERN.sub("", cleaned)
    cleaned = _normalize_south_khorasan_label(cleaned)
    cleaned = UGLY_REPORT_NOTE_PATTERN.sub("", cleaned)
    cleaned = JOINED_CONJUNCTION_PATTERN.sub(r"\1 ", cleaned)
    cleaned = UNDERSCORE_JOIN_PATTERN.sub(r"\1 \2", cleaned)
    cleaned = _apply_provider_constraints(cleaned, safe_inputs)
    cleaned = _apply_region_context_constraints(cleaned, safe_inputs)
    cleaned = re.sub(
        r"(Kuzey Irak - Hakkari Sınır Hattı)(?:\s*[-–]\s*Hakkari Sınır Hattı)+",
        r"\1",
        cleaned,
    )
    cleaned = re.sub(
        r"(Kuzey\s+)+(Irak - Hakkari Sınır Hattı)",
        r"Kuzey \2",
        cleaned,
    )
    cleaned = re.sub(
        r"(Kuzey Irak - Hakkari Sınır Hattı)\s+hattı\b",
        r"\1",
        cleaned,
        flags=re.IGNORECASE,
    )
    month_counter = 0

    def _replace_empty_month(match: re.Match) -> str:
        nonlocal month_counter
        month_counter += 1
        return f"{match.group(1)}{month_counter}. Ay:"

    cleaned = EMPTY_MONTH_PATTERN.sub(_replace_empty_month, cleaned)
    for wrong, right in BROKEN_SCRIPT_REPLACEMENTS.items():
        cleaned = cleaned.replace(wrong, right)
    return cleaned


def _ensure_selected_option_heading(text: str, safe_inputs: dict[str, str] | None = None) -> str:
    cleaned = text.strip()
    if not cleaned:
        return cleaned

    primary_provider = (safe_inputs or {}).get(
        "ana_geo_saglayici",
        "BÖLGEYE UYGUN GEO/LEO HİBRİT OMURGA",
    )

    if SELECTED_OPTION_PATTERN.match(cleaned):
        lines = cleaned.splitlines()
        if lines and (primary_provider not in lines[0] or "ANA OMURGALI HİBRİT MİMARİ" not in lines[0]):
            lines[0] = (
                f"**SEÇİLEN OPSİYON: 120 CM C/KU-BAND ANTEN + IDIRECT 9000 MODEM + "
                f"{primary_provider} ANA OMURGALI HİBRİT MİMARİ**"
            )
        return "\n".join(lines)

    return (
        f"**SEÇİLEN OPSİYON: 120 CM C/KU-BAND ANTEN + IDIRECT 9000 MODEM + "
        f"{primary_provider} ANA OMURGALI HİBRİT MİMARİ**\n\n"
        f"{cleaned}"
    )


def _ensure_master_report_headings(text: str, safe_inputs: dict[str, str] | None = None) -> str:
    cleaned = _clean_master_report_language(text, safe_inputs).strip()
    if not cleaned:
        return cleaned

    missing_headings = [heading for heading in MASTER_REPORT_HEADINGS if heading not in cleaned]
    if not missing_headings:
        return _ensure_selected_option_heading(cleaned, safe_inputs)

    return _ensure_selected_option_heading(
        "## **1. YÖNETİCİ ÖZETİ**\n"
        f"{cleaned}\n\n"
        "## **2. KARŞILAŞTIRMALI MİMARİ TABLOSU**\n"
        "Regülasyon ve fizibilite raporundaki mimari seçenekler yukarıdaki analiz içinde değerlendirilmiştir.\n\n"
        "## **3. MALİYET ANALİZİ VE 3 YILLIK TCO**\n"
        "CAPEX, OPEX ve TCO kalemleri fizibilite çıktısındaki rakamlar korunarak yorumlanmalıdır.\n\n"
        "## **4. NİHAİ ÖNERİ VE UYGULAMA YOL HARİTASI**\n"
        "Nihai mimari seçimi, sahadaki kapsama, regülasyon ve maliyet riskleri birlikte değerlendirilerek uygulanmalıdır.",
        safe_inputs,
    )


def _safe_prompt_value(value: Any, fallback: str = "") -> str:
    if value is None:
        return fallback
    if isinstance(value, (list, tuple, set)):
        return ", ".join(_safe_prompt_value(item, fallback) for item in value)
    if isinstance(value, dict):
        return ", ".join(f"{key}: {_safe_prompt_value(item, fallback)}" for key, item in value.items())
    return str(value)


def _safe_float(value: Any, fallback: float = 0.0) -> float:
    if isinstance(value, (list, tuple, set)):
        value = next(iter(value), fallback)
    if isinstance(value, dict):
        value = next(iter(value.values()), fallback)
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback


def _safe_int(value: Any, fallback: int = 1) -> int:
    if isinstance(value, (list, tuple, set)):
        value = next(iter(value), fallback)
    if isinstance(value, dict):
        value = next(iter(value.values()), fallback)
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


def _distance_km(latitude_a: float, longitude_a: float, latitude_b: float, longitude_b: float) -> float:
    # Equirectangular approximation is enough for a coarse border/coast proximity guard.
    lat_delta = (latitude_a - latitude_b) * 111.0
    lon_delta = (longitude_a - longitude_b) * 85.0
    return (lat_delta ** 2 + lon_delta ** 2) ** 0.5


def classify_region_context(
    latitude: float,
    longitude: float,
    country_code: str,
    country_name: str,
    province: str | None = None,
) -> dict[str, str]:
    safe_latitude = _safe_float(latitude)
    safe_longitude = _safe_float(longitude)
    normalized_country = _normalize_country_name(country_name)
    normalized_code = _safe_prompt_value(country_code, "").strip().upper()
    is_turkiye = normalized_code == "TR" or normalized_country in {"turkiye", "turkey"}

    if is_turkiye:
        border_distance = min(
            _distance_km(safe_latitude, safe_longitude, point_latitude, point_longitude)
            for point_latitude, point_longitude in TURKIYE_BORDER_POINTS
        )
        coast_distance = min(
            _distance_km(safe_latitude, safe_longitude, point_latitude, point_longitude)
            for point_latitude, point_longitude in TURKIYE_COASTAL_POINTS
        )

        if border_distance <= 140:
            return {
                "region_type": "border",
                "gorev_baglamı": "Sınır hattı sürekliliği ve taktik haberleşme güvenliği",
                "gorev_baglami": "Sınır hattı sürekliliği ve taktik haberleşme güvenliği",
                "koruma_odagi": "sınır hattı haberleşme sürekliliği",
            }

        if coast_distance <= 90:
            return {
                "region_type": "coastal",
                "gorev_baglamı": "Kıyı şeridi haberleşme sürekliliği ve deniz/kara yedek erişim güvenliği",
                "gorev_baglami": "Kıyı şeridi haberleşme sürekliliği ve deniz/kara yedek erişim güvenliği",
                "koruma_odagi": "kıyı ve bölgesel altyapı yedekliliği",
            }

        province_name = _safe_prompt_value(province, "İç Bölge").strip() or "İç Bölge"
        return {
            "region_type": "interior",
            "gorev_baglamı": "Merkezi Altyapı Redundancy ve Stratejik İletişim Güvenliği",
            "gorev_baglami": "Merkezi Altyapı Redundancy ve Stratejik İletişim Güvenliği",
            "koruma_odagi": (
                f"{province_name} iç altyapısında karasal hatların çökmesine karşı merkezi yedekleme "
                "ve stratejik iletişim sürekliliği"
            ),
        }

    return {
        "region_type": "border",
        "gorev_baglamı": "Bölgesel regülasyon ve saha haberleşme sürekliliği",
        "gorev_baglami": "Bölgesel regülasyon ve saha haberleşme sürekliliği",
        "koruma_odagi": "bölgesel uydu haberleşme sürekliliği",
    }


def _normalize_country_name(country_name: str) -> str:
    normalized = _safe_prompt_value(country_name, "").strip().lower()
    replacements = {
        "ı": "i",
        "i̇": "i",
        "ğ": "g",
        "ü": "u",
        "ş": "s",
        "ö": "o",
        "ç": "c",
    }
    for source, target in replacements.items():
        normalized = normalized.replace(source, target)
    return normalized


def _is_inside_iran(latitude: float, longitude: float) -> bool:
    safe_latitude = _safe_float(latitude)
    safe_longitude = _safe_float(longitude)
    return 24.0 <= safe_latitude <= 40.5 and 44.0 <= safe_longitude <= 64.5


def _is_turkiye_cross_border_region(region_label: str) -> bool:
    normalized_region = _normalize_country_name(region_label)
    return any(
        term in normalized_region
        for term in (
            "kuzey irak",
            "hakkari sinir",
            "suriye sinir",
            "resmi harekat",
            "us bolgesi",
            "us bolge",
        )
    )


def _build_provider_profile(
    country_code: str,
    country_name: str,
    region_label: str,
    latitude: float,
    longitude: float,
    region_type: str = "border",
) -> dict[str, str]:
    normalized_country = _normalize_country_name(country_name)
    normalized_code = _safe_prompt_value(country_code, "").strip().upper()
    iran_by_coordinate = _is_inside_iran(latitude, longitude)

    if normalized_country in {"iran", "iran islam cumhuriyeti"} or normalized_code == "IR" or iran_by_coordinate:
        return {
            "hedef_ulke": "İran",
            "ana_geo_saglayici": "INTELSAT / EUTELSAT MEA BEAM",
            "alternatif_geo_saglayici": "İRAN ULUSAL UYDU ŞEBEKESİ (ZAFAR/MAHDA MATRIX)",
            "yasakli_saglayicilar": "TÜRKSAT, TURKSAT, Türksat GEO VSAT",
            "saglayici_karar_kurali": (
                "İran sahasında ambargo, ulusal güvenlik ve yerel yetkilendirme riski nedeniyle "
                "Türksat birincil veya yedek omurga olarak önerilemez. Ana GEO omurgası "
                "INTELSAT / EUTELSAT MEA BEAM; yerel uyum alternatifi İRAN ULUSAL UYDU ŞEBEKESİ "
                "(ZAFAR/MAHDA MATRIX) olmalıdır."
            ),
        }

    if normalized_country == "suriye" or normalized_code == "SY":
        return {
            "hedef_ulke": "Suriye",
            "ana_geo_saglayici": "EUTELSAT / ARABSAT OMNI OMA",
            "alternatif_geo_saglayici": "INTELSAT MEA yedek kapasitesi",
            "yasakli_saglayicilar": "TÜRKSAT birincil omurga",
            "saglayici_karar_kurali": (
                "Suriye sahasında ana GEO omurgası EUTELSAT / ARABSAT OMNI OMA olarak yazılmalı; "
                "Türksat yalnızca resmi Türkiye sınır ötesi harekat/üs gerekçesi açıkça varsa ikincil risk notu olarak anılabilir."
            ),
        }

    if normalized_country in {"yunanistan", "greece", "bulgaristan", "bulgaria"} or normalized_code in {"GR", "BG"}:
        return {
            "hedef_ulke": "Yunanistan/Bulgaristan",
            "ana_geo_saglayici": "HELLAS SAT",
            "alternatif_geo_saglayici": "EUTELSAT KONNECT",
            "yasakli_saglayicilar": "TÜRKSAT birincil omurga",
            "saglayici_karar_kurali": (
                "Yunanistan veya Bulgaristan sahasında ana GEO omurgası HELLAS SAT ya da EUTELSAT KONNECT olmalıdır; "
                "Türksat birincil omurga olarak önerilemez."
            ),
        }

    if normalized_country in {"turkiye", "turkey"} or normalized_code == "TR" or _is_turkiye_cross_border_region(region_label):
        if region_type == "interior":
            return {
                "hedef_ulke": "Türkiye / İç altyapı omurgası",
                "ana_geo_saglayici": "TÜRKSAT GEO VSAT",
                "alternatif_geo_saglayici": "EUTELSAT / INTELSAT yedek kapasitesi",
                "yasakli_saglayicilar": "Yok",
                "saglayici_karar_kurali": (
                    "Türkiye iç bölge sahasında TÜRKSAT GEO VSAT birincil omurga olarak önerilebilir; "
                    "gerekçe karasal hatların çökmesine karşı merkezi yedekleme "
                    "ve stratejik iletişim sürekliliğidir."
                ),
            }
        return {
            "hedef_ulke": "Türkiye / Resmi sınır ötesi operasyon sahası",
            "ana_geo_saglayici": "TÜRKSAT GEO VSAT",
            "alternatif_geo_saglayici": "EUTELSAT / INTELSAT yedek kapasitesi",
            "yasakli_saglayicilar": "Yok",
            "saglayici_karar_kurali": (
                "Türkiye veya Türkiye'nin resmi sınır ötesi harekat/üs sahalarında TÜRKSAT GEO VSAT birincil omurga olarak önerilebilir."
            ),
        }

    return {
        "hedef_ulke": _safe_prompt_value(country_name, "Bilinmeyen ülke"),
        "ana_geo_saglayici": "EUTELSAT / INTELSAT bölgesel kapsama",
        "alternatif_geo_saglayici": "Yerel regülasyona uygun bölgesel GEO sağlayıcı",
        "yasakli_saglayicilar": "Ülkeye özel regülasyonla çelişen sağlayıcılar",
        "saglayici_karar_kurali": (
            "Sağlayıcı seçimi ülke regülasyonu, kapsama ve güvenlik izinleriyle uyumlu yapılmalıdır; "
            "Türkiye dışı sahalarda Türksat ezbere ana omurga olarak yazılamaz."
        ),
    }


def _normalize_region_label(region_label: str | None, country_name: str, region_context: dict[str, str] | None = None) -> str:
    raw_label = _safe_prompt_value(region_label, "").strip()
    region_type = (region_context or {}).get("region_type", "border")
    if region_type == "interior":
        fallback_label = f"{_safe_prompt_value(country_name, 'Bilinmeyen saha')} İç Altyapı Bölgesi"
    else:
        fallback_label = f"{_safe_prompt_value(country_name, 'Bilinmeyen saha')} Sınır Bölgesi"
    candidate = raw_label or fallback_label
    for pattern, replacement in FOREIGN_REGION_REPLACEMENTS:
        candidate = pattern.sub(replacement, candidate)
    candidate = NON_TURKISH_SCRIPT_PATTERN.sub("", candidate)
    candidate = _normalize_south_khorasan_label(candidate)
    if IRAQ_REGION_PATTERN.search(candidate):
        return "Kuzey Irak - Hakkari Sınır Hattı"
    if region_type == "interior":
        location_name = re.sub(r"\bSınır\s+Bölgesi\b", "", candidate, flags=re.IGNORECASE)
        location_name = re.sub(r"\bSınır\s+Hattı\b", "", location_name, flags=re.IGNORECASE)
        location_name = re.sub(r"\bİç\s+Altyapı\s+Bölgesi\b", "", location_name, flags=re.IGNORECASE)
        location_name = re.sub(r"\s{2,}", " ", location_name).strip(" -")
        if "Stratejik Sanayi ve Üretim Bölgesi" not in location_name:
            return f"{location_name or _safe_prompt_value(country_name, 'İç Bölge')} Stratejik Sanayi ve Üretim Bölgesi (İç Altyapı Omurgası)"
    return re.sub(r"\s{2,}", " ", candidate).strip(" -")


def _build_cost_profile(elevation: float, region_label: str) -> dict[str, str]:
    safe_elevation = _safe_float(elevation)
    normalized_region = region_label.lower()
    is_hard_terrain = (
        safe_elevation >= 1000
        or any(term in normalized_region for term in ("kuzey irak", "hakkari", "irak", "dağ", "dag", "sınır hattı"))
    )

    if is_hard_terrain:
        return {
            "zorluk_profili": "Yüksek rakım / zorlu sınır topoğrafyası",
            "anten_kurulum_maliyeti": "8.000 - 12.000 USD",
            "uc_yillik_tco": "50.000 - 75.000 USD",
            "maliyet_gerekcesi": "Dağlık arazi, yüksek rakım, lojistik erişim, montaj güvenliği ve ekipman koruma ihtiyacı.",
        }

    return {
        "zorluk_profili": "Düşük rakım / kolay erişimli saha",
        "anten_kurulum_maliyeti": "3.000 - 5.000 USD",
        "uc_yillik_tco": "20.000 - 35.000 USD",
        "maliyet_gerekcesi": "Kolay saha erişimi, düşük montaj riski ve daha düşük lojistik güvenlik gereksinimi.",
    }


def _build_safe_inputs(
    latitude: float,
    longitude: float,
    elevation: float,
    personnel_count: int,
    data_profile: str,
    country_code: str,
    country_name: str,
    region_label: str | None = None,
) -> dict[str, str]:
    region_context = classify_region_context(latitude, longitude, country_code, country_name)
    safe_region_label = _normalize_region_label(region_label, country_name, region_context)
    cost_profile = _build_cost_profile(elevation, safe_region_label)
    provider_profile = _build_provider_profile(
        country_code,
        country_name,
        safe_region_label,
        latitude,
        longitude,
        region_context["region_type"],
    )

    return {
        "coğrafi_konum": safe_region_label,
        "cografi_konum": safe_region_label,
        "konum_bolge": safe_region_label,
        "ülke": provider_profile["hedef_ulke"],
        "ulke": provider_profile["hedef_ulke"],
        "ülke_kodu": _safe_prompt_value(country_code, "NA"),
        "ulke_kodu": _safe_prompt_value(country_code, "NA"),
        "enlem": f"{_safe_float(latitude):.6f} N",
        "boylam": f"{_safe_float(longitude):.6f} E",
        "rakım": f"{_safe_float(elevation):.2f} m",
        "rakim": f"{_safe_float(elevation):.2f} m",
        "personel_sayısı": str(_safe_int(personnel_count)),
        "personel_sayisi": str(_safe_int(personnel_count)),
        "hedef_bant_genisligi": "200 Mbps",
        "profil": _safe_prompt_value(data_profile, "Taktiksel Güvenlik"),
        "region_type": region_context["region_type"],
        "gorev_baglamı": region_context["gorev_baglamı"],
        "gorev_baglami": region_context["gorev_baglami"],
        "koruma_odagi": region_context["koruma_odagi"],
        "ana_geo_saglayici": provider_profile["ana_geo_saglayici"],
        "alternatif_geo_saglayici": provider_profile["alternatif_geo_saglayici"],
        "yasakli_saglayicilar": provider_profile["yasakli_saglayicilar"],
        "saglayici_karar_kurali": provider_profile["saglayici_karar_kurali"],
        **cost_profile,
    }


def _is_retryable(exc: BaseException) -> bool:
    if isinstance(exc, RateLimitError):
        return False
    if isinstance(exc, APIStatusError) and exc.status_code in (402, 429):
        return False
    if isinstance(exc, APIStatusError) and exc.status_code in (502, 503, 504):
        return True
    if isinstance(exc, APIConnectionError):
        return True
    if isinstance(exc, Exception) and any(code in str(exc) for code in ("402", "429")):
        return False
    return False


def _build_regulation_analyst(llm: LLM, tools: list | None = None) -> Agent:
    return Agent(
        role="Uydu Kapsama ve Regulasyon Analisti",
        goal=(
            "Verilen GPS koordinatlarini kullanarak bolgedeki mevcut GEO ve LEO "
            "uydu kapsama durumunu degerlendir. Hedef ulkedeki uydu iletisim lisans "
            "gereksinimlerini, frekans tahsislerini (Ku-band, Ka-band, C-band) ve "
            "regulasyonlari detayli sekilde raporla. "
            "Analiz yapmadan once MUTLAKA 'bolgesel_regulasyon_arama_araci' aracini "
            "kullanarak bolgeye ozel regulasyon dokumanlarini ve teknik verileri "
            "veritabanindan cek. Cevabini yalnizca aractan donen gercek verilere "
            "dayandir, ezbere bilgi verme. "
            f"{TERMINOLOGY_OVERRIDE_RULE}"
        ),
        backstory=(
            "25 yili askin deneyime sahip, ITU frekans koordinasyonu ve uluslararasi "
            "telekomunikasyon regulasyonlari konusunda uzmanlasmis kidemli bir uydu "
            "iletisim analistisin. GEO (TURKSAT, Intelsat, Telesat, Hispasat) ve "
            "LEO uydu filolarinin kapsama haritalarina, ITU "
            "spektrum tahsislerine ve 10 hedef ulkedeki (Turkiye, Yunanistan, "
            "Bulgaristan, Gurcistan, Ermenistan, Azerbaycan, Iran, Irak, Suriye, "
            "Kibris) duzenleyici kurumlarin (BTK, EETT, CRC, GNCC, RA, MCHT, "
            "CRA, CMC, SYTRA, OCECPR) lisans sureclerine hakimsin. "
            "CALISMA PRENSIBIN: Analize baslamadan once MUTLAKA elindeki arama "
            "aracini kullanarak projenin bilgi tabanindaki guncel regulasyon "
            "dokumanlarini tara. Buldugun gercek verileri analizine temel al. "
            "Ezbere veya modelin kendi bilgisine dayanarak asla yanit verme, "
            "sadece aractan donen belgelere dayan. "
            f"{TERMINOLOGY_OVERRIDE_RULE}"
        ),
        llm=llm,
        tools=tools or [],
        verbose=True,
        allow_delegation=False,
        max_iter=5,
    )


def _build_feasibility_engineer(llm: LLM) -> Agent:
    return Agent(
        role="VSAT Fizibilite ve Donanim Muhendisi",
        goal=(
            "Saha koordinatlarini, personel sayisini ve veri profilini dikkate "
            "alarak; LEO, GEO ve Hibrit VSAT mimarilerini karsilastir, uygun "
            "anten boyutunu (75cm vs 120cm) belirle, bant genisligi hesapla, "
            "CAPEX ve OPEX maliyet analizini yap ve kapsamli bir fizibilite "
            "raporu olustur. Bu raporu daha sonra Teknik Rapor Yazici ajanin "
            "kullanmasi icin yapilandirilmis sekilde hazirla. "
            f"{TERMINOLOGY_OVERRIDE_RULE}"
        ),
        backstory=(
            "18 yili askin saha deneyimine sahip, uzak saha iletisim cozumleri "
            "konusunda uzmanlasmis bir VSAT sistem muhendisisin. Hughes, iDirect, "
            "Gilat, Newtec ve regülasyona uygun LEO/yedek erişim terminallerini dunya genelinde "
            "10'dan fazla ulkede sahada kurmus, LEO/GEO hibrit mimarileri "
            "tasarlamis ve onlarca proje icin maliyet-fayda analizi yapmissin. "
            "Her raporda somut rakamlar, karsilastirma tablolari ve USD cinsinden "
            "CAPEX/OPEX detaylari sunarsin. Bolgenin cografi kosullarina (daglik, "
            "col, tropik, karasal) gore anten ve mimari onerilerini uyarlarsin. "
            f"{TERMINOLOGY_OVERRIDE_RULE}"
        ),
        llm=llm,
        verbose=True,
        allow_delegation=False,
        max_iter=3,
    )


def _build_report_writer(llm: LLM) -> Agent:
    return Agent(
        role="Teknik Rapor Yazici ve Koordinator",
        goal=(
            "Regulasyon Analisti ve Fizibilite Muhendisi tarafindan uretilen "
            "teknik verileri al, bunlari birlestirip profesyonel bir master "
            "rapora donustur. Raporu karar vericilerin anlayacagi sade, kesin "
            "ve kapsamli bir kurumsal Turkce ile yaz. Rapor bolumlerini tam olarak "
            f"su Markdown basliklariyla olustur: {', '.join(MASTER_REPORT_HEADINGS)}. "
            "Bu basliklari degistirme, tercume etme veya bozma. "
            f"{SELECTED_OPTION_RULE} "
            f"{REGION_LABEL_RULE} "
            f"{DYNAMIC_COST_RULE} "
            f"{COUNTRY_PROVIDER_MATRIX_RULE} "
            f"{REGION_CONTEXT_RULE} "
            f"{REPORT_LANGUAGE_GUARDRAILS} "
            f" {TERMINOLOGY_OVERRIDE_RULE}"
        ),
        backstory=(
            "15 yili askin deneyime sahip kidemli bir teknik yazar ve telekom "
            "proje koordinatorusun. Muhendislik ekiplerinin urettigi ham teknik "
            "verileri ust duzey yoneticiler ve juri icin anlasilir, ozlu ve "
            "profesyonel raporlara donusturmekte uzmansin. Raporlarinda daima "
            "karsilastirma tablolari, maliyet ozetleri, risk matrisleri ve "
            "net oneriler sunarsin. Yapilandirilmis markdown formatini etkin "
            "kullanir, tum rakami ve maliyet kalemlerini tablo icinde gosterirsin. "
            "Rapor sonunda mutlaka tek bir net oneri cumlesi ve uygulama adimlari "
            "yer alir. "
            "Dil editörü titizliğiyle çalışırsın: Türkçe karakter hatası, yabancı alfabe "
            "sızıntısı, bozuk kelime veya anlamsız hece gördüğünde raporu teslim etmeden "
            "önce düzeltirsin. "
            f"{SELECTED_OPTION_RULE} "
            f"{REGION_LABEL_RULE} "
            f"{DYNAMIC_COST_RULE} "
            f"{COUNTRY_PROVIDER_MATRIX_RULE} "
            f"{REGION_CONTEXT_RULE} "
            f"{REPORT_LANGUAGE_GUARDRAILS} "
            f"{TERMINOLOGY_OVERRIDE_RULE}"
        ),
        llm=llm,
        verbose=True,
        allow_delegation=False,
        max_iter=3,
    )


def _build_tasks(
    analyst: Agent,
    engineer: Agent,
    report_writer: Agent,
    safe_inputs: dict[str, str],
) -> tuple[Task, Task, Task]:
    country_name = safe_inputs["ülke"]
    country_code = safe_inputs["ülke_kodu"]
    region_label = safe_inputs["konum_bolge"]
    latitude = safe_inputs["enlem"]
    longitude = safe_inputs["boylam"]
    elevation = safe_inputs["rakım"]
    personnel_count = safe_inputs["personel_sayısı"]
    data_profile = safe_inputs["profil"]
    terrain_profile = safe_inputs["zorluk_profili"]
    antenna_install_cost = safe_inputs["anten_kurulum_maliyeti"]
    three_year_tco = safe_inputs["uc_yillik_tco"]
    cost_rationale = safe_inputs["maliyet_gerekcesi"]
    primary_geo_provider = safe_inputs["ana_geo_saglayici"]
    alternate_geo_provider = safe_inputs["alternatif_geo_saglayici"]
    blocked_providers = safe_inputs["yasakli_saglayicilar"]
    provider_decision_rule = safe_inputs["saglayici_karar_kurali"]
    region_type = safe_inputs["region_type"]
    mission_context = safe_inputs["gorev_baglamı"]
    protection_focus = safe_inputs["koruma_odagi"]

    regulation_task = Task(
        description=(
            f"Asagidaki saha bilgileri icin kapsamli bir uydu kapsama ve "
            f"regulasyon analizi yap:\n\n"
            f"- **Konum / Bölge:** {region_label}\n"
            f"- **Ulke Kodu:** {country_code}\n"
            f"- **Hedef Ülke:** {country_name}\n"
            f"- **Koordinatlar:** {latitude}, {longitude}\n"
            f"- **Rakim:** {elevation}\n"
            f"- **Topoğrafik Zorluk Profili:** {terrain_profile}\n"
            f"- **Bölge Tipi:** {region_type}\n"
            f"- **Görev Bağlamı:** {mission_context}\n"
            f"- **Koruma Odağı:** {protection_focus}\n"
            f"- **Zorunlu Ana GEO Sağlayıcısı:** {primary_geo_provider}\n"
            f"- **Alternatif GEO Sağlayıcısı:** {alternate_geo_provider}\n"
            f"- **Yasaklı / Kısıtlı Sağlayıcılar:** {blocked_providers}\n"
            f"- **Personel Sayisi:** {personnel_count}\n"
            f"- **Veri Profili:** {data_profile}\n\n"
            f"Ülke-uydu sağlayıcı karar kuralı: {provider_decision_rule}\n"
            f"{COUNTRY_PROVIDER_MATRIX_RULE}\n\n"
            f"{REGION_CONTEXT_RULE}\n\n"
            f"Analiz kapsaminda sunlari belirle:\n"
            f"1. Bu koordinatlara hizmet verebilecek GEO uydularini ve LEO "
            f"takim uydularini ülkeye uygunluk ve lisans durumlariyla "
            f"birlikte listele.\n"
            f"2. {country_name} icin LEO servislerinin "
            f"resmi erisilebilirlik durumunu degerlendir.\n"
            f"3. **{country_name}**'deki uydu iletisim regulasyonlarini, "
            f"yetkili duzenleyici kurumu, lisans turlerini, frekans tahsis "
            f"politikalarini (Ku-band / Ka-band / C-band) ve tahmini basvuru "
            f"sureclerini detayli ozetle.\n"
            f"4. Bolgeye ozgu frekans paraziti (interference) risklerini ve "
            f"gerekiyorsa uluslararasi koordinasyon gerekliliklerini belirt.\n\n"
            f"**ONEMLI: Analize baslamadan once 'bolgesel_regulasyon_arama_araci' "
            f"aracini MUTLAKA kullan. '{country_code}' ulke kodu ve koordinat "
            f"bilgileriyle ilgili anahtar kelimelerle bilgi tabaninda arama yap. "
            f"Sonuclari yapilandirilmis bir rapor formatinda sun.**\n\n"
            f"{TERMINOLOGY_OVERRIDE_RULE}"
        ),
        expected_output=(
            "Yapilandirilmis bir regulasyon ve kapsama raporu: bolgedeki GEO/LEO "
            "uydu kapsama durumu, LEO servislerinin erisilebilirligi, "
            "ulkeye ozel regulasyon gereksinimleri, yetkili duzenleyici kurum, "
            "lisans turleri ve tahmini surecleri, frekans bandi uygunlugu, "
            "parazit riski degerlendirmesi."
        ),
        agent=analyst,
    )

    feasibility_task = Task(
        description=(
            f"Saha koordinatlari ve veri profiline gore {country_name} "
            f"icin kapsamli bir fizibilite raporu olustur:\n\n"
            f"- **Konum / Bölge:** {region_label}\n"
            f"- **Ulke Kodu:** {country_code}\n"
            f"- **Hedef Ülke:** {country_name}\n"
            f"- **Koordinatlar:** {latitude}, {longitude}\n"
            f"- **Rakim:** {elevation}\n"
            f"- **Topoğrafik Zorluk Profili:** {terrain_profile}\n"
            f"- **Bölge Tipi:** {region_type}\n"
            f"- **Görev Bağlamı:** {mission_context}\n"
            f"- **Koruma Odağı:** {protection_focus}\n"
            f"- **Zorunlu Ana GEO Sağlayıcısı:** {primary_geo_provider}\n"
            f"- **Alternatif GEO Sağlayıcısı:** {alternate_geo_provider}\n"
            f"- **Yasaklı / Kısıtlı Sağlayıcılar:** {blocked_providers}\n"
            f"- **Personel Sayisi:** {personnel_count}\n"
            f"- **Veri Profili:** {data_profile}\n\n"
            f"Ülke-uydu sağlayıcı karar kuralı: {provider_decision_rule}\n"
            f"{COUNTRY_PROVIDER_MATRIX_RULE}\n\n"
            f"{REGION_CONTEXT_RULE}\n\n"
            f"Rapor kapsaminda sunlari hesapla ve karsilastir:\n\n"
            f"### 1. Mimari Karsilastirmasi\n"
            f"- Bolgeye uygun {primary_geo_provider} GEO omurgasi vs regülasyona uygun LEO/yedek erişim vs Hibrit mimari\n"
            f"- Her mimarinin avantaj/dezavantajlari, gecikme sureleri (latency), "
            f"hava kosullarina dayaniklilik\n\n"
            f"### 2. Donanim Spesifikasyonlari\n"
            f"- Anten boyutu secimi: 75cm (Ku-band) vs 120cm (C/Ku-band) vs ülkeye uygun yedek erişim terminali\n"
            f"- Modem/Router onerileri (iDirect, Hughes, Gilat, regülasyona uygun terminal)\n"
            f"- {personnel_count} kisi icin '{data_profile}' profiline gore "
            f"gerekli bant genisligi hesaplamasi\n\n"
            f"### 3. Maliyet Analizi\n"
            f"- **CAPEX:** Anten, modem, kurulum, kablolama (USD cinsinden)\n"
            f"- **OPEX:** Aylik servis ucreti, bant genisligi maliyeti, bakim (USD/ay)\n"
            f"- 3 yillik TCO (Total Cost of Ownership) karsilastirmasi\n"
            f"- Bu saha icin dinamik maliyet bandi: Anten/Kurulum {antenna_install_cost}, "
            f"3 Yillik TCO {three_year_tco}. Gerekce: {cost_rationale}\n\n"
            f"### 4. Cografi Risk Degerlendirmesi\n"
            f"- Bolgenin cografi kosullarina gore riskler ve azaltici onlemler\n\n"
            f"Tum sonuclari tablo formatinda ve somut rakamlarla sun. Bu rapor "
            f"Teknik Rapor Yazici tarafindan master rapora donusturulecek.\n\n"
            f"{TERMINOLOGY_OVERRIDE_RULE}"
        ),
        expected_output=(
            "Kapsamli fizibilite raporu: mimari karsilastirma tablosu, donanim listesi "
            "ve ozellikleri, bant genisligi hesaplamasi, CAPEX/OPEX detaylari (USD), "
            "3 yillik TCO, cografi risk degerlendirmesi."
        ),
        agent=engineer,
    )

    report_writer_task = Task(
        description=(
            f"Elinde Regulasyon Analisti ve Fizibilite Muhendisi tarafindan "
            f"{region_label} ({country_code}) icin hazirlanmis iki ayri teknik "
            f"rapor bulunuyor. Bu iki raporu birlestirerek asagidaki bolumlerden "
            f"olusan profesyonel bir MASTER RAPOR yaz:\n\n"
            f"{SELECTED_OPTION_RULE}\n\n"
            f"{REGION_LABEL_RULE}\n\n"
            f"{DYNAMIC_COST_RULE}\n\n"
            f"{REPORT_LANGUAGE_GUARDRAILS}\n\n"
            f"{COUNTRY_PROVIDER_MATRIX_RULE}\n\n"
            f"{REGION_CONTEXT_RULE}\n\n"
            f"Bu raporda kullanılacak ülke-uydu sağlayıcı profili:\n"
            f"- Hedef Ülke: {country_name}\n"
            f"- Ana GEO Sağlayıcısı: {primary_geo_provider}\n"
            f"- Alternatif GEO Sağlayıcısı: {alternate_geo_provider}\n"
            f"- Yasaklı / Kısıtlı Sağlayıcılar: {blocked_providers}\n"
            f"- Karar Gerekçesi: {provider_decision_rule}\n\n"
            f"Bu raporda kullanılacak coğrafi bağlam:\n"
            f"- Bölge Tipi: {region_type}\n"
            f"- Görev Bağlamı: {mission_context}\n"
            f"- Koruma Odağı: {protection_focus}\n\n"
            f"Bu raporda kullanilacak dinamik maliyet profili:\n"
            f"- Topoğrafik Zorluk: {terrain_profile}\n"
            f"- Anten/Kurulum Maliyet Bandı: {antenna_install_cost}\n"
            f"- 3 Yıllık TCO Bandı: {three_year_tco}\n"
            f"- Gerekçe: {cost_rationale}\n\n"
            f"Rapor başlığı standart olarak şu yapıda olmalıdır:\n"
            f"## Güvenlik ve Regülasyon Analizi Raporu - {region_label}\n\n"
            f"Raporun meta-veri alanında 'Şehir:' etiketi kullanma. Bunun yerine "
            f"'Konum / Bölge: {region_label}' yaz.\n\n"
            f"Raporun ilk satiri kesinlikle su yapida olmalidir:\n"
            f"**SEÇİLEN OPSİYON: [ANTEN] + [MODEM/TERMİNAL] + {primary_geo_provider} ANA OMURGALI HİBRİT MİMARİ**\n"
            f"Bu satırda yasaklı sağlayıcı isimlerini ({blocked_providers}) yazmak kesinlikle yasaktır.\n\n"
            f"Rapor basliklarini ASAGIDAKI SEKILDE AYNEN kullan. Basliklari Latin disi "
            f"karakterlerle, Ingilizceyle veya bozuk hecelerle degistirmek yasaktir:\n\n"
            f"## {MASTER_REPORT_HEADINGS[0]}\n"
            f"- Projenin kisa tanimi (saha lokasyonu, personel, veri profili)\n"
            f"- En uygun cozumu {primary_geo_provider} ana omurgasına göre ve toplam maliyeti tek cumlede ozetle\n"
            f"- Kritik riskleri ve onemli uyarilari belirt\n\n"
            f"## {MASTER_REPORT_HEADINGS[1]}\n"
            f"- Tum uygun mimarileri ({primary_geo_provider} GEO omurgasi, regülasyona uygun LEO/yedek erişim, Hibrit) yan yana "
            f"karsilastiran bir tablo olustur\n"
            f"- Her mimari icin: kapsama, gecikme, hiz, guvenilirlik, kurulum suresi\n\n"
            f"## {MASTER_REPORT_HEADINGS[2]}\n"
            f"- CAPEX kalemlerini listeleyen tablo\n"
            f"- OPEX kalemlerini aylik olarak listeleyen tablo\n"
            f"- 3 yillik TCO karsilastirma tablosu. Statik $8.000-$12.000 / $50.000-$75.000 "
            f"kalibini sadece zorlu topoğrafya profilinde kullan; bu saha icin yukaridaki dinamik "
            f"maliyet bandina uy.\n\n"
            f"## {MASTER_REPORT_HEADINGS[3]}\n"
            f"- Tek bir net oneri yaz: mimari, anten, modem ve ana sağlayıcı {primary_geo_provider} ile uyumlu olmalıdır; gerekçe {protection_focus} olmalıdır\n"
            f"- Adim adim uygulama zamani cizelgesi. Basliklar KESINLIKLE '1. Ay:', '2. Ay:', '3. Ay:' formatinda olmalidir; bos 'Ay:' yazma.\n"
            f"- Onemli uyarilar ve risk azaltici onlemler\n\n"
            f"Raporu markdown formatinda, tablolarla zenginlestirilmis, "
            f"profesyonel bir dille yaz. Karar verici bir yoneticinin veya "
            f"jurinin sadece bu raporu okuyarak karar verebilecegi seviyede olsun.\n\n"
            f"{TERMINOLOGY_OVERRIDE_RULE}"
        ),
        expected_output=(
            "Kusursuz Turkce ile yazilmis, yabanci alfabe veya bozuk kelime icermeyen "
            "ilk satirinda **SEÇİLEN OPSİYON: ...** bulunan 4 bolumlu profesyonel master rapor: **1. YÖNETİCİ ÖZETİ**, "
            "**2. KARŞILAŞTIRMALI MİMARİ TABLOSU**, **3. MALİYET ANALİZİ VE "
            "3 YILLIK TCO**, **4. NİHAİ ÖNERİ VE UYGULAMA YOL HARİTASI**. "
            "Markdown formatinda, tablolarla desteklenmis."
        ),
        agent=report_writer,
        context=[regulation_task, feasibility_task],
    )

    return regulation_task, feasibility_task, report_writer_task


def _build_crew(
    latitude: float,
    longitude: float,
    elevation: float,
    personnel_count: int,
    data_profile: str,
    country_code: str,
    country_name: str,
    region_label: str | None = None,
    model: str = PRIMARY_MODEL,
    stream_queue: asyncio.Queue | None = None,
    loop: asyncio.AbstractEventLoop | None = None,
) -> Crew:
    safe_inputs = _build_safe_inputs(
        latitude=latitude,
        longitude=longitude,
        elevation=elevation,
        personnel_count=personnel_count,
        data_profile=data_profile,
        country_code=country_code,
        country_name=country_name,
        region_label=region_label,
    )
    search_tool = create_search_tool(country_code)
    analyst_llm = _build_llm(
        model,
        DEFAULT_LLM_TEMPERATURE,
        callbacks=[AgentStreamingCallback(stream_queue, loop, "agent1")] if stream_queue and loop else None,
    )
    engineer_llm = _build_llm(
        model,
        DEFAULT_LLM_TEMPERATURE,
        callbacks=[AgentStreamingCallback(stream_queue, loop, "agent2")] if stream_queue and loop else None,
    )
    report_writer_llm = _build_llm(
        model,
        REPORT_LLM_TEMPERATURE,
        callbacks=[AgentStreamingCallback(stream_queue, loop, "agent3")] if stream_queue and loop else None,
    )

    analyst = _build_regulation_analyst(analyst_llm, tools=[search_tool])
    engineer = _build_feasibility_engineer(engineer_llm)
    report_writer = _build_report_writer(report_writer_llm)

    regulation_task, feasibility_task, report_writer_task = _build_tasks(
        analyst,
        engineer,
        report_writer,
        safe_inputs,
    )

    return Crew(
        agents=[analyst, engineer, report_writer],
        tasks=[regulation_task, feasibility_task, report_writer_task],
        process=Process.sequential,
        verbose=True,
    )


@retry(
    stop=stop_after_attempt(MAX_RETRY_ATTEMPTS),
    wait=wait_exponential(multiplier=2, min=RETRY_MIN_WAIT, max=RETRY_MAX_WAIT),
    retry=retry_if_exception(_is_retryable),
    before_sleep=before_sleep_log(logger, logging.WARNING),
    reraise=True,
)
def _kickoff_with_retry(crew: Crew, inputs: dict[str, str]) -> Any:
    return crew.kickoff(inputs=inputs)


def _ensure_documents_loaded() -> None:
    from rag_engine import load_documents
    try:
        count = load_documents()
        if count > 0:
            logger.info("RAG bilgi tabani hazir: %d chunk yuklendi.", count)
    except Exception as exc:
        logger.warning("RAG belge yukleme basarisiz (devam ediliyor): %s", exc)


def run_analysis(
    latitude: float,
    longitude: float,
    elevation: float,
    personnel_count: int,
    data_profile: str,
    country_code: str,
    country_name: str,
    region_label: str | None = None,
    stream_queue: asyncio.Queue | None = None,
    loop: asyncio.AbstractEventLoop | None = None,
) -> dict:
    logger.info(
        "Analiz baslatiliyor: ulke=%s (%s), lat=%.4f, lon=%.4f, rakim=%.2f m, personel=%d, profil='%s'",
        country_name, country_code, latitude, longitude, elevation, personnel_count, data_profile,
    )

    _ensure_documents_loaded()
    safe_inputs = _build_safe_inputs(
        latitude=latitude,
        longitude=longitude,
        elevation=elevation,
        personnel_count=personnel_count,
        data_profile=data_profile,
        country_code=country_code,
        country_name=country_name,
        region_label=region_label,
    )

    last_error = None
    for model in [PRIMARY_MODEL, FALLBACK_MODEL]:
        try:
            logger.info("Model deneniyor: %s", model)
            crew = _build_crew(
                latitude, longitude, elevation, personnel_count, data_profile,
                country_code, country_name, region_label, model, stream_queue, loop,
            )
            result = _kickoff_with_retry(crew, safe_inputs)
            break
        except Exception as exc:
            logger.error("Model %s ile analiz basarisiz: %s", model, exc)
            last_error = exc
            continue
    else:
        raise RuntimeError(
            f"Tum modeller basarisiz oldu. Son hata: {last_error}"
        ) from last_error

    raw_output = str(result)

    regulation_report = ""
    feasibility_report = ""
    master_report = ""

    try:
        if hasattr(result, "tasks_output") and result.tasks_output:
            outputs = result.tasks_output
            if len(outputs) >= 1:
                regulation_report = str(outputs[0])
            if len(outputs) >= 2:
                feasibility_report = str(outputs[1])
            if len(outputs) >= 3:
                master_report = str(outputs[2])
    except (IndexError, AttributeError):
        pass

    master_report = _ensure_master_report_headings(master_report, safe_inputs)

    if not master_report and not regulation_report:
        regulation_report = raw_output

    return {
        "status": "success",
        "country_code": country_code,
        "country_name": country_name,
        "input": {
            "latitude": latitude,
            "longitude": longitude,
            "elevation": elevation,
            "personnel_count": personnel_count,
            "data_profile": data_profile,
            "region_label": safe_inputs["konum_bolge"],
            "terrain_profile": safe_inputs["zorluk_profili"],
            "antenna_install_cost": safe_inputs["anten_kurulum_maliyeti"],
            "three_year_tco": safe_inputs["uc_yillik_tco"],
            "cost_rationale": safe_inputs["maliyet_gerekcesi"],
            "primary_geo_provider": safe_inputs["ana_geo_saglayici"],
            "alternate_geo_provider": safe_inputs["alternatif_geo_saglayici"],
            "blocked_providers": safe_inputs["yasakli_saglayicilar"],
        },
        "results": {
            "regulation_and_coverage_analysis": regulation_report,
            "feasibility_report": feasibility_report,
            "master_report": master_report,
        },
        "raw_output": raw_output,
    }
