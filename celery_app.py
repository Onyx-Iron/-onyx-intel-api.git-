"""
Celery application for Railway heavy-duty takeoff / terrain workers.

Broker + result backend: Redis (`REDIS_URL` or `CELERY_BROKER_URL`).
Local eager mode for tests: set `CELERY_TASK_ALWAYS_EAGER=1`.
"""

from __future__ import annotations

import os

from celery import Celery

REDIS_URL = os.getenv("CELERY_BROKER_URL") or os.getenv("REDIS_URL") or "redis://localhost:6379/0"
RESULT_URL = os.getenv("CELERY_RESULT_BACKEND") or REDIS_URL

celery = Celery(
    "onyx_intel",
    broker=REDIS_URL,
    backend=RESULT_URL,
    include=["worker_tasks.extract", "worker_tasks.terrain"],
)

celery.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    # Large CAD packages: keep results long enough for portal polling.
    result_expires=int(os.getenv("CELERY_RESULT_EXPIRES", "86400")),
    broker_connection_retry_on_startup=True,
    task_always_eager=os.getenv("CELERY_TASK_ALWAYS_EAGER", "").lower() in {"1", "true", "yes"},
    task_eager_propagates=True,
    task_default_queue=os.getenv("CELERY_DEFAULT_QUEUE", "onyx.compute"),
    task_routes={
        "worker_tasks.extract.*": {"queue": os.getenv("CELERY_EXTRACT_QUEUE", "onyx.compute")},
        "worker_tasks.terrain.*": {"queue": os.getenv("CELERY_TERRAIN_QUEUE", "onyx.compute")},
    },
)

# Soft/hard time limits protect a single runaway 500MB parse from wedging a worker.
celery.conf.task_soft_time_limit = int(os.getenv("CELERY_SOFT_TIME_LIMIT", "1800"))  # 30 min
celery.conf.task_time_limit = int(os.getenv("CELERY_TIME_LIMIT", "2400"))  # 40 min
