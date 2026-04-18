"""
POST /api/upload: multipart/form-data PDF upload -> indexing pipeline -> UploadResponse.
"""
import asyncio
import logging
import time
import uuid
from typing import Annotated, Any, Dict

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from app.core.auth import require_supabase_user
from app.core.config import get_config
from app.core.user_messages import (
    upload_empty_file_message,
    upload_file_too_large_message,
    upload_invalid_extension_message,
    upload_invalid_file_type_message,
    upload_invalid_user_message,
    upload_processing_error_message,
    upload_validation_error_message,
)
from app.models.document import DocumentStatus, IndexingResult, create_indexing_result
from app.services.supabase_pdf_storage import try_upload_pdf
from app.storage.factory import create_and_connect_storage

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["upload"])

_EXTRA_ALLOWED_PDF_CONTENT_TYPES = {
    "",
    "application/x-pdf",
    "application/acrobat",
    "applications/vnd.pdf",
    "text/pdf",
    "text/x-pdf",
    "application/octet-stream",
}


async def run_indexing_pipeline_from_upload(
    file_content: bytes,
    filename: str,
    doc_id: str,
) -> IndexingResult:
    """
    Run indexing pipeline on uploaded file content.

    Steps:
    1. Load PDF and extract text
    2. Chunk the text
    3. Generate embeddings
    4. Insert vectors into storage
    """
    import os
    import tempfile

    from app.processors.pdf import chunk_documents, load_pdf_pages
    from app.providers.embeddings import get_embedder

    start_time = time.time()

    suffix = os.path.splitext(filename)[1] or ".pdf"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as f:
        f.write(file_content)
        temp_path = f.name

    try:
        docs, warnings = load_pdf_pages(temp_path, original_filename=filename)
        chunks = chunk_documents(docs)

        if not chunks:
            raise ValueError("No text chunks produced from PDF.")

        embedder = get_embedder()
        vectors = embedder.embed_documents([c["text"] for c in chunks])

        if len(vectors) != len(chunks):
            raise RuntimeError("Embedding count does not match chunk count.")
        if not vectors or not vectors[0]:
            raise RuntimeError("Embedding API returned empty vectors.")

        vector_dim = len(vectors[0])
        if embedder.dimension != vector_dim:
            logger.warning(
                "Embedder.dimension=%s differs from actual vector length=%s; using actual vector length.",
                embedder.dimension,
                vector_dim,
            )

        storage = await create_and_connect_storage()
        try:
            await storage.ensure_collection(vector_dim=vector_dim)
            insert_result = await storage.insert_chunks(
                doc_id=doc_id,
                chunks=chunks,
                vectors=vectors,
            )
        finally:
            await storage.disconnect()

        processing_time = time.time() - start_time
        merged_warnings: list[str] = []
        if warnings:
            merged_warnings.extend(warnings)
        if insert_result.warnings:
            merged_warnings.extend(insert_result.warnings)

        return create_indexing_result(
            doc_id=doc_id,
            name=filename,
            chunks_count=insert_result.chunks_inserted,
            status=DocumentStatus.COMPLETED,
            processing_time=processing_time,
            warnings=merged_warnings,
        )

    finally:
        try:
            os.unlink(temp_path)
        except OSError:
            pass


@router.post("/upload")
async def upload_pdf(
    file: Annotated[UploadFile, File(description="PDF file to index")],
    user: dict = Depends(require_supabase_user),
) -> Dict[str, Any]:
    """
    Accept a PDF via multipart/form-data, validate size/type, run indexing pipeline,
    and return doc_id plus indexing metadata.
    """
    config = get_config()

    content_type = file.content_type or ""
    filename = file.filename or "document.pdf"
    if not filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail=upload_invalid_extension_message())

    allowed_content_types = {
        *(ct.lower() for ct in config.upload_allowed_content_types),
        *_EXTRA_ALLOWED_PDF_CONTENT_TYPES,
    }
    normalized_content_type = content_type.split(";")[0].strip().lower()
    if normalized_content_type not in allowed_content_types:
        raise HTTPException(
            status_code=400,
            detail=upload_invalid_file_type_message(),
        )

    max_bytes = config.upload_max_size_mb * 1024 * 1024
    chunks_read: list[bytes] = []
    total_size = 0

    while True:
        chunk = await file.read(1024 * 1024)
        if not chunk:
            break
        total_size += len(chunk)
        if total_size > max_bytes:
            raise HTTPException(
                status_code=413,
                detail=upload_file_too_large_message(config.upload_max_size_mb),
            )
        chunks_read.append(chunk)

    file_content = b"".join(chunks_read)
    if not file_content:
        raise HTTPException(status_code=400, detail=upload_empty_file_message())

    uid = str(user.get("id") or "")
    if not uid:
        raise HTTPException(status_code=401, detail=upload_invalid_user_message())

    doc_id = str(uuid.uuid4())

    pdf_key, storage_warn = await asyncio.to_thread(
        try_upload_pdf,
        file_content,
        uid,
        doc_id,
        filename,
    )

    try:
        result = await run_indexing_pipeline_from_upload(file_content, filename, doc_id)
        if storage_warn:
            result.warnings.append(storage_warn)
        if pdf_key:
            result.pdf_storage_key = pdf_key
            logger.info("PDF storage key set in response: %s", pdf_key)
        else:
            logger.info("PDF storage key is None; storage upload was skipped or failed")
    except ValueError as e:
        logger.warning("Indexing validation error: %s", e)
        raise HTTPException(status_code=400, detail=upload_validation_error_message(str(e))) from e
    except Exception as e:
        logger.exception("Indexing failed: %s", e)
        raise HTTPException(
            status_code=500,
            detail=upload_processing_error_message(),
        ) from e

    return result.to_dict()
