import os
import logging
import shutil
import hashlib
import re
from typing import Optional

from chromadb import PersistentClient, Settings
from chromadb.api.types import Documents, EmbeddingFunction, Embeddings
from sentence_transformers import SentenceTransformer
from langchain_text_splitters import RecursiveCharacterTextSplitter

logger = logging.getLogger("connectivity_copilot.rag")

DOCS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "docs")
CHROMA_PERSIST_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "chroma_db")
COLLECTION_NAME = "global_connectivity_regulation_docs"
EMBEDDING_MODEL_NAME = "all-MiniLM-L6-v2"

CHUNK_SIZE = 800
CHUNK_OVERLAP = 120
MAX_RAG_RESULTS = 3

_FILE_EXTENSIONS = {".txt", ".md", ".rst", ".pdf", ".docx"}
_TERMINOLOGY_SANITIZATION_PATTERNS = [
    re.compile(r"Iraqi\s+Kurdistan", re.IGNORECASE),
    re.compile(r"Kurdistan\s+Region", re.IGNORECASE),
    re.compile(r"Kurdistan", re.IGNORECASE),
    re.compile(r"Kürdistan", re.IGNORECASE),
    re.compile(r"\bKRG\b", re.IGNORECASE),
]

_embedding_model: Optional[SentenceTransformer] = None
_collection: Optional[object] = None
_indexed_files: dict[str, str] = {}


def sanitize_regional_terminology(text: str) -> str:
    """Normalize prohibited regional terminology before indexing or prompting."""
    sanitized = text
    for pattern in _TERMINOLOGY_SANITIZATION_PATTERNS:
        sanitized = pattern.sub("Kuzey Irak", sanitized)
    return sanitized


class _SentenceTransformerEmbeddingFunction(EmbeddingFunction):
    def __init__(self, model: SentenceTransformer):
        self._model = model

    def __call__(self, input: Documents) -> Embeddings:
        return self._model.encode(input, show_progress_bar=False).tolist()


def _get_embedding_model() -> SentenceTransformer:
    global _embedding_model
    if _embedding_model is None:
        logger.info("Embedding modeli yukleniyor: %s", EMBEDDING_MODEL_NAME)
        _embedding_model = SentenceTransformer(EMBEDDING_MODEL_NAME)
    return _embedding_model


def _get_collection() -> object:
    global _collection
    if _collection is None:
        os.makedirs(CHROMA_PERSIST_DIR, exist_ok=True)
        client = PersistentClient(
            path=CHROMA_PERSIST_DIR,
            settings=Settings(anonymized_telemetry=False),
        )
        embedding_fn = _SentenceTransformerEmbeddingFunction(_get_embedding_model())

        try:
            _collection = client.get_collection(
                name=COLLECTION_NAME,
                embedding_function=embedding_fn,
            )
            logger.info("ChromaDB acildi: '%s' (%d vektor)", COLLECTION_NAME, _collection.count())
        except Exception:
            _collection = client.create_collection(
                name=COLLECTION_NAME,
                embedding_function=embedding_fn,
                metadata={"hnsw:space": "cosine"},
            )
            logger.info("ChromaDB olusturuldu: '%s'", COLLECTION_NAME)
    return _collection


