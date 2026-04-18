"""
Supabase bearer-token authentication helpers for API routes.
"""
from __future__ import annotations

from typing import Any, Dict

import httpx
from fastapi import Header, HTTPException, status

from app.core.config import get_config
from app.core.user_messages import (
    auth_invalid_header_message,
    auth_invalid_token_message,
    auth_invalid_user_payload_message,
    auth_missing_header_message,
    auth_not_configured_message,
    auth_service_unavailable_message,
)


async def require_supabase_user(
    authorization: str | None = Header(default=None),
) -> Dict[str, Any]:
    """
    Validate Supabase JWT from Authorization header and return user payload.
    """
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=auth_missing_header_message(),
        )

    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=auth_invalid_header_message(),
        )

    config = get_config()
    if not config.supabase_url or not config.supabase_publishable_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=auth_not_configured_message(),
        )

    url = f"{config.supabase_url.rstrip('/')}/auth/v1/user"
    headers = {
        "Authorization": f"Bearer {token}",
        "apikey": config.supabase_publishable_key,
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(url, headers=headers)
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=auth_service_unavailable_message(),
        ) from exc

    if response.status_code != status.HTTP_200_OK:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=auth_invalid_token_message(),
        )

    payload = response.json()
    if not isinstance(payload, dict) or not payload.get("id"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=auth_invalid_user_payload_message(),
        )
    return payload
