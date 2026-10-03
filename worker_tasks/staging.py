"""Shared helpers for Celery workers — Redis blob staging + job metadata."""

from __future__ import annotations

import json
import logging
import os
from typing import Any

import redis

logger = logging.getLogger(__name__)

REDIS_URL = os.getenv("CELERY_BROKER_URL") or os.getenv("REDIS_URL") or "redis://localhost:6379/0"
BLOB_TTL_SECONDS = int(os.getenv("ONYX_JOB_BLOB_TTL", "7200"))  # 2 hours


def redis_client() -> redis.Redis:
    return redis.Redis.from_url(REDIS_URL, decode_responses=False)


def blob_key(job_id: str) -> str:
    return f"onyx:job:{job_id}:blob"


def meta_key(job_id: str) -> str:
    return f"onyx:job:{job_id}:meta"


def store_job_blob(job_id: str, content: bytes, meta: dict[str, Any]) -> None:
    client = redis_client()
    pipe = client.pipeline()
    pipe.setex(blob_key(job_id), BLOB_TTL_SECONDS, content)
    pipe.setex(meta_key(job_id), BLOB_TTL_SECONDS, json.dumps(meta).encode("utf-8"))
    pipe.execute()


def load_job_blob(job_id: str) -> tuple[bytes, dict[str, Any]]:
    client = redis_client()
    raw = client.get(blob_key(job_id))
    meta_raw = client.get(meta_key(job_id))
    if raw is None:
        raise FileNotFoundError(f"Job blob expired or missing: {job_id}")
    meta: dict[str, Any] = {}
    if meta_raw:
        meta = json.loads(meta_raw.decode("utf-8"))
    return raw, meta


def delete_job_blob(job_id: str) -> None:
    client = redis_client()
    client.delete(blob_key(job_id), meta_key(job_id))


def redis_ping() -> bool:
    try:
        return bool(redis_client().ping())
    except Exception as exc:  # noqa: BLE001 — health probes must never raise
        logger.warning("redis ping failed: %s", exc)
        return False
