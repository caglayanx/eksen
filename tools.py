import logging

from crewai.tools import tool

logger = logging.getLogger("connectivity_copilot.tools")


def create_search_tool(default_country: str):
    country_code = default_country.upper().strip()

    @tool("bolgesel_regulasyon_arama_araci")
    def bolgesel_regulasyon_arama_araci(sorgu_metni: str, ulke_kodu: str = country_code) -> str:
        """
        Verilen ulkedeki uydu iletisim regulasyonlari, frekans bantlari,
        GEO/LEO uydu kapsama durumu, VSAT donanim maliyetleri ve lisans
        surecleri hakkinda bilgi almak icin kullanilacak arama araci.

        Bu arac, projenin yerel dokuman veritabaninda (ChromaDB + embedding)
        anlamsal arama yaparak en alakali en fazla 3 metin parcasini dondurur.
        Arama YALNIZCA belirtilen ulkenin dokumanlarinda yapilir.

        Onemli: Analiz yapmadan once mutlaka bu araci kullanarak bolgeye
        ozel regulasyon dokumanlarini ve teknik verileri kontrol et.
        Cevabini yalnizca bu aractan donen gercek verilere dayandir,
        ezbere bilgi verme.

        Args:
            sorgu_metni (str): Dokuman veritabaninda aranacak anahtar kelimeler
                               veya soru. Ornek: 'GEO uydu kapsama alani'
                               veya 'VSAT lisans basvuru sureci'.
            ulke_kodu (str): Arama yapilacak ulkenin 2 harfli ISO kodu
                             (TR, AU, CA, US, BR, IN, CN, ZA, ID, VN, CL).
                             Varsayilan deger analizi yapilan ulkenin kodudur.

        Returns:
            str: Veritabanindan donen en alakali en fazla 3 dokuman parcasinin
                 birlestirilmis hali. Her parcanin basinda ulke kodu
                 ve kaynak dosya adi bulunur.
        """
        logger.info("Arama araci cagirildi: sorgu='%s', ulke='%s'", sorgu_metni, ulke_kodu)

        from rag_engine import search_documents

        result = search_documents(sorgu_metni, country_code=ulke_kodu, n_results=3)
        logger.info("Arama araci tamamlandi, donen veri boyutu: %d karakter", len(result))
        return result

    return bolgesel_regulasyon_arama_araci
