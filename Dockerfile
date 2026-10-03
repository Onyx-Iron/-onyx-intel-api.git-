FROM python:3.12-slim

WORKDIR /app

# System libs for pdfplumber/Pillow/Docling/ezdxf native bits
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    poppler-utils \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt requirements-docling.txt ./
# Install core deps, then CPU-only torch BEFORE Docling so pip does not
# pull multi-GB CUDA wheels onto the Railway image.
RUN pip install --no-cache-dir -r requirements.txt \
 && pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir -r requirements-docling.txt

COPY . .

ENV PYTHONUNBUFFERED=1
# Force Docling/torch away from CUDA discovery in the container
ENV CUDA_VISIBLE_DEVICES=""
EXPOSE 8000

CMD uvicorn takeoff_api:app --host 0.0.0.0 --port ${PORT:-8000} --workers 2
