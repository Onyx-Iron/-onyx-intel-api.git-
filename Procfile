# Railway: create TWO services from this same repo root.
#   web    → start command below (or leave Nixpacks [start] as-is)
#   worker → celery -A celery_app.celery worker --loglevel=INFO --concurrency=${CELERY_CONCURRENCY:-4} -Q onyx.compute
# Also provision a Redis plugin and set REDIS_URL on both services.
web: uvicorn takeoff_api:app --host 0.0.0.0 --port $PORT --workers 2
worker: celery -A celery_app.celery worker --loglevel=INFO --concurrency=${CELERY_CONCURRENCY:-4} -Q onyx.compute
