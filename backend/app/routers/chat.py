"""
POST /api/chat: SSE stream with event types token, sources, error, done.
"""
import json
import logging
from typing import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from app.ai.rag_agent import create_rag_agent_with_defaults
from app.core.auth import require_supabase_user
from app.core.model_catalog import get_allowed_chat_model_ids
from app.core.user_messages import (
    chat_document_required_message,
    chat_error_message,
    chat_invalid_model_message,
    chat_no_results_message,
    chat_query_required_message,
)
from app.schemas import ChatRequest

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["chat"])


def _sse_message(event: str, data: str) -> str:
    return f"event: {event}\ndata: {data}\n\n"


async def _stream_chat_sse(
    query: str,
    doc_id: str,
    language: str = "vi",
    model: str | None = None,
) -> AsyncIterator[str]:
    agent = None

    try:
        agent = await create_rag_agent_with_defaults(model=model)

        retrieved_chunks = await agent._retrieve_chunks(query, doc_id)
        sources_payload = [
            {"page": chunk.page, "source": chunk.source, "score": round(chunk.score, 4)}
            for chunk in retrieved_chunks
        ]
        yield _sse_message("sources", json.dumps(sources_payload))

        if not retrieved_chunks:
            yield _sse_message("token", json.dumps(chat_no_results_message(language)))
            yield _sse_message("done", json.dumps("[DONE]"))
            return

        async for token in agent.process_query_stream(
            query=query,
            doc_id=doc_id,
            language=language,
            retrieved_chunks_override=retrieved_chunks,
        ):
            yield _sse_message("token", json.dumps(token if token else ""))

        yield _sse_message("done", json.dumps("[DONE]"))

    except Exception as e:
        logger.exception("Chat stream error: %s", e)
        yield _sse_message("error", json.dumps({"message": chat_error_message(language)}))
        yield _sse_message("done", json.dumps("[DONE]"))

    finally:
        if agent:
            await agent.shutdown()


@router.post("/chat")
async def chat(
    request: ChatRequest,
    _user: dict = Depends(require_supabase_user),
) -> StreamingResponse:
    try:
        query = request.query.strip()
        doc_id = request.doc_id.strip()
        language = getattr(request, "language", "vi")
        model = (request.model or "").strip() or None
        if model and model not in get_allowed_chat_model_ids():
            raise HTTPException(status_code=400, detail=chat_invalid_model_message(language))

        if not query:
            raise HTTPException(status_code=400, detail=chat_query_required_message(language))
        if not doc_id:
            raise HTTPException(status_code=400, detail=chat_document_required_message(language))

        return StreamingResponse(
            _stream_chat_sse(query, doc_id, language, model),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Chat error: %s", e)
        raise HTTPException(status_code=500, detail=chat_error_message(getattr(request, "language", "vi"))) from e
