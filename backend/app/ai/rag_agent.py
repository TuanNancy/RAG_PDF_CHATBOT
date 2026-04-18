"""
RAG Agent for document query processing.
Orchestrates document retrieval, context building, and streaming LLM responses.
"""
import logging
import re
from typing import Any, AsyncIterator, List, Optional

from app.ai.prompts import get_system_prompt
from app.core.config import get_config
from app.core.user_messages import chat_error_message, chat_no_results_message
from app.providers.base import BaseProvider
from app.providers.embeddings import get_embedder
from app.storage.base import BaseStorage, RetrievedChunk as StorageRetrievedChunk

logger = logging.getLogger(__name__)


class RAGAgent:
    def __init__(
        self,
        provider: Optional[BaseProvider] = None,
        storage: Optional[BaseStorage] = None,
        config: Optional[Any] = None,
        provider_model: Optional[str] = None,
    ):
        self.config = config or get_config()
        self.provider = provider
        self.storage = storage
        self.embedder = get_embedder()
        self.provider_model = provider_model

    async def initialize(self) -> None:
        if self.provider is None:
            from app.providers.factory import create_provider

            self.provider = create_provider(model=self.provider_model or self.config.model)
            logger.info("Created OpenRouter provider")

        if self.storage is None:
            from app.storage.factory import create_storage

            self.storage = create_storage(storage_type=self.config.storage_type)
            logger.info("Created Milvus storage")

        await self.storage.connect()
        logger.info("RAG Agent initialized successfully")

    async def shutdown(self) -> None:
        if self.storage:
            await self.storage.disconnect()
        logger.info("RAG Agent shutdown complete")

    async def _retrieve_chunks(
        self,
        query: str,
        doc_id: Optional[str] = None,
    ) -> List[StorageRetrievedChunk]:
        query_vectors = self.embedder.embed_documents([query])
        if not query_vectors:
            logger.warning("Failed to embed query")
            return []

        query_vector = query_vectors[0]

        retrieved_chunks = await self.storage.search_chunks(
            query_vector=query_vector,
            doc_id=doc_id,
            top_k=self.config.retrieval_top_k,
            min_score=self.config.min_relevance_score,
        )

        logger.info("Retrieved %s chunks for query: %s...", len(retrieved_chunks), query[:50])
        return retrieved_chunks

    def _normalize_chunk_text(self, text: str) -> str:
        normalized = re.sub(r"\s+", " ", (text or "").strip().lower())
        return normalized

    def _is_near_duplicate_text(self, left: str, right: str) -> bool:
        if not left or not right:
            return False
        if left == right:
            return True

        shorter, longer = (left, right) if len(left) <= len(right) else (right, left)
        if len(shorter) >= 80 and shorter in longer:
            return True

        if len(shorter) < 80:
            return False

        overlap_ratio = len(shorter) / max(len(longer), 1)
        return overlap_ratio >= 0.9 and shorter[: min(200, len(shorter))] == longer[: min(200, len(shorter))]

    def _merge_retrieved_chunks(
        self,
        chunks: List[StorageRetrievedChunk],
    ) -> List[StorageRetrievedChunk]:
        if not chunks:
            return []

        sorted_chunks = sorted(
            chunks,
            key=lambda chunk: (
                -(chunk.score or 0.0),
                chunk.page,
                len(chunk.text or ""),
            ),
        )

        merged: list[StorageRetrievedChunk] = []
        seen_texts: list[str] = []

        for chunk in sorted_chunks:
            normalized_text = self._normalize_chunk_text(chunk.text)
            if not normalized_text:
                continue

            if any(self._is_near_duplicate_text(normalized_text, seen) for seen in seen_texts):
                continue

            merged.append(chunk)
            seen_texts.append(normalized_text)

        merged.sort(key=lambda chunk: (chunk.page, -(chunk.score or 0.0)))
        logger.info("Normalized retrieved chunks: %s -> %s", len(chunks), len(merged))
        return merged

    def _build_context(self, chunks: List[StorageRetrievedChunk]) -> str:
        if not chunks:
            return ""

        chunks = self._merge_retrieved_chunks(chunks)

        parts: list[str] = []
        total_chars = 0
        max_chars = self.config.context_max_chars
        header = (
            "Below are relevant excerpts retrieved from the same document. "
            "They may come from different parts of the file and can overlap slightly. "
            "Use them to infer the main topic, key points, requirements, findings, or summary.\n\n"
        )

        for idx, chunk in enumerate(chunks, start=1):
            text = (chunk.text or "").strip()
            if not text:
                continue

            block = (
                f"[Excerpt {idx}]\n"
                f"{text}"
            )

            if total_chars + len(block) > max_chars and parts:
                break

            parts.append(block)
            total_chars += len(block)

        if not parts:
            return ""

        body = "\n\n".join(parts)
        return f"{header}{body}"

    async def process_query_stream(
        self,
        query: str,
        doc_id: Optional[str] = None,
        language: str = "vi",
        *,
        retrieved_chunks_override: Optional[List[StorageRetrievedChunk]] = None,
    ) -> AsyncIterator[str]:
        try:
            retrieved_chunks = (
                retrieved_chunks_override
                if retrieved_chunks_override is not None
                else await self._retrieve_chunks(query, doc_id)
            )

            if not retrieved_chunks:
                fallback = chat_no_results_message(language)
                yield fallback
                return

            context = self._build_context(retrieved_chunks)
            system_prompt = get_system_prompt(language)

            async for token in self.provider.stream_with_context(
                query=query,
                context=context,
                system_prompt=system_prompt,
                temperature=self.config.temperature,
                max_tokens=self.config.max_tokens,
            ):
                yield token

        except Exception as e:
            logger.exception("Error in streaming query: %s", e)
            yield chat_error_message(language)


async def create_rag_agent_with_defaults(model: Optional[str] = None) -> RAGAgent:
    agent = RAGAgent(provider_model=model)
    await agent.initialize()
    return agent