def _compute_file_hash(filepath: str) -> str:
    hasher = hashlib.sha256()
    with open(filepath, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def _read_txt_file(filepath: str) -> str:
    with open(filepath, "r", encoding="utf-8", errors="replace") as f:
        return f.read()


def _read_pdf_file(filepath: str) -> str:
    from pypdf import PdfReader
    reader = PdfReader(filepath)
    parts = []
    for page in reader.pages:
        extracted = page.extract_text()
        if extracted:
            parts.append(extracted)
    return "\n".join(parts)


def _read_docx_file(filepath: str) -> str:
    from docx import Document
    doc = Document(filepath)
    parts = []
    for para in doc.paragraphs:
        if para.text:
            parts.append(para.text)
    return "\n".join(parts)


def init_document_folders(target_countries: list[str]) -> None:
    os.makedirs(DOCS_DIR, exist_ok=True)

    codes = {c.upper() for c in target_countries}
    cleaned = 0

    for entry in sorted(os.listdir(DOCS_DIR)):
        entry_path = os.path.join(DOCS_DIR, entry)
        if os.path.isdir(entry_path) and len(entry) == 2 and entry.isalpha():
            if entry.upper() not in codes:
                shutil.rmtree(entry_path, ignore_errors=True)
                logger.info("Temizlendi: docs/%s/", entry)
                cleaned += 1

    created = 0
    for code in sorted(codes):
        folder = os.path.join(DOCS_DIR, code)
        if not os.path.isdir(folder):
            os.makedirs(folder, exist_ok=True)
            logger.info("Olusturuldu: docs/%s/", code)
            created += 1

    if cleaned:
        logger.info("%d eski klasor temizlendi.", cleaned)
    if created:
        logger.info("%d yeni klasor olusturuldu.", created)
    if not cleaned and not created:
        logger.info("Tum %d ulke klasoru hazir.", len(codes))


def _scan_docs_with_walk() -> list[tuple[str, str, str]]:
    if not os.path.isdir(DOCS_DIR):
        return []

    found: list[tuple[str, str, str]] = []

    for root, dirs, files in os.walk(DOCS_DIR):
        rel = os.path.relpath(root, DOCS_DIR)
        if rel == ".":
            continue

        parts = rel.replace("\\", "/").split("/")
        country_code = parts[0].upper() if parts else ""

        if len(country_code) != 2 or not country_code.isalpha():
            continue

        for filename in sorted(files):
            _, ext = os.path.splitext(filename)
            if ext.lower() not in _FILE_EXTENSIONS:
                continue

            filepath = os.path.join(root, filename)
            found.append((filepath, country_code, filename))

    return found


def load_documents(force: bool = False) -> int:
    if not os.path.isdir(DOCS_DIR):
        os.makedirs(DOCS_DIR, exist_ok=True)
        logger.warning("docs/ klasoru bos. Lutfen ulke alt klasorlerine dokuman ekleyin.")
        return 0

    collection = _get_collection()

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=CHUNK_SIZE,
        chunk_overlap=CHUNK_OVERLAP,
        separators=["\n## ", "\n# ", "\n\n", "\n", ". ", " ", ""],
        length_function=len,
    )

    entries = _scan_docs_with_walk()
    if not entries:
        logger.warning("docs/ altinda hicbir .txt/.md/.pdf/.docx dosyasi bulunamadi.")
        return 0

    total_chunks = 0

    for filepath, country_code, filename in entries:
        file_hash = _compute_file_hash(filepath)
        dedup_key = f"{country_code}:{filename}"

        if not force and dedup_key in _indexed_files and _indexed_files[dedup_key] == file_hash:
            logger.debug("Atlandi (zaten indeksli): %s/%s", country_code, filename)
            continue

        try:
            existing = collection.get(
                where={"$and": [{"file_hash": file_hash}, {"country": country_code}]}
            )
            if not force and existing and existing.get("ids"):
                _indexed_files[dedup_key] = file_hash
                logger.debug("Atlandi (ChromaDB'de mevcut): %s/%s", country_code, filename)
                continue
        except Exception:
            pass

        logger.info("Okunuyor: docs/%s/%s", country_code, filename)
        try:
            _, ext = os.path.splitext(filename)
            if ext.lower() == ".pdf":
                raw_text = _read_pdf_file(filepath)
            elif ext.lower() == ".docx":
                raw_text = _read_docx_file(filepath)
            else:
                raw_text = _read_txt_file(filepath)
        except Exception as exc:
            logger.error("Okuma hatasi (%s/%s): %s", country_code, filename, exc)
            continue

        if not raw_text or not raw_text.strip():
            logger.warning("Bos icerik, atlaniyor: %s/%s", country_code, filename)
            continue

        sanitized_text = sanitize_regional_terminology(raw_text)
        chunks = [sanitize_regional_terminology(chunk) for chunk in splitter.split_text(sanitized_text)]
        if not chunks:
            logger.warning("Chunk uretilemedi: %s/%s", country_code, filename)
            continue

        logger.info("  -> %d chunk (%s/%s)", len(chunks), country_code, filename)

        ids = [f"{country_code}_{file_hash}_{i:04d}" for i in range(len(chunks))]
        metadatas = [
            {"country": country_code, "source": filename, "file_hash": file_hash, "chunk_index": i}
            for i in range(len(chunks))
        ]

        try:
            try:
                collection.delete(where={"$and": [{"country": country_code}, {"source": filename}]})
            except Exception as exc:
                logger.debug("Eski chunk temizleme atlandi (%s/%s): %s", country_code, filename, exc)
            collection.add(ids=ids, documents=chunks, metadatas=metadatas)
            total_chunks += len(chunks)
            _indexed_files[dedup_key] = file_hash
        except Exception as exc:
            logger.error("ChromaDB ekleme hatasi (%s/%s): %s", country_code, filename, exc)

    if total_chunks:
        logger.info("TOPLAM: %d chunk ChromaDB'ye eklendi.", total_chunks)
    return total_chunks


def search_documents(query: str, country_code: str, n_results: int = MAX_RAG_RESULTS) -> str:
    if not query or not query.strip():
        return "[Hata: Bos sorgu]"

    safe_n_results = max(1, min(int(n_results), MAX_RAG_RESULTS))
    code = country_code.upper().strip()
    collection = _get_collection()

    collection_size = collection.count()

    if collection_size == 0:
        logger.warning("ChromaDB bos, dokumanlar yukleniyor...")
        loaded = load_documents()
        if loaded == 0:
            return (
                "[Bilgi tabani bos] Henuz hicbir dokuman indekslenmemis. "
                "docs/ altina ulke klasoru (orn: docs/TR/) olusturup icine "
                ".txt veya .pdf dokuman ekleyin, ardindan sunucuyu yeniden baslatin."
            )

    try:
        results = collection.query(
            query_texts=[query],
            n_results=safe_n_results,
            where={"country": code},
            include=["documents", "metadatas", "distances"],
        )
    except Exception as exc:
        logger.error("ChromaDB sorgu hatasi: %s", exc)
        return f"[Sorgu hatasi] {exc}"

    docs = results.get("documents")
    metas = results.get("metadatas")

    if not docs or not docs[0]:
        return f"[Sonuc yok] '{code}' ulke kodu icin eslesen dokuman bulunamadi."

    parts = []
    for i, (doc, meta) in enumerate(zip(docs[0], metas[0] if metas else [{}] * len(docs[0])), 1):
        src = meta.get("source", "bilinmiyor") if isinstance(meta, dict) else "bilinmiyor"
        cc = meta.get("country", "??") if isinstance(meta, dict) else "??"
        parts.append(f"[Kaynak {i}: {cc}/{src}]\n{sanitize_regional_terminology(doc.strip())}")

    return sanitize_regional_terminology("\n\n---\n\n".join(parts))


def initialize_knowledge_base(target_countries: list[str]) -> int:
    logger.info("=== Bilgi Tabani Baslatiliyor ===")
    init_document_folders(target_countries)
    total = load_documents(force=False)
    logger.info("=== Bilgi Tabani Hazir: %d chunk ===", total)
    return total
