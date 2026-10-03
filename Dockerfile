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
# Matching CPU torch+torchvision BEFORE Docling so pip does not pull CUDA,
# and AutoImageProcessor can load Docling layout models.
RUN pip install --no-cache-dir -r requirements.txt \
 && pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir -r requirements-docling.txt \
 && pip install --no-cache-dir "transformers>=4.42.0,<5"

COPY . .

ENV PYTHONUNBUFFERED=1
ENV CUDA_VISIBLE_DEVICES=""
ENV OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 MKL_NUM_THREADS=1 TORCH_NUM_THREADS=1 NUMEXPR_NUM_THREADS=1
EXPOSE 8000

# Single worker: Docling/torch need headroom; shell form expands $PORT.
CMD ["sh", "-c", "uvicorn takeoff_api:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1"]
